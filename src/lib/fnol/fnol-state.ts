import { verifyBooking, findBookingFlightByPnr } from '@/lib/pnr/pnr-verification';

export interface FnolCollectedInfo {
  /** The one field the intake actively collects from the traveler. */
  flightNumber?: string;
  /** Captured once the PNR step verifies it (see confirming_pnr below). */
  pnr?: string;
  // travelerName and policyNumber are already on file from the traveler's
  // Confirmation of Benefits, so the intake never asks for them. They are still
  // stored here if the traveler happens to volunteer them in a message.
  travelerName?: string;
  policyNumber?: string;
}

export type FnolStep =
  | 'idle'
  | 'collecting'
  | 'confirming_pnr'
  | 'complete'
  | 'not_delayed'
  | 'error';

export interface FnolState {
  active: boolean;
  step: FnolStep;
  collectedInfo: FnolCollectedInfo;
  /** Flight numbers already validated this session — prevents claiming twice. */
  claimedFlights?: string[];
  /**
   * Flights confirmed with a qualifying 6h+ delay this session (flightNumber →
   * delayMinutes), whether or not the PNR step was completed. Unlike
   * pendingApproval (which is cleared when the traveler switches flights mid-PNR)
   * this is never cleared, so a PNR supplied later ("back to the first one, here
   * is my pnr ABC123") can be re-attached to a flight whose delay was already
   * confirmed — WITHOUT re-approving a flight that never qualified (the hard
   * stop). Reconstructed during history replay like claimedFlights.
   */
  qualifiedFlights?: Record<string, number>;
  outcome?: 'approved' | 'not_delayed' | 'not_found' | 'error';
  /**
   * Delay data computed when the qualifying delay was confirmed, carried
   * forward across the PNR step so the payout math isn't redone or drifted.
   * Only set while step === 'confirming_pnr'; cleared once the PNR step
   * resolves (approved or deflected).
   */
  pendingApproval?: { flightNumber: string; delayMinutes: number };
  /** Wrong-PNR attempts this verification — one retry allowed before deflecting. */
  pnrAttempts?: number;
}

export function initialFnolState(): FnolState {
  return { active: false, step: 'idle', collectedInfo: {} };
}

/**
 * True if the message looks like the start of a flight-delay / Trip Delay claim.
 */
