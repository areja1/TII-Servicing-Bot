# PNR Verification — Implementation Spec (for Claude Code / Opus 4.8)

## Goal
Add a PNR confirmation step to the FNOL flow, gated strictly behind a qualifying
delay. Exact flow, confirmed with Isaiah:

1. Bot asks for **flight number and flight date** together.
2. Bot checks that specific flight number + date combination for a qualifying
   delay (6h+).
   - **Not qualifying** (not found, or delayed less than 6h) → bot says so and
     stops. **The PNR is never requested in this case.**
   - **Qualifying** → bot reports the delay, then asks for the **PNR**.
3. Traveler provides the PNR.
4. Bot checks the PNR against the internal booking record captured when the
   policy was purchased (**mock data for the POC** — the real version is a
   live table populated by an actual sales/purchase pipeline, not looked up
   from any airline; see the PNR investigation doc for why no airline/GDS API
   can do this for free or at all for third parties).
5. **Approval only happens if both checks pass**: qualifying delay AND
   matching PNR. Either one failing stops the claim before approval.

This is Option A (verify against our own records) from the PNR investigation,
now with flight date added so a recurring flight number resolves to the
correct specific flight instance.

## Current flow (before this change)
`fnol-handler.ts` → `validateFlight()` takes only a flight number, calls
`checkFlightStatus()`, and if delayed 6h+, immediately finalizes: computes the
payout, adds the flight to `claimedFlights`, and returns the approval message.
There is no date field and no identity/booking check at all right now.

## 1. New file: `src/lib/pnr/pnr-verification.ts`
Self-contained module, same pattern as `flight-status.ts` (no imports from the
rest of the codebase, so the data source can be swapped later without touching
the handler).

```ts
export interface PnrVerificationResult {
  verified: boolean;
  reason?: 'not_found' | 'mismatch';
}

/**
 * DEMO OVERRIDE — remove once a real sales/purchase pipeline populates this
 * table. Mock bookings tied to the demo flights. In production this becomes a
 * lookup against the insurer's own booking/policy records (Supabase table),
 * populated when the policy is purchased — see the PNR investigation doc for
 * why no airline/GDS API can do this lookup for an arbitrary real booking.
 */
const DEMO_BOOKINGS: Record<string, { pnr: string; lastName: string }> = {
  SWA566: { pnr: 'ABC123', lastName: 'Lopez' },
  SWA565: { pnr: 'XYZ789', lastName: 'Lopez' },
};

export function verifyBooking(
  flightNumber: string,
  pnr: string,
): PnrVerificationResult {
  const booking = DEMO_BOOKINGS[flightNumber.trim().toUpperCase()];
  if (!booking) return { verified: false, reason: 'not_found' };
  const pnrMatch = booking.pnr.toUpperCase() === pnr.trim().toUpperCase();
  if (!pnrMatch) return { verified: false, reason: 'mismatch' };
  return { verified: true };
}
```

## 2. Changes to `src/lib/flight/flight-status.ts`
- `checkFlightStatus()` must accept a **flight date** parameter alongside the
  flight number, and pass it through to AviationStack's `flight_date` query
  param so the correct specific instance of a recurring flight number is
  checked, not just "the most recent match."
- Update the demo override map (`DEMO_FLIGHTS`) to also key on date if you
  want the demo to only approve a specific date, or leave it keyed on flight
  number only and document that the demo ignores date for the two scripted
  idents (call this out clearly in the code comment so it isn't mistaken for
  a bug later).

## 3. Changes to `src/lib/fnol/fnol-state.ts`

- Add `'confirming_pnr'` to `FnolStep`.
- Extend `FnolCollectedInfo` with `flightDate?: string` and `pnr?: string`.
- Add `extractFlightDate(message): string | null` — parse common date formats
  (e.g. "July 9", "07/09", "2026-07-09") into a normalized ISO date string.
  Needs to coexist with flight number extraction in the same message, since
  the bot asks for both together.
