export interface FnolCollectedInfo {
  flightNumber?: string;
  travelerName?: string;
  policyNumber?: string;
}

export type FnolStep =
  | 'idle'
  | 'collecting'
  | 'complete'
  | 'not_delayed'
  | 'error';

export interface FnolState {
  active: boolean;
  step: FnolStep;
  collectedInfo: FnolCollectedInfo;
  /** Flight numbers already validated this session — prevents claiming twice. */
  claimedFlights?: string[];
  outcome?: 'approved' | 'not_delayed' | 'not_found' | 'error';
}

export function initialFnolState(): FnolState {
  return { active: false, step: 'idle', collectedInfo: {} };
}

/**
 * True if the message looks like the start of a flight-delay / Trip Delay claim.
 */
export function isFnolTrigger(message: string): boolean {
  const text = message.toLowerCase();
  // "flight" and "delay(ed)" near each other, in either order, tolerating a
  // flight number or other words in between (e.g. "my flight SWA566 was delayed").
  if (/\bflight\b[\s\S]{0,40}delay/.test(text)) return true;
  if (/delay\w*[\s\S]{0,40}\bflight\b/.test(text)) return true;
  // "late" phrasings (e.g. "SWA566 was late by 7 hours"), which don't use the
  // word "delay".
  if (
    /\b(?:was late|flight late|plane was late|plane is late|got delayed|got late)\b/.test(
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
 * Flight number: 2–3 letters + 3–4 digits (e.g. SWA566, AA100). Uppercased.
 * Tolerates spaces inside the flight number ("SWA 566", "SWA 5 6 6") by
 * collapsing them before the strict pattern runs.
 */
export function extractFlightNumber(message: string): string | null {
  // Preprocess: in a "letters + (spaced) digits" run, strip the spaces so
  // "SWA 5 6 6" / "SWA 566" become "SWA566".
  const normalized = message.replace(
    /\b([A-Za-z]{2,3})((?:\s*\d){3,4})\b/g,
    (_match, letters: string, digits: string) =>
      letters + digits.replace(/\s+/g, ""),
  );
  const matches = normalized.match(/\b[A-Z]{2,3}\d{3,4}\b/gi);
  if (!matches) return null;
  const distinct = [...new Set(matches.map((m) => m.toUpperCase()))];
  // If the message names more than one distinct flight number, don't guess —
  // return null so the bot asks the traveler which flight number is correct.
  if (distinct.length > 1) return null;
  return distinct[0];
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

export type FnolAction = 'validate' | 'ask' | 'defer' | 'duplicate';

/**
 * Pure transition for ONE message. Mutates `state` (activates, resets, merges
 * extracted fields) and returns what the caller should do:
 *   - 'validate': a flight number is present (and new) — run the lookup.
 *   - 'ask':      no flight number yet — ask for the still-missing fields.
 *   - 'defer':    nothing for the FNOL flow to do — fall through to the model.
 *
 * Shared by handleFnolTurn (acts on the result) and the route's history replay
 * (just mutates state) so the two can never drift.
 */
export function applyFnolMessage(
  state: FnolState,
  message: string,
): { action: FnolAction; flightNumber?: string } {
  const trigger = isFnolTrigger(message);
  const fields = extractFnolFields(message);

  if (!state.active) {
    if (!trigger) return { action: 'defer' };
    // Begin a new intake.
    state.active = true;
    state.step = 'collecting';
    state.collectedInfo = {};
    state.outcome = undefined;
  } else if (trigger && state.collectedInfo.flightNumber !== undefined) {
    // Fresh trigger after a flight was already provided/validated: start a new
    // intake, carrying forward name + policy so we only ask for the new flight
    // number. Clear the old flight; claimedFlights is PRESERVED so an already-
    // approved flight can't be claimed again, even when its number arrives in a
    // later turn. (Keyed off collectedInfo.flightNumber, not claimedFlights,
    // because a not-delayed/not-found flight is never added to claimedFlights.)
    state.step = 'collecting';
    state.collectedInfo = {
      travelerName: state.collectedInfo.travelerName,
      policyNumber: state.collectedInfo.policyNumber,
    };
    state.outcome = undefined;
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
    // claimedFlights is populated only on approval — in validateFlight, and
    // reconstructed during replay in deriveFnolStateFromHistory.
    if (claimed.includes(flight)) {
      return { action: 'duplicate', flightNumber: flight };
    }
    return { action: 'validate', flightNumber: flight };
  }

  state.step = 'collecting';
  return { action: 'ask' };
}