export function isFnolTrigger(message: string): boolean {
  const text = message.toLowerCase();
  // Coverage / eligibility / hypothetical questions are NOT delay reports, even
  // when they mention "flight" and "delay" (e.g. "can I claim for both the
  // flight delay and the lost passport", or "if my flight gets delayed again on
  // a future trip, will that be covered?"). If the message opens with one of
  // these phrasings, it's asking ABOUT coverage or posing a hypothetical, not
  // reporting a delay happening now — never trigger the FNOL flow. A leading
  // "if"/"what if"/"suppose" is a conditional (a hypothetical, not a report);
  // genuine re-file reports read as statements ("my flight was delayed again"),
  // never as conditionals.
  if (
    /^\s*(?:can i|could i|is it possible|am i able|do i|will i|would i|what if|if|suppose)\b/.test(
      text,
    )
  ) {
    return false;
  }
  // A message about whether something is "covered"/"coverage" is a coverage
  // question, not a first-person report of a disruption — never trigger the FNOL
  // flow for it (e.g. "does my plan cover flight delays?", "is a missed
  // connection covered?"). A genuine report ("my flight was cancelled") never
  // uses that word.
  if (/\bcover(?:ed|age|s)?\b/.test(text)) return false;

  // First-person / direct reports of the traveler's own flight failing right
  // now. Each disruption term must appear NEAR the word "flight" (or "plane"),
  // in either order, so it describes their flight — not a general coverage
  // question. Covers: delayed/cancelled/messed up/stuck, in any phrasing.
  const disruption =
    "delay\\w*|cancel\\w*|messed up|stuck";
  const nearFlight = new RegExp(
    `\\b(?:flight|plane)\\b[\\s\\S]{0,40}(?:${disruption})|` +
      `(?:${disruption})[\\s\\S]{0,40}\\b(?:flight|plane)\\b`,
  );
  if (nearFlight.test(text)) return true;

  // "missed my/our/the flight" — past-tense report of a missed flight. Present
  // tense ("if I miss my flight …") is a hypothetical and is already rejected by
  // the conditional guard above.
  if (/\bmissed\s+(?:my|our|the|his|her|their)\s+flight\b/.test(text)) return true;

  // Explicit "flight problem / issue / disruption" noun phrases.
  if (/\bflight\s+(?:problem|issue|disruption)\b/.test(text)) return true;

  // Strongly flight-specific phrases that stand on their own (a coverage
  // question would never describe the traveler's own flight this way).
  if (
    /\b(?:never took off|never departed|didn'?t (?:take off|depart|leave))\b/.test(
      text,
    )
  ) {
    return true;
  }

  // Bare "late"/"delayed" verb phrasings that may not repeat the word "flight"
  // right beside them (e.g. "it was delayed 6 hours", "we got delayed").
  if (
    /\b(?:was late|flight late|plane was late|plane is late|got delayed|been delayed|was delayed|got late)\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (text.includes('file a claim') && text.includes('delay')) return true;
  if (text.includes('fnol')) return true;
  if (text.includes('trip delay claim')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Dynamic field extraction. Each user message may contain any combination of
// fields, in any order. We extract whatever is present rather than relying on a
// fixed question sequence.
// ---------------------------------------------------------------------------

/**
 * Spelled-out airline names → the code the demo/lookup expects. Keyed to ICAO
 * (3-letter) idents so a name resolves to the same ident the demo mocks and
 * AviationStack `flight_icao` lookups use (e.g. "southwest" → "SWA", matching
 * SWA566). Order matters only in that longer names are matched whole-word.
 */
const AIRLINE_NAME_TO_CODE: Record<string, string> = {
  southwest: 'SWA',
  delta: 'DAL',
  united: 'UAL',
  american: 'AAL',
  jetblue: 'JBU',
  alaska: 'ASA',
  spirit: 'NKS',
  frontier: 'FFT',
  hawaiian: 'HAL',
  allegiant: 'AAY',
};

/**
 * A spelled-out airline name immediately followed by flight digits (e.g.
 * "southwest 565", "delta flight 100"). This shape unambiguously names a flight
 * and can NEVER be a PNR (a PNR is a compact alphanumeric token like ABC123 —
 * it never contains an airline name), so it is safe to use as a "this is a new
 * flight, not a PNR answer" signal while mid-PNR-verification. See
 * {@link isNewFlightReport}.
 */
const AIRLINE_NAME_FLIGHT = new RegExp(
  `\\b(?:${Object.keys(AIRLINE_NAME_TO_CODE).join('|')})\\b\\s*(?:flight|flt|#|no\\.?|number)?\\s*\\d{3,4}\\b`,
  'i',
);

/**
 * Recognised airline prefixes (IATA 2-letter and ICAO 3-letter) used to tell a
 * real flight number apart from a PNR that merely happens to be flight-shaped.
 * EVERY flight number (2–3 letters + 3–4 digits) is also PNR-shaped (5–7
 * alphanumeric), so shape alone can't distinguish ABC123 (a PNR) from SWA566 (a
 * flight): the only reliable signal is a real airline prefix. ABC/XYZ are not
 * airlines, so tokens like ABC123 / XYZ789 are rejected as flight numbers.
 *
 * POC scope: this is a curated list of major carriers plus the airlines we spell
 * out. Production should replace it with a complete IATA/ICAO airline database
 * (otherwise a real flight on a carrier not listed here would be rejected).
 */
const KNOWN_AIRLINE_PREFIXES = new Set<string>(
  [
    // ICAO codes for the airlines we spell out (kept in sync with the map above).
    ...Object.values(AIRLINE_NAME_TO_CODE),
    // Common IATA 2-letter codes (letters only — codes containing a digit, e.g.
    // B6/F9/G4, can't be a flight-number prefix under the [A-Z]{2,3} pattern).
    'AA', 'AC', 'AF', 'AM', 'AS', 'AV', 'AZ', 'BA', 'CA', 'CI', 'CM', 'CX', 'CZ',
    'DL', 'EI', 'EK', 'ET', 'EY', 'GA', 'HA', 'HU', 'IB', 'JL', 'KE', 'KL', 'LA',
    'LH', 'LX', 'MH', 'MS', 'MU', 'NH', 'NK', 'NZ', 'OZ', 'PR', 'QF', 'QR', 'SA',
    'SK', 'SQ', 'SV', 'SY', 'TG', 'TK', 'TP', 'UA', 'VA', 'VN', 'VS', 'WN', 'WS',
    // Common ICAO 3-letter codes.
    'AAL', 'ACA', 'AFR', 'ANA', 'ASA', 'AVA', 'AZA', 'BAW', 'CCA', 'CES', 'CSN',
    'CPA', 'DAL', 'DLH', 'EIN', 'ETD', 'ETH', 'EVA', 'GIA', 'HAL', 'HVN', 'IBE',
    'JAL', 'JBU', 'KAL', 'KLM', 'MAS', 'MSR', 'NKS', 'QFA', 'QTR', 'SIA', 'SAS',
    'SVA', 'SWA', 'SWR', 'TAP', 'THA', 'THY', 'UAE', 'UAL', 'VIR', 'VLG', 'WJA',
  ].map((code) => code.toUpperCase()),
);

/** True if a flight-shaped token starts with a recognised airline prefix. */
function hasKnownAirlinePrefix(token: string): boolean {
  const prefix = token.toUpperCase().match(/^[A-Z]+/)?.[0] ?? '';
  return KNOWN_AIRLINE_PREFIXES.has(prefix);
}

/**
 * Flight number: 2–3 letters + 3–4 digits (e.g. SWA566, AA100). Uppercased.
 * Tolerates spaces inside the flight number ("SWA 566", "SWA 5 6 6") by
 * collapsing them before the strict pattern runs, and a spelled-out airline
 * name in place of the code ("southwest 566", "delta flight 100" → SWA566,
 * DAL100).
 */
export function extractFlightNumber(message: string): string | null {
  let normalized = message;

  // Preprocess 1: a spelled-out airline name followed by its digits (with an
  // optional "flight"/"flt"/"#"/"no."/"number" in between) → code + digits.
  for (const [name, code] of Object.entries(AIRLINE_NAME_TO_CODE)) {
    normalized = normalized.replace(
      new RegExp(`\\b${name}\\b\\s*(?:flight|flt|#|no\\.?|number)?\\s*(\\d{3,4})\\b`, 'ig'),
      (_match, digits: string) => `${code}${digits}`,
    );
  }

  // Preprocess 2: in a "letters + (spaced) digits" run, strip the spaces so
  // "SWA 5 6 6" / "SWA 566" become "SWA566".
  normalized = normalized.replace(
    /\b([A-Za-z]{2,3})((?:\s*\d){3,4})\b/g,
    (_match, letters: string, digits: string) =>
      letters + digits.replace(/\s+/g, ""),
  );
  const matches = normalized.match(/\b[A-Z]{2,3}\d{3,4}\b/gi);
  if (!matches) return null;
  // Reject flight-shaped tokens with no recognised airline prefix: every flight
  // number is also PNR-shaped (5–7 alphanumeric), so a token like ABC123 or
  // XYZ789 — a PNR, not a flight — would otherwise be claimed as a flight number
  // and sent to a (failing) flight lookup. Requiring a real airline prefix keeps
  // PNRs out. See KNOWN_AIRLINE_PREFIXES / hasKnownAirlinePrefix.
  const valid = matches.map((m) => m.toUpperCase()).filter(hasKnownAirlinePrefix);
  if (valid.length === 0) return null;
  const distinct = [...new Set(valid)];
  // If the message names more than one distinct flight number, don't guess —
  // return null so the bot asks the traveler which flight number is correct.
  if (distinct.length > 1) return null;
  return distinct[0];
}

/**
 * True when a message is CLEARLY a new flight report / a different flight —
 * used mid-PNR-verification to tell "the traveler switched to another flight"
 * apart from "the traveler is answering with a PNR". Only signals that can
 * never match a PNR-shaped token (ABC123, WRONG12) count:
 *   - isFnolTrigger: a delay/disruption REPORT ("my flight was delayed again",
 *     "southwest 565 was delayed") — never true for a bare PNR token.
 *   - AIRLINE_NAME_FLIGHT: a spelled-out airline name + digits ("southwest
 *     565") — a PNR never contains an airline name.
 * A bare ambiguous token like "SWA565" or "AA200" is intentionally NOT treated
 * as a new flight here: it is shaped exactly like a (wrong) PNR, so mid-PNR it
 * stays a PNR attempt rather than being guessed as a flight switch.
 */
export function isNewFlightReport(message: string): boolean {
  return isFnolTrigger(message) || AIRLINE_NAME_FLIGHT.test(message);
}

/**
 * Policy/plan number: a 10–12 character alphanumeric token containing at least
 * one digit (e.g. 260210RTL08). `exclude` skips the flight number so it can't be
 * mistaken for a policy (it never overlaps on length anyway).
 */
export function extractPolicyNumber(
  message: string,
  exclude?: string | null,
): string | null {
  const candidates = message.match(/\b[A-Za-z0-9]{10,12}\b/g) ?? [];
  for (const candidate of candidates) {
    if (exclude && candidate.toUpperCase() === exclude.toUpperCase()) continue;
    if (!/\d/.test(candidate)) continue; // policy numbers contain digits
    return candidate;
  }
  return null;
}

/**
 * PNR (booking confirmation number): a 5–7 character alphanumeric token
 * containing both a letter and a digit (real PNRs and the demo mocks —
 * ABC123, XYZ789 — are shaped this way; requiring both excludes plain
 * English words like "thanks" from being misread as one). This length range
 * structurally overlaps the flight number shape (2–3 letters + 3–4 digits is
 * 5–7 characters too), so this must only ever be called while confirming a
 * PNR (never alongside extractFlightNumber on the same message), and
 * `excludeFlightNumber` skips a literal restatement of the flight number.
 */
export function extractPnr(
  message: string,
  excludeFlightNumber?: string | null,
): string | null {
  const candidates = message.match(/\b[A-Za-z0-9]{5,7}\b/g) ?? [];
  for (const candidate of candidates) {
    const upper = candidate.toUpperCase();
    if (excludeFlightNumber && upper === excludeFlightNumber.toUpperCase()) continue;
    if (!/[A-Z]/.test(upper) || !/\d/.test(upper)) continue;
    return upper;
  }
  return null;
}

/**
 * True if the message explicitly labels a value as a PNR / confirmation number
 * ("here is my pnr ABC123", "confirmation number ABC123"). Combined with a
 * PNR-shaped token, this is an unambiguous "this is my PNR answer" signal, so
 * the flow routes it straight to PNR verification and NEVER treats the token as
 * a flight number — even if the flow has drifted out of the PNR step.
 */
export function mentionsPnrKeyword(message: string): boolean {
  return /\b(?:pnr|confirmation number|booking number|confirmation code)\b/i.test(
    message,
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Words that are never part of a name (so leftover text isn't mistaken for one).
const NAME_STOPWORDS = new Set([
  'my', 'flight', 'was', 'were', 'is', 'are', 'delayed', 'delay', 'plan',
  'policy', 'number', 'the', 'a', 'an', 'i', 'am', 'name', 'claim', 'trip',
  'on', 'of', 'for', 'please', 'it', 'that', 'this', 'sorry', 'hi', 'hello',
  'and', 'with', 'to', 'no', 'yes', 'its', "it's", 'me', 'our', 'so',
]);

/** Take leading name-like words from a string, stopping at the first stopword. */
function takeNameWords(text: string): string | null {
  const result: string[] = [];
  for (const raw of text.trim().split(/\s+/)) {
    const word = raw.replace(/[^A-Za-z'.-]/g, '');
    if (!word) break;
    if (NAME_STOPWORDS.has(word.toLowerCase())) break;
    if (!/^[A-Za-z][A-Za-z'.-]*$/.test(word)) break;
    result.push(word);
    if (result.length === 4) break;
  }
  return result.length ? result.join(' ') : null;
}

/**
 * Name: text that isn't a flight or policy number. Caught either via explicit
 * phrasing ("I am X", "my name is X") or as leftover capitalized words once the
 * flight/policy tokens are removed.
 */
export function extractName(
  message: string,
  flight?: string | null,
  policy?: string | null,
): string | null {
  const explicit = message.match(
    /\b(?:i\s*am|i'?m|my name is|name is|this is|i'?m called)\s+(.+)/i,
  );
  if (explicit) {
    const candidate = takeNameWords(explicit[1]);
    if (candidate) return candidate;
  }

  let cleaned = message;
  for (const token of [flight, policy]) {
    if (token) cleaned = cleaned.replace(new RegExp(escapeRegExp(token), 'ig'), ' ');
  }
  const capWords = cleaned
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z'.-]/g, ''))
    .filter((w) => /^[A-Z][a-z'.-]+$/.test(w) && !NAME_STOPWORDS.has(w.toLowerCase()));
  if (capWords.length >= 1 && capWords.length <= 4) return capWords.join(' ');

  return null;
}

export interface FnolFields {
  flightNumber: string | null;
  policyNumber: string | null;
  travelerName: string | null;
}

/** Pull every recognizable FNOL field out of a single message. */
export function extractFnolFields(message: string): FnolFields {
  const flightNumber = extractFlightNumber(message);
  const policyNumber = extractPolicyNumber(message, flightNumber);
  const travelerName = extractName(message, flightNumber, policyNumber);
  return { flightNumber, policyNumber, travelerName };
}

export type FnolAction =
  | 'validate'
  | 'ask'
  | 'defer'
  | 'duplicate'
  | 'approve'
  | 'pnr_retry'
  | 'pnr_deflect'
  | 'pnr_missing'
  | 'pnr_orphan';

export interface FnolTransition {
  action: FnolAction;
  flightNumber?: string;
  /** Only set on 'approve' — the confirmed delay length, carried from pendingApproval. */
  delayMinutes?: number;
}

/**
 * True if the message reads like a question or a topic switch, not an answer.
 * Exported (rather than kept private to fnol-handler.ts) so applyPnrMessage
 * below can no-op on a stray question during replay exactly the way
 * handleFnolTurn defers to the model on a live turn — otherwise a question
 * that happens to contain a PNR-shaped token could get misread as a (wrong)
 * PNR attempt during replay even though the live turn never touched it.
 */
export function looksLikeQuestion(message: string): boolean {
  const lower = message.trim().toLowerCase();
  // A question mark anywhere signals a question, even mid-sentence — real
  // people trail off after it ("wait is that long enough to count? it felt
  // like forever"), so anchoring to the end (endsWith) misses these.
  if (lower.includes('?')) return true;
  // A question word at the start, after stripping any leading filler /
  // interjections — "ok what do you need from me", "so how much do i get",
  // "wait is that enough" all open with a question once the filler is removed.
  const withoutFiller = lower.replace(
    /^(?:(?:ok|okay|so|well|hey|hi|hello|um+|uh+|hmm+|wait|alright|right|yeah|yea|yep|nah|and|but|please|actually)\b[\s,.!]*)+/,
    '',
  );
  if (
    /^(what|how|can|could|do|does|did|is|are|was|were|will|would|should|show|tell|why|who|when|where|which)\b/.test(
      withoutFiller,
    )
  ) {
    return true;
  }
  // Topic-switch / deflection signals anywhere in the message.
  if (/\b(forget|ignore|skip|instead|go back|actually)\b/.test(lower)) return true;
  if (lower.includes('what is the maximum')) return true;
  return false;
}

/**
 * Mid-verification turn (state.step === 'confirming_pnr'): read the message as
 * a PNR answer only — never re-run flight/date extraction on it. The demo
 * mock PNRs (ABC123, XYZ789) are shaped exactly like flight numbers, so
 * evaluating both extractors against the same message here would be
 * ambiguous. Approval (and the claimedFlights write) only happens once BOTH
 * the delay already confirmed in validateFlight AND this PNR check pass.
 */
function applyPnrMessage(state: FnolState, message: string): FnolTransition {
  const pending = state.pendingApproval!;
  const pnr = extractPnr(message, pending.flightNumber);

  // A stray question/topic-switch with no PNR in it never counts as a PNR
  // attempt — no state mutation, same as the live handler deferring to the
  // model. (A PNR phrased as a question, e.g. "is it ABC123?", still verifies.)
  // This condition MUST stay in lockstep with the confirming_pnr gate in
  // handleFnolTurn so a live turn and history replay reach the same state.
  if (!pnr) {
    return { action: 'pnr_missing', flightNumber: pending.flightNumber };
  }

  const result = verifyBooking(pending.flightNumber, pnr);
  if (result.verified) {
    state.step = 'complete';
    state.outcome = 'approved';
    state.collectedInfo.pnr = pnr;
    // Only APPROVED (delay qualified AND PNR matched) flights are recorded as
    // claimed, so they can't be claimed again.
    state.claimedFlights = [...(state.claimedFlights ?? []), pending.flightNumber];
    const { flightNumber, delayMinutes } = pending;
    state.pendingApproval = undefined;
    return { action: 'approve', flightNumber, delayMinutes };
  }

  const attempts = state.pnrAttempts ?? 0;
  if (attempts < 1) {
    state.pnrAttempts = attempts + 1;
    return { action: 'pnr_retry', flightNumber: pending.flightNumber };
  }

  state.step = 'error';
  state.outcome = 'error';
  state.pendingApproval = undefined;
  return { action: 'pnr_deflect', flightNumber: pending.flightNumber };
}

/**
 * Pure transition for ONE message. Mutates `state` (activates, resets, merges
 * extracted fields) and returns what the caller should do:
 *   - 'validate':     a flight number is present (and new) — run the delay
 *                      lookup.
 *   - 'ask':          fields still missing — ask for what's left.
 *   - 'defer':        nothing for the FNOL flow to do — fall through to the model.
 *   - 'duplicate':    this flight was already approved this session.
 *   - 'approve':      the PNR just verified — the claim is now approved.
 *   - 'pnr_retry':    the PNR didn't match; one retry left.
 *   - 'pnr_deflect':  the PNR didn't match twice; deflect to human review.
 *   - 'pnr_missing':  mid-verification and no PNR-shaped token in the message.
 *   - 'pnr_orphan':   an explicit PNR was given but there's no confirmed-delayed
 *                      flight to attach it to — ask which flight it's for.
 *
 * Shared by handleFnolTurn (acts on the result) and the route's history replay
 * (just mutates state) so the two can never drift. The one non-pure step —
 * the flight-status lookup itself — can't live here (it's async); see
 * applyFlightValidationResult below, which both callers use identically once
 * they've awaited it, so that step can't drift either. The PNR check
 * (verifyBooking) IS synchronous, so it and the claimedFlights write live
 * entirely inside this function via applyPnrMessage above.
 */
export function applyFnolMessage(state: FnolState, message: string): FnolTransition {
  // PNR keyword fast-path: an explicit "here is my pnr ABC123" is ALWAYS a PNR
  // answer, never a flight number — even if the flow has drifted out of the PNR
  // step (e.g. after switching to a second flight and coming "back to the first
  // one"). Route it straight to PNR verification for the correct flight.
  if (mentionsPnrKeyword(message)) {
    // Actively confirming a PNR → normal verification against the pending flight
    // (keeps the retry/deflect/approve/missing behaviour intact).
    if (state.active && state.step === 'confirming_pnr' && state.pendingApproval) {
      return applyPnrMessage(state, message);
    }
    // Drifted out of confirming_pnr. Exclude any flight number named in the same
    // message ("my pnr for SWA566 is ABC123") so the flight isn't mistaken for
    // the PNR, then re-attach the PNR to the flight it actually belongs to.
    const excludeFlight =
      extractFlightNumber(message) ?? state.collectedInfo.flightNumber ?? null;
    const pnr = extractPnr(message, excludeFlight);
    if (pnr) {
      const owner = findBookingFlightByPnr(pnr);
      if (owner) {
        // Already approved → duplicate, never a second approval.
        if ((state.claimedFlights ?? []).includes(owner)) {
          return { action: 'duplicate', flightNumber: owner };
        }
        // Approve ONLY if this flight's qualifying delay was already confirmed
        // this session. This is the hard stop: a matching PNR alone must never
        // approve a flight that never qualified (e.g. XYZ789 → on-time SWA565).
        const delayMinutes = state.qualifiedFlights?.[owner];
        if (delayMinutes !== undefined && verifyBooking(owner, pnr).verified) {
          state.step = 'complete';
          state.outcome = 'approved';
          state.collectedInfo.flightNumber = owner;
          state.collectedInfo.pnr = pnr;
          state.claimedFlights = [...(state.claimedFlights ?? []), owner];
          state.pendingApproval = undefined;
          state.pnrAttempts = undefined;
          return { action: 'approve', flightNumber: owner, delayMinutes };
        }
      }
      // A PNR was given but there's no confirmed-delayed flight to attach it to
      // (unknown PNR, or its flight was never checked / didn't qualify). Ask
      // which flight it's for — and never treat the PNR token as a flight number.
      return { action: 'pnr_orphan' };
    }
    // Keyword but no PNR-shaped token (e.g. "what is a pnr?") → normal handling.
  }

  if (state.active && state.step === 'confirming_pnr' && state.pendingApproval) {
    // While confirming a PNR, a message that is CLEARLY a new flight report or a
    // different flight (not a PNR answer) means the traveler has moved on to a
    // different flight — often after a long mid-flow detour. Abandon the pending
    // PNR and fall through to normal intake so the new flight is handled fresh,
    // instead of staying stuck answering "I still need the PNR" forever.
    // isNewFlightReport only matches signals that can never be a PNR-shaped
    // token (a delay report, or a spelled-out airline name), so a genuine PNR
    // answer (ABC123, WRONG12) still verifies via applyPnrMessage below.
    if (!isNewFlightReport(message)) {
      return applyPnrMessage(state, message);
    }
    state.step = 'collecting';
    state.pendingApproval = undefined;
    state.pnrAttempts = undefined;
    // fall through to the normal intake handling below with the PNR abandoned.
  }

  const trigger = isFnolTrigger(message);
  const fields = extractFnolFields(message);

  // A fresh trigger that names NO new flight number, when the current flight is
  // already an approved claim, is a re-file of that same claim (e.g. "my flight
  // was delayed" again after SWA566 was approved). Return the duplicate BEFORE
  // the reset branch below wipes collectedInfo.flightNumber — otherwise the
  // duplicate check further down (which needs that number to match
  // claimedFlights) is never reached and we'd ask for the flight from scratch,
  // as if the claim were never filed. A NEW flight number in the message skips
  // this and falls through to a normal new-claim intake. Returns without
  // mutating state, so history replay stays consistent with a live turn.
  //
  // GUARD: only a genuine re-file REPORT counts — never a question or
  // hypothetical asked while a flight happens to be claimed (e.g. "if my flight
  // gets delayed again on a future trip, will that be covered?"). Those are not
  // re-filing attempts; they must fall through and defer to the model, not get
  // the scripted duplicate-claim reply. looksLikeQuestion catches the "?" and
  // question/topic-switch phrasings; isFnolTrigger already rejects leading
  // conditionals, so both layers must agree before we treat this as a re-file.
  const currentFlight = state.collectedInfo.flightNumber;
  if (
    state.active &&
    trigger &&
    !looksLikeQuestion(message) &&
    !fields.flightNumber &&
    currentFlight &&
    (state.claimedFlights ?? []).includes(currentFlight)
  ) {
    return { action: 'duplicate', flightNumber: currentFlight };
  }

  if (!state.active) {
    if (!trigger) return { action: 'defer' };
    // Begin a new intake.
    state.active = true;
    state.step = 'collecting';
    state.collectedInfo = {};
    state.outcome = undefined;
    state.pendingApproval = undefined;
    state.pnrAttempts = undefined;
  } else if (
    (trigger || fields.flightNumber) &&
    state.collectedInfo.flightNumber !== undefined
  ) {
    // Fresh trigger, OR a message naming a flight number, after a flight was
    // already provided/validated: start a new intake, carrying forward name +
    // policy so we only ask for the new flight number. Clear the old flight;
    // claimedFlights is PRESERVED so an already-approved flight can't be claimed
    // again, even when its number arrives in a later turn. (Keyed off
    // collectedInfo.flightNumber, not claimedFlights, because a
    // not-delayed/not-found flight is never added to claimedFlights.)
    //
    // Including `fields.flightNumber` here is what lets a DIFFERENT flight named
    // right after a duplicate-claim reply ("that one's on file — got another?")
    // start cleanly as a fresh claim (stale outcome/pendingApproval/pnrAttempts
    // cleared) rather than lingering on the already-claimed flight. The SAME
    // flight named again still falls through to the duplicate check below, so a
    // repeat of the approved flight is still caught, not re-validated.
    state.step = 'collecting';
    state.collectedInfo = {
      travelerName: state.collectedInfo.travelerName,
      policyNumber: state.collectedInfo.policyNumber,
    };
    state.outcome = undefined;
    state.pendingApproval = undefined;
    state.pnrAttempts = undefined;
  }

  // Merge whatever this message contained. The flight number may be corrected
  // (overwrite); name/policy are kept once captured.
  if (fields.flightNumber) state.collectedInfo.flightNumber = fields.flightNumber;
  if (fields.policyNumber && !state.collectedInfo.policyNumber) {
    state.collectedInfo.policyNumber = fields.policyNumber;
  }
  if (fields.travelerName && !state.collectedInfo.travelerName) {
    state.collectedInfo.travelerName = fields.travelerName;
  }

  const flight = state.collectedInfo.flightNumber;
  if (flight) {
    const claimed = state.claimedFlights ?? [];
    // Only an APPROVED flight is in claimedFlights — block re-claiming it (a
    // 'duplicate' is handled with a scripted message, not deferred to the model
    // which would re-approve). A not-delayed/not-found flight is NOT in
    // claimedFlights, so it falls through to 'validate' and can be re-tried.
    // claimedFlights is populated only on approval — via applyPnrMessage above,
    // whether on a live turn or reconstructed during replay in
    // deriveFnolStateFromHistory.
    if (claimed.includes(flight)) {
      return { action: 'duplicate', flightNumber: flight };
    }
  }

  if (flight) {
    return { action: 'validate', flightNumber: flight };
  }

  state.step = 'collecting';
  return { action: 'ask' };
}

export interface FlightValidationOutcome {
  found: boolean;
  isDelayed: boolean;
  delayMinutes: number | null;
}

/**
 * Apply the result of an (async) flight-status lookup to state, for a flight
 * number that applyFnolMessage() just signalled via action: 'validate'.
 * Shared by fnol-handler's validateFlight (live turn) and the route's
 * deriveFnolStateFromHistory (replay), so the two can never drift: a live
 * turn and a replayed turn must reach the identical state for the same
 * history.
 *   - not found, or delayed < 6h: terminal decline. Does NOT transition to
 *     confirming_pnr and does NOT touch claimedFlights — the PNR is never
 *     requested in this case.
 *   - delayed >= 6h: moves to 'confirming_pnr' and stashes the delay data in
 *     pendingApproval AND records the flight in qualifiedFlights (so a PNR given
 *     later, after the flow drifts, can still be re-attached to it). claimedFlights
 *     is NOT written yet — that only happens once the PNR also verifies.
 */
export function applyFlightValidationResult(
  state: FnolState,
  flightNumber: string,
  result: FlightValidationOutcome,
): 'not_found' | 'not_delayed' | 'qualifying' {
  if (!result.found) {
    state.step = 'error';
    state.outcome = 'not_found';
    return 'not_found';
  }
  if (!result.isDelayed) {
    state.step = 'not_delayed';
    state.outcome = 'not_delayed';
    return 'not_delayed';
  }
  const delayMinutes = result.delayMinutes ?? 0;
  state.step = 'confirming_pnr';
  state.outcome = undefined;
  state.pnrAttempts = 0;
  state.pendingApproval = { flightNumber, delayMinutes };
  // Remember this flight qualified, even if its PNR step is later abandoned, so
  // a PNR supplied after a detour can be re-attached to it (see the PNR keyword
  // fast-path in applyFnolMessage). Never cleared; rebuilt on replay.
  state.qualifiedFlights = { ...(state.qualifiedFlights ?? {}), [flightNumber]: delayMinutes };
  return 'qualifying';
}
