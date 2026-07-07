/**
 * FNOL regression suite — the single source of truth for every FNOL / flight-
 * delay behavior this project has manually verified across all prior rounds of
 * testing. Run this before calling ANY change to this codebase "done", not just
 * the bug being fixed that day.
 *
 *   npm run test:fnol      # this file only
 *   npm test               # this file + the redaction privacy test
 *
 * WHAT RUNS FOR FREE (no API tokens):
 *   Every scenario that stays inside the deterministic scripted FNOL paths runs
 *   locally with zero cost. The AviationStack flight lookup is stubbed here (see
 *   installFlightApiStub) so even the "live API" branch is deterministic and
 *   free — no real flight-API or model call is ever made by this file.
 *
 * WHAT IS MARKED MODEL-REQUIRED:
 *   A few scenarios (bug-1 anti-retraction, and mid-flow "genuine question"
 *   deferrals) hinge on how the MODEL replies once the scripted layer hands off.
 *   This suite verifies — for free — the deterministic half: that the scripted
 *   layer correctly DEFERS to the model (handled === false) instead of derailing
 *   or scripting a wrong answer. The model's actual wording (that it holds its
 *   prior result and does not retract) is governed by grounding-rules.ts and can
 *   only be confirmed with a live model call. Those cases are printed under a
 *   "MODEL-REQUIRED" heading with the exact prompt and the behavior to look for,
 *   so you can spot-check them manually against a deploy without burning tokens
 *   on the deterministic 90%.
 *
 * The suite exits non-zero if any deterministic assertion fails.
 */

import assert from "node:assert/strict";
import {
  initialFnolState,
  applyFnolMessage,
  applyFlightValidationResult,
  extractFlightNumber,
  isFnolTrigger,
  type FnolState,
} from "@/lib/fnol/fnol-state";
import { handleFnolTurn, type FnolHandlerResult } from "@/lib/fnol/fnol-handler";
import { checkFlightStatus } from "@/lib/flight/flight-status";