- Extend `FnolState` with:
  - `pendingApproval?: { flightNumber: string; flightDate: string; delayMinutes: number }`
    (the data computed when the delay was confirmed, carried forward to the
    PNR step so the payout math isn't redone or drifted).
  - `pnrAttempts?: number`
- Add `extractPnr(message): string | null` — 5 to 7 character alphanumeric
  token, uppercase. **Must not collide with the existing policy number
  pattern (10 to 12 chars) or the flight number pattern (2 to 3 letters + 3 to
  4 digits).**
- **Critical:** `applyFnolMessage()` is the single pure transition function
  shared by both `fnol-handler.ts` (live turn) and `route.ts`
  (`deriveFnolStateFromHistory`, replaying past turns since the server is
  stateless). The file's own comments call this out explicitly: the two must
  never drift. The new `confirming_pnr` branch, the flight-date and PNR
  extraction, and the `claimedFlights` write must all live inside
  `applyFnolMessage()` (or be driven by its return value) so that replaying
  history reconstructs the exact same state a live turn would produce. Do
  **not** add the PNR check only inside `fnol-handler.ts` — that will desync
  from replay and can let a flight get re-approved.

## 4. Changes to `src/lib/fnol/fnol-handler.ts`

- Update `missingFields()` / `buildAskPrompt()` to ask for **flight number and
  date together** on the opening prompt (e.g. "Could you share your flight
  number and the date you flew?").
- Modify `validateFlight()`: now takes `flightNumber` and `flightDate`.
  - **Not found, or delayed less than 6h** → return the existing style of
    scripted decline message, referencing the specific date checked. **Do
    not transition to `confirming_pnr`. Do not ask for a PNR.** This is the
    hard stop Isaiah specified.
  - **Delayed 6h+** → set `state.step = 'confirming_pnr'`, set
    `state.pendingApproval = { flightNumber, flightDate, delayMinutes }`, do
    **not** push to `claimedFlights` yet, and return a message that reports
    the delay and asks: *"To verify this claim, could you provide the PNR
    (booking confirmation number) on your reservation?"*
- Add `confirmPnrAndFinalize(state, userMessage)`:
  - Extract the PNR from the message.
  - If missing, ask again for just the PNR.
  - If present, call `verifyBooking(state.pendingApproval.flightNumber, pnr)`.
    - Verified → compute the same dollar-amount message as today's
      `validateFlight` approval branch, using `state.pendingApproval`. Push
      to `claimedFlights`, set `step = 'complete'`, `outcome = 'approved'`.
    - Not verified, `pnrAttempts < 1` → increment `pnrAttempts`, ask once
      more, politely, to double check.
    - Not verified, `pnrAttempts >= 1` → scripted deflection to human review
      with the existing phone number, `step = 'error'`, `outcome = 'error'`.
- Update `handleFnolTurn()`: add a branch that checks `state.step ===
  'confirming_pnr'` and routes to `confirmPnrAndFinalize` before the normal
  ask/validate/duplicate logic. Keep the existing `looksLikeQuestion()`
  deflection working here too, same as the current "ask" branch, so a
  traveler who asks an unrelated question mid-verification still gets
  answered by the model instead of stuck in a loop.

## 5. Changes to `src/app/api/chat/route.ts`

- `deriveFnolStateFromHistory()` currently adds to `claimedFlights` directly
  whenever a replayed message resolves to `action === 'validate'` and the
  flight is delayed. **This must change** since approval no longer happens at
  that point. Once the PNR logic lives inside `applyFnolMessage()` per item 3
  above, this function can go back to simply calling `applyFnolMessage()` for
  every prior user message and trusting its return value and state
  mutations, the same way it does today, no separate special-casing needed
  here. Double check this function after the change and confirm
  `claimedFlights` only reflects PNR-verified approvals.
- The message sanitizer (the `modelMessages` mapping near the bottom of the
  file) matches on hardcoded substrings from the scripted responses so the
  model's copy of history never contradicts a scripted outcome. Add a new
  substring match for the new "confirm PNR" message and for the "delay does
  not qualify, no PNR needed" message (whatever the exact wording ends up
  being) so the model doesn't try to re-ask for it or apologize when it sees
  it in history. Follow the same pattern as the three existing branches
  (`"Your Trip Delay claim is now in process"`, `"does not currently show a
  qualifying delay"`, `"wasn't able to find flight"`).

## 6. Test scenarios
`src/config/test-scenarios.ts` and the `scripts/test/` runners already
exercise the FNOL flow. Add at least:
- Happy path: flight number + date → delay qualifies → PNR requested →
  correct PNR (`ABC123`) → approved.
- Delay does not qualify → bot declines, confirm **no PNR prompt ever
  appears**.
- Flight not found → bot declines, confirm **no PNR prompt ever appears**.
- Wrong PNR once, then correct → approved on second attempt.
- Wrong PNR twice → deflected to human review.
- Duplicate check: approve SWA566 fully (including PNR), then report SWA566
  again with the same date → duplicate message, no second PNR prompt.
- Mid-verification topic switch: after being asked for PNR, traveler asks an
  unrelated coverage question → model answers it, then the PNR prompt resumes
  next turn.

## 7. Toward the real (non-mock) version, for later
Once there is time and a real sales/purchase pipeline, replace
`DEMO_BOOKINGS` with a Supabase `bookings` table populated in one of two ways:
(a) manually entered from real, actually-purchased tickets during testing, or
(b) written automatically by a `POST /api/bookings` endpoint called at the
moment a real policy is sold. No airline or GDS API can supply this lookup
for an arbitrary real-world booking for free or otherwise as a third party —
see the PNR investigation doc for the full reasoning. `verifyBooking()`'s
signature is written so this swap requires no changes to the handler.

## Out of scope for this task
- Real airline/GDS PNR lookup (Amadeus/Sabre/Duffel) — enterprise-only,
  can only retrieve bookings created through that same platform, not a
  general-purpose lookup. See the PNR investigation doc.
- Boarding pass barcode (BCBP) decoding — a strong second, independent
  verification layer, genuinely free and real. Separate task if you want it
  added on top of this.