// ---------------------------------------------------------------------------
// Flight-API stub: keep the "live" AviationStack branch deterministic + free.
// The two demo idents (SWA565/SWA566) short-circuit before any fetch, so they
// are never affected. Every OTHER ident is resolved from this table instead of
// the network. Removing the stub would make the not-found / live-delay cases
// depend on a real HTTP call (and an API key) — exactly what we don't want in a
// regression run.
// ---------------------------------------------------------------------------
function installFlightApiStub() {
  const realFetch = globalThis.fetch;
  // Keyed by the ident we send as flight_icao / flight_iata. `null` delay or a
  // missing entry => no data => "not found". A number is the delay in minutes.
  const LIVE: Record<string, number | "empty"> = {
    AA100: 400, // qualifying live delay (>= 360) — proves AA100 routes to the API
    UAL200: 45, // found but below the 6h threshold — "not delayed" wording
    AA999: "empty", // real airline (AA), flight doesn't exist — genuine "not found"
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("aviationstack.com")) return realFetch(input, init);
    const params = new URL(url).searchParams;
    const ident = (params.get("flight_icao") ?? params.get("flight_iata") ?? "").toUpperCase();
    const entry = LIVE[ident];
    const body =
      entry === undefined || entry === "empty"
        ? { data: [] }
        : {
            data: [
              {
                flight_status: "landed",
                departure: { delay: entry },
                arrival: { delay: entry },
              },
            ],
          };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Harness: reproduce the stateless route exactly. The server rebuilds FNOL
// state from message history on every request (deriveFnolStateFromHistory),
// then runs handleFnolTurn on the latest message. We mirror that here so these
// tests exercise the true production path, including replay/refresh.
// ---------------------------------------------------------------------------

/** Replay prior USER turns into fresh FNOL state, same as the route does. */
async function deriveState(priorUserTurns: string[]): Promise<FnolState> {
  const state = initialFnolState();
  for (const content of priorUserTurns) {
    const { action, flightNumber } = applyFnolMessage(state, content);
    if (action === "validate" && flightNumber) {
      const result = await checkFlightStatus(flightNumber);
      applyFlightValidationResult(state, flightNumber, result);
    }
  }
  return state;
}

/** Response to `current`, computed by replaying `prior` from scratch first. */
async function turn(prior: string[], current: string): Promise<FnolHandlerResult> {
  const state = await deriveState(prior);
  return handleFnolTurn(state, current);
}

/** Run a full conversation the stateless way: each turn replays all earlier ones. */
async function conversation(userTurns: string[]): Promise<FnolHandlerResult[]> {
  const results: FnolHandlerResult[] = [];
  for (let i = 0; i < userTurns.length; i++) {
    results.push(await turn(userTurns.slice(0, i), userTurns[i]));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Tiny test runner.
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failedNames: string[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failedNames.push(name);
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${name}`);
    console.log(`      ${msg.split("\n").join("\n      ")}`);
  }
}

const modelNotes: Array<{ scenario: string; prompt: string; expect: string }> = [];
/**
 * A scenario whose model REPLY quality needs a live call, but whose scripted
 * hand-off we CAN verify for free. Asserts the scripted layer deferred, and
 * records the model expectation for manual/live spot-checking.
 */
async function modelDeferralCase(opts: {
  name: string;
  prior: string[];
  message: string;
  expectModel: string;
}) {
  await test(`${opts.name} (scripted layer defers to model)`, async () => {
    const res = await turn(opts.prior, opts.message);
    assert.equal(
      res.handled,
      false,
      `Expected the scripted layer to DEFER (handled=false) so the model can answer "${opts.message}", but it handled it itself` +
        (res.response ? ` with: ${res.response.slice(0, 120)}...` : "."),
    );
  });
  modelNotes.push({ scenario: opts.name, prompt: opts.message, expect: opts.expectModel });
}

function assertIncludes(haystack: string | undefined, needle: string, label: string) {
  assert.ok(
    (haystack ?? "").toLowerCase().includes(needle.toLowerCase()),
    `${label}: expected reply to include "${needle}".\n  Got: ${haystack ?? "(no response)"}`,
  );
}

function assertExcludes(haystack: string | undefined, needle: string, label: string) {
  assert.ok(
    !(haystack ?? "").toLowerCase().includes(needle.toLowerCase()),
    `${label}: reply should NOT include "${needle}".\n  Got: ${haystack ?? "(no response)"}`,
  );
}

// ===========================================================================
async function main() {
  installFlightApiStub();

  console.log("\nFNOL regression suite\n=====================\n");

  console.log("Flight-number extraction (natural language, plain, typos)");
  await test('"southwest 566" -> SWA566', () =>
    assert.equal(extractFlightNumber("southwest 566"), "SWA566"));
  await test('"delta flight 100" -> DAL100', () =>
    assert.equal(extractFlightNumber("delta flight 100"), "DAL100"));
  await test('plain "AA100" -> AA100', () =>
    assert.equal(extractFlightNumber("AA100"), "AA100"));
  await test('real 2-letter IATA code "DL404" -> DL404', () =>
    assert.equal(extractFlightNumber("DL404"), "DL404"));
  await test('spaced "swa 566" -> SWA566', () =>
    assert.equal(extractFlightNumber("swa 566"), "SWA566"));
  // Bug 1a: a PNR-shaped token with no real airline prefix must NOT be claimed
  // as a flight number (ABC123 / XYZ789 are PNRs, not flights).
  await test('PNR-shaped "ABC123" is NOT extracted as a flight number', () =>
    assert.equal(extractFlightNumber("here is my pnr ABC123"), null));
  await test('PNR-shaped "XYZ789" is NOT extracted as a flight number', () =>
    assert.equal(extractFlightNumber("XYZ789"), null));
  await test('embedded "My flight SWA566 was delayed" -> SWA566', () =>
    assert.equal(extractFlightNumber("My flight SWA566 was delayed"), "SWA566"));
  await test("two distinct numbers -> null (ask which)", () =>
    assert.equal(extractFlightNumber("was it SWA566 or AA100"), null));
  await test('natural-language number routes into the check ("southwest 566")', async () => {
    const res = await turn([], "my flight southwest 566 was delayed");
    assert.equal(res.updatedState.step, "confirming_pnr", "should validate SWA566 and ask PNR");
    assertIncludes(res.response, "PNR", "southwest 566 flow");
  });

  console.log("\nHappy path: report -> asked for PNR -> verify -> approved");
  await test("report SWA566 delay -> asks for PNR (no approval yet)", async () => {
    const res = await turn([], "My flight SWA566 was delayed");
    assert.equal(res.handled, true);
    assert.equal(res.updatedState.step, "confirming_pnr");
    assertIncludes(res.response, "confirmed delayed", "delay report");
    assertIncludes(res.response, "PNR", "delay report");
  });
  await test("correct PNR ABC123 -> claim approved with amount", async () => {
    const res = await turn(["My flight SWA566 was delayed"], "ABC123");
    assert.equal(res.handled, true);
    assert.equal(res.updatedState.step, "complete");
    assert.equal(res.updatedState.outcome, "approved");
    assertIncludes(res.response, "matches our records", "approval");
    assertIncludes(res.response, "$1,500", "approval names the plan maximum");
    assert.ok(
      (res.updatedState.claimedFlights ?? []).includes("SWA566"),
      "approved flight must be recorded in claimedFlights",
    );
  });

  console.log("\nHard stop: a non-qualifying flight is NEVER asked for a PNR");
  await test("SWA565 (on-time) declines and never requests a PNR", async () => {
    const res = await turn([], "My flight SWA565 was delayed");
    assert.equal(res.handled, true);
    assert.equal(res.updatedState.step, "not_delayed");
    assert.equal(res.updatedState.outcome, "not_delayed");
    assertIncludes(res.response, "does not currently show a qualifying delay", "not-delayed");
    assertExcludes(res.response, "PNR", "hard stop must not ask for a PNR");
  });
  await test("live API flight below 6h (UAL200) also hard-stops, no PNR", async () => {
    const res = await turn([], "my flight UAL200 was delayed");
    assert.equal(res.updatedState.step, "not_delayed");
    assertExcludes(res.response, "PNR", "sub-threshold live flight must not ask for a PNR");
  });

  console.log("\nPNR retry / deflect");
  await test("wrong PNR once, then correct -> retry offered, then approved", async () => {
    const [, wrong, right] = await conversation([
      "My flight SWA566 was delayed",
      "WRONG12",
      "ABC123",
    ]);
    assert.equal(wrong.updatedState.step, "confirming_pnr", "still verifying after 1 wrong PNR");
    assertIncludes(wrong.response, "no data found for that pnr", "first wrong PNR");
    assert.equal(right.updatedState.step, "complete", "approved on the correct retry");
    assert.equal(right.updatedState.outcome, "approved");
  });
  await test("wrong PNR twice -> deflect to human review with TII number", async () => {
    const results = await conversation([
      "My flight SWA566 was delayed",
      "WRONG12",
      "WRONG34",
    ]);
    const last = results[2];
    assert.equal(last.updatedState.step, "error");
    assert.equal(last.updatedState.outcome, "error");
    assertIncludes(last.response, "wasn't able to verify that PNR", "deflect");
    assertIncludes(last.response, "1-800-243-3174", "deflect includes TII number");
  });

  console.log("\nNew flight report mid-PNR (must not stay stuck asking for the old PNR)");
  // A genuine new delay report while awaiting the PNR must be recognized as a
  // flight switch, not answered with "I still need the PNR".
  await test('new delay report while awaiting PNR -> asks for the new flight number', async () => {
    const results = await conversation([
      "My flight SWA566 was delayed", // -> confirming_pnr
      "my flight was delayed again", // new report while awaiting PNR
    ]);
    const last = results[1];
    assert.equal(last.handled, true);
    assertExcludes(last.response, "still need the PNR", "must not repeat the PNR request");
    assertIncludes(last.response, "flight number", "asks for the new flight number");
  });
  await test('new flight number while awaiting PNR -> checks that flight fresh', async () => {
    const results = await conversation([
      "My flight SWA566 was delayed", // -> confirming_pnr
      "southwest 565", // different flight named while awaiting PNR
    ]);
    const last = results[1];
    assert.equal(last.handled, true);
    assertExcludes(last.response, "still need the PNR", "must not repeat the PNR request");
    assertIncludes(
      last.response,
      "does not currently show a qualifying delay",
      "SWA565 is checked fresh (it does not qualify)",
    );
  });
  // The exact bug scenario: confirm a delay, take a long off-topic detour, then
  // report a new flight — the state must not stay locked in confirming_pnr.
  await test("new flight after a long mid-PNR detour -> checked fresh, not another PNR request", async () => {
    const results = await conversation([
      "My flight SWA566 was delayed", // -> confirming_pnr
      "does my plan cover trip cancellation?", // detour (defers to model)
      "what receipts do I need?", // detour (defers to model)
      "are meal vouchers covered?", // detour (defers to model)
      "my flight was delayed again", // new report while still awaiting PNR
      "southwest 565", // new flight number
    ]);
    assert.equal(results[1].handled, false, "coverage question defers to the model");
    assert.equal(results[4].handled, true, "the new delay report is recognized");
    assertExcludes(results[4].response, "still need the PNR", "not stuck on the old PNR");
    assert.equal(
      results[5].updatedState.step,
      "not_delayed",
      "SWA565 is checked after the detour",
    );
    assertExcludes(results[5].response, "still need the PNR", "new flight checked, not a PNR request");
  });

  console.log("\nDuplicate-claim check: fires on genuine re-file, NOT on questions");
  await test("genuine re-file repeating the number -> duplicate message", async () => {
    const results = await conversation([
      "My flight SWA566 was delayed",
      "ABC123",
      "My flight SWA566 was delayed",
    ]);
    const last = results[2];
    assert.equal(last.handled, true);
    assertIncludes(last.response, "already on file and being processed", "duplicate");
    assertExcludes(last.response, "PNR", "duplicate must not re-prompt for a PNR");
  });
  await test('genuine re-file WITHOUT the number ("my flight was delayed again") -> duplicate', async () => {
    const results = await conversation([
      "My flight SWA566 was delayed",
      "ABC123",
      "my flight was delayed again",
    ]);
    const last = results[2];
    assert.equal(last.handled, true);
    assertIncludes(last.response, "already on file and being processed", "no-number re-file");
  });
  await test("duplicate message offers to check a different flight number", async () => {
    const results = await conversation([
      "My flight SWA566 was delayed",
      "ABC123",
      "my flight was delayed again",
    ]);
    assertIncludes(results[2].response, "different flight", "duplicate offers another flight");
  });
  // A traveler with a SECOND, different delayed flight re-triggers, gets the
  // duplicate reply, then gives the new number — that must start a fresh check,
  // not another duplicate.
  await test("DIFFERENT flight after the duplicate reply -> fresh check (not a duplicate)", async () => {
    const results = await conversation([
      "My flight SWA566 was delayed",
      "ABC123",
      "my flight was delayed again", // -> duplicate reply for SWA566
      "my flight AA100 was delayed", // different flight -> should be checked fresh
    ]);
    assertIncludes(results[2].response, "already on file and being processed", "SWA566 is the duplicate");
    const fresh = results[3];
    assert.equal(fresh.handled, true);
    assert.equal(
      fresh.updatedState.step,
      "confirming_pnr",
      "a different flight after the duplicate must start a fresh check",
    );
    assertIncludes(fresh.response, "confirmed delayed", "different flight is actually checked");
    assertExcludes(fresh.response, "already on file", "different flight must NOT be treated as a duplicate");
  });
  // The SAME number again after the duplicate reply must still be a duplicate —
  // the fresh-intake reset must not let an already-approved flight re-validate.
  await test("SAME flight again after the duplicate reply -> still the duplicate message", async () => {
    const results = await conversation([
      "My flight SWA566 was delayed",
      "ABC123",
      "my flight was delayed again", // -> duplicate reply for SWA566
      "My flight SWA566 was delayed", // same flight again -> still duplicate
    ]);
    const again = results[3];
    assert.equal(again.handled, true);
    assertIncludes(again.response, "already on file and being processed", "same flight stays a duplicate");
    assertExcludes(again.response, "confirmed delayed", "same flight must not start a fresh check");
  });

  console.log("\nPNR given after the flow drifts (Bug 1 / Bug 3): re-attach + approve, no flight lookup");
  // Bug 1 + Bug 3, the exact live scenario: confirm SWA566, switch to a second
  // flight (which abandons SWA566's pending PNR), then come "back to the first
  // one" with an explicit PNR. ABC123 must NOT be looked up as a flight; it must
  // re-attach to SWA566 and approve — which writes claimedFlights so the later
  // re-report is correctly a duplicate (Bug 3 resolves as a consequence).
  await test("'back to the first one, here is my pnr ABC123' after a detour -> approves SWA566", async () => {
    const results = await conversation([
      "My flight SWA566 was delayed", // -> confirming_pnr (SWA566)
      "actually my other flight southwest 565 was also delayed", // abandons SWA566's PNR, checks SWA565
      "ok back to the first one, here is my pnr ABC123", // PNR for the first flight
    ]);
    const approved = results[2];
    assert.equal(approved.handled, true);
    assert.equal(approved.updatedState.step, "complete", "SWA566 is approved");
    assert.equal(approved.updatedState.outcome, "approved");
    assert.ok(
      (approved.updatedState.claimedFlights ?? []).includes("SWA566"),
      "claimedFlights must be written on this approval (fixes Bug 3)",
    );
    assertIncludes(approved.response, "matches our records", "approval message");
    assertExcludes(approved.response, "wasn't able to find flight", "ABC123 must NOT be looked up as a flight");
  });
  // Bug 3, made explicit: after the above approval, re-reporting SWA566 is a duplicate.
  await test("after the re-attached approval, re-reporting SWA566 -> duplicate (Bug 3)", async () => {
    const results = await conversation([
      "My flight SWA566 was delayed",
      "actually my other flight southwest 565 was also delayed",
      "ok back to the first one, here is my pnr ABC123", // approves SWA566
      "my flight SWA566 was delayed again", // re-report the same flight
    ]);
    assertIncludes(
      results[3].response,
      "already on file and being processed",
      "SWA566 is now a duplicate because claimedFlights was written",
    );
  });
  // Hard stop preserved: a PNR whose flight never had a confirmed qualifying
  // delay must NOT auto-approve via reverse lookup (XYZ789 belongs to on-time
  // SWA565). It routes to a "which flight?" ask, never an approval.
  await test("PNR for a never-qualified flight (XYZ789 -> on-time SWA565) does NOT approve", async () => {
    const results = await conversation([
      "My flight SWA565 was delayed", // SWA565 is on-time -> not_delayed, never qualifies
      "here is my pnr XYZ789", // XYZ789 is SWA565's booking PNR
    ]);
    const res = results[1];
    assert.notEqual(res.updatedState.step, "complete", "must not approve a never-qualified flight");
    assert.notEqual(res.updatedState.outcome, "approved");
    assertExcludes(res.response ?? "", "matches our records", "no approval message");
    assertExcludes(res.response ?? "", "wasn't able to find flight", "XYZ789 not looked up as a flight");
  });
  // A bare PNR-shaped token (no keyword) after drift must not be flight-looked-up.
  await test("bare 'ABC123' after drift is not looked up as a flight number", async () => {
    const results = await conversation([
      "My flight SWA565 was delayed", // drift the flow to not_delayed
      "ABC123", // bare PNR-shaped token, no 'pnr' keyword
    ]);
    assertExcludes(
      results[1].response ?? "",
      "wasn't able to find flight ABC123",
      "ABC123 must never be sent to a flight lookup",
    );
  });

  // The exact question from bug 2. Must NOT get the duplicate message; must defer.
  await test('BUG-2 hypothetical "future trip...covered?" does NOT fire duplicate', async () => {
    const res = await turn(
      ["My flight SWA566 was delayed", "ABC123"],
      "If my flight gets delayed again on a future trip, will that also be covered under this same plan?",
    );
    assert.equal(
      res.handled,
      false,
      "hypothetical coverage question must defer to the model, not be handled by FNOL",
    );
    assertExcludes(res.response, "already on file", "must not get the duplicate-claim reply");
  });
  await test("isFnolTrigger: bug-2 hypothetical is not treated as a delay report", () =>
    assert.equal(
      isFnolTrigger(
        "If my flight gets delayed again on a future trip, will that also be covered under this same plan?",
      ),
      false,
    ));
  await test("isFnolTrigger: a plain delay report still triggers", () =>
    assert.equal(isFnolTrigger("My flight SWA566 was delayed"), true));

  console.log("\nReplay / refresh: approve, rebuild state from scratch, duplicate still holds");
  await test("state derived purely from history reflects the approval", async () => {
    const state = await deriveState(["My flight SWA566 was delayed", "ABC123"]);
    assert.equal(state.step, "complete", "replayed state should be complete");
    assert.equal(state.outcome, "approved");
    assert.ok(
      (state.claimedFlights ?? []).includes("SWA566"),
      "replay must reconstruct claimedFlights (approval survives a refresh)",
    );
  });
  await test("re-trigger against replayed state -> duplicate (not a fresh intake)", async () => {
    const state = await deriveState(["My flight SWA566 was delayed", "ABC123"]);
    const res = await handleFnolTurn(state, "My flight SWA566 was delayed");
    assert.equal(res.handled, true);
    assertIncludes(res.response, "already on file and being processed", "post-replay duplicate");
  });

  console.log("\nNot-found vs found-but-not-delayed: distinct wording");
  // AA999: real airline prefix (AA) so it's accepted as a flight number, but the
  // flight doesn't exist -> genuine not-found. (A fake prefix like ZZ999 is now
  // rejected at extraction by Bug 1a and would never reach the lookup.)
  await test("not-found (AA999) and not-delayed (SWA565) use different messages", async () => {
    const notFound = await turn([], "my flight AA999 was delayed");
    const notDelayed = await turn([], "My flight SWA565 was delayed");
    assert.equal(notFound.updatedState.outcome, "not_found");
    assert.equal(notDelayed.updatedState.outcome, "not_delayed");
    assertIncludes(notFound.response, "wasn't able to find flight AA999", "not-found wording");
    assertIncludes(
      notDelayed.response,
      "does not currently show a qualifying delay",
      "not-delayed wording",
    );
    assert.notEqual(
      notFound.response,
      notDelayed.response,
      "not-found and not-delayed replies must be distinct",
    );
  });

  console.log("\nLive-API routing (stubbed): AA100 routes through the API on flight number alone");
  await test("AA100 (no date) -> live lookup -> qualifying delay -> asks PNR", async () => {
    const res = await turn([], "my flight AA100 was delayed");
    assert.equal(res.updatedState.step, "confirming_pnr");
    assertIncludes(res.response, "confirmed delayed", "AA100 live qualifying");
  });

  console.log("\nFlow resumes after a deferred mid-intake question (no derail)");
  await test('baggage question mid-intake defers, then "SWA566" still validates', async () => {
    const results = await conversation([
      "my flight was delayed",
      "what does my baggage delay coverage include?",
      "SWA566",
    ]);
    assert.equal(results[1].handled, false, "mid-intake baggage question must defer to the model");
    assert.equal(
      results[2].updatedState.step,
      "confirming_pnr",
      "intake resumes and validates SWA566 after the detour",
    );
  });

  // -------------------------------------------------------------------------
  // MODEL-REQUIRED scenarios: scripted deferral verified for free; model reply
  // quality (holds prior result / answers correctly) needs a live check.
  // -------------------------------------------------------------------------
  console.log("\nMODEL-REQUIRED cases — scripted deferral verified free; reply needs a live check");

  await modelDeferralCase({
    name: 'BUG-1 anti-retraction: "are you sure?" after a not-delayed result',
    prior: ["My flight SWA565 was delayed"],
    message: "are you sure? that doesn't sound right",
    expectModel:
      'Model HOLDS the not-delayed result. It must NOT say "I don\'t have the ability to look up flight information" or otherwise retract/apologize for the check.',
  });
  await modelDeferralCase({
    name: 'BUG-1 anti-retraction: "did you actually file my claim?" after approval',
    prior: ["My flight SWA566 was delayed", "ABC123"],
    message: "wait, did you actually file my claim? has anything really been approved?",
    expectModel:
      'Model AFFIRMS the claim is in process / approved and describes the OZZI payout. It must NOT say "no claim has been filed or approved through this chat."',
  });
  await modelDeferralCase({
    name: 'Genuine question after approval: "how will I get paid?"',
    prior: ["My flight SWA566 was delayed", "ABC123"],
    message: "how will I get paid?",
    expectModel: "Model explains the virtual debit card / OZZI payout without retracting the approval.",
  });
  await modelDeferralCase({
    name: 'Genuine question after approval: "is that the right amount?"',
    prior: ["My flight SWA566 was delayed", "ABC123"],
    message: "is that the right amount?",
    expectModel: "Model explains the $150/day up to $1,500 basis; does not retract the approval.",
  });
  await modelDeferralCase({
    name: "Mid-intake genuine question: baggage coverage",
    prior: ["my flight was delayed"],
    message: "what does my baggage delay coverage include?",
    expectModel: "Model answers baggage coverage from the plan docs; FNOL intake resumes next turn.",
  });
  await modelDeferralCase({
    name: "Mid-intake genuine question: medical limits",
    prior: ["my flight was delayed"],
    message: "what is my emergency medical limit?",
    expectModel: "Model answers the medical limit from the plan docs; FNOL intake resumes next turn.",
  });

  // -------------------------------------------------------------------------
  console.log("\n---------------------------------------------------------------");
  if (modelNotes.length) {
    console.log("MODEL-REQUIRED manual checks (verify these replies against a live deploy):");
    for (const n of modelNotes) {
      console.log(`  • ${n.scenario}`);
      console.log(`      prompt: "${n.prompt}"`);
      console.log(`      expect: ${n.expect}`);
    }
    console.log("");
  }

  console.log(`RESULT: ${passed} passed, ${failed} failed (deterministic assertions).`);
  console.log(
    `        ${modelNotes.length} model-required case(s) had their scripted deferral verified above.`,
  );
  if (failed > 0) {
    console.log(`\nFAILED: ${failedNames.join("; ")}`);
    process.exit(1);
  }
  console.log("\nAll deterministic FNOL regression checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
