import { checkFlightStatus } from '@/lib/flight/flight-status';
import {
  applyFnolMessage,
  applyFlightValidationResult,
  isFnolTrigger,
  isNewFlightReport,
  extractFlightNumber,
  extractPnr,
  looksLikeQuestion,
} from '@/lib/fnol/fnol-state';
import type { FnolState, FnolCollectedInfo } from '@/lib/fnol/fnol-state';

export interface FnolHandlerResult {
  handled: boolean;
  response?: string;
  updatedState: FnolState;
}

// Trip Delay benefit terms, straight from the FlexiPAX docs:
//  - Plan Document Schedule of Benefits: "$150 per day"
//  - This traveler's Confirmation of Benefits: purchased max of $1,500
// The benefit reimburses reasonable additional expenses up to $150/day, capped
// at the plan maximum. We can't know actual expenses here, so we compute the
// maximum entitlement for the confirmed delay length.
const TRIP_DELAY_PER_DIEM = 150;
const TRIP_DELAY_MAX = 1500;
const MINUTES_PER_DAY = 1440;
const TRIP_DELAY_MIN_MINUTES = 360; // 6 consecutive hours

/** Human-readable delay, e.g. 412 -> "6 hours 52 minutes". */
function formatDelay(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  return parts.join(' ') || '0 minutes';
}

/** Whole days of delay (the $150/day unit), at least 1 once the 6h trigger is met. */
function delayDays(totalMinutes: number): number {
  return Math.max(1, Math.ceil(totalMinutes / MINUTES_PER_DAY));
}

/** Join a list naturally: ["a","b","c"] -> "a, b, and c". */
function humanList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * Fields still missing from the collected info (used to ask only what's needed).
 * The traveler's name and policy number are already on file from the
 * Confirmation of Benefits, so the flight number is the only field we collect.
 */
function missingFields(info: FnolCollectedInfo): string[] {
  const missing: string[] = [];
  if (!info.flightNumber) {
    missing.push('your flight number (for example, SWA566)');
  }
  return missing;
}

/** Ask only for the fields that are still missing (just the flight number). */
function buildAskPrompt(info: FnolCollectedInfo, opening: boolean): string {
  if (opening) {
    return 'I am sorry to hear that. Could you please share your flight number?';
  }
  const ask = humanList(missingFields(info));
  return `Thanks! I just need ${ask}.`;
}

/**
 * Run the flight-status lookup for a flight number + date and build the
 * scripted response.
 *   - Not found, or delayed less than 6h: terminal decline. The PNR is never
 *     requested in this case — this is the hard stop.
 *   - Delayed 6h+: reports the delay and asks for the PNR; approval (and the
 *     dollar amount / claimedFlights write) happens in confirmPnrAndFinalize,
 *     only once the PNR also checks out.
 */
async function validateFlight(
  state: FnolState,
  flightNumber: string,
): Promise<FnolHandlerResult> {
  const result = await checkFlightStatus(flightNumber);
  const outcome = applyFlightValidationResult(state, flightNumber, result);

  if (outcome === 'not_found') {
    return {
      handled: true,
      updatedState: state,
      response: `I wasn't able to find flight ${flightNumber} in our system. Could you double-check the flight number? The flight number should be the airline code followed by the flight digits, for example SWA566.

If you believe this is correct, please contact TII directly at [1-800-243-3174](tel:+18002433174) (weekdays 8:00 AM – 6:00 PM ET).`,
    };
  }

  if (outcome === 'not_delayed') {
    return {
      handled: true,
      updatedState: state,
      response: `I checked flight ${flightNumber} and it does not currently show a qualifying delay of 6 hours or more, which is the minimum threshold for a Trip Delay claim under your FlexiPAX plan.

Could you verify the flight number? If you believe this is an error, please contact TII directly at [1-800-243-3174](tel:+18002433174) (weekdays 8:00 AM – 6:00 PM ET).`,
    };
  }

  // 'qualifying': report the delay and ask for the PNR. Floor the delay at the
  // 6-hour trigger so the wording never contradicts the eligibility.
  const delayMinutes = Math.max(state.pendingApproval?.delayMinutes ?? 0, TRIP_DELAY_MIN_MINUTES);
  return {
    handled: true,
    updatedState: state,
    response: `Great news — flight ${flightNumber} is confirmed delayed ${formatDelay(delayMinutes)}, which meets your plan's 6-consecutive-hour Trip Delay requirement.

To verify this claim, could you provide the PNR (booking confirmation number) on your reservation?`,
  };
}

/**
 * Build the dollar-amount approval message for a confirmed qualifying delay.
 * Shared by confirmPnrAndFinalize (the only caller, now that approval waits
 * on the PNR) so the wording matches what travelers saw pre-PNR-verification.
 */
function buildApprovalMessage(flightNumber: string, delayMinutesRaw: number): string {
  const delayMinutes = Math.max(delayMinutesRaw, TRIP_DELAY_MIN_MINUTES);
  const days = delayDays(delayMinutes);
  const eligibleAmount = Math.min(days * TRIP_DELAY_PER_DIEM, TRIP_DELAY_MAX);

  return `Thanks — that PNR matches our records for flight ${flightNumber}.

Under your FlexiPAX plan, Trip Delay reimburses your reasonable additional expenses and additional transportation costs at up to $${TRIP_DELAY_PER_DIEM} per day, up to your $${TRIP_DELAY_MAX.toLocaleString('en-US')} maximum. For a delay of this length (${days} day${days === 1 ? '' : 's'}), you're eligible for up to $${eligibleAmount.toLocaleString('en-US')}.

Your Trip Delay claim is now in process and should be approved within the next 30 minutes. If you have not received your payout via virtual debit card on your OZZI app, check your email or please contact us at [1-800-243-3174](tel:+18002433174) or reach out in this chat.`;
}

/**
 * Dynamic FNOL turn. Runs the pure transition (applyFnolMessage) once, then
 * builds the scripted response for whatever it returned:
 *  - PNR-phase outcomes (pnr_missing / pnr_retry / pnr_deflect / approve) when
 *    the message was a PNR answer to a claim awaiting verification;
 *  - validate once a flight number is present;
 *  - duplicate for an already-approved flight;
 *  - ask for the fields still missing;
 *  - otherwise defers to the model.
 *
 * applyFnolMessage owns the confirming_pnr branch internally: a PNR answer is
 * verified there, but a CLEAR new flight report mid-PNR (isNewFlightReport)
 * abandons the pending PNR and re-enters normal intake — so this function sees
 * a normal action (validate / ask / duplicate) in that case, not a PNR one.
 */
export async function handleFnolTurn(
  state: FnolState,
  userMessage: string,
): Promise<FnolHandlerResult> {
  // A trigger message opens a (possibly fresh) intake — show the warm opener.
  const opening = isFnolTrigger(userMessage);

  // Mid-PNR-verification: an unrelated question with NO PNR in it defers to the
  // model BEFORE applyFnolMessage touches state, so it is never misread as a
  // (wrong) PNR attempt and never burns a retry. Same deflection behavior as
  // the 'ask' branch below — the model answers it, and the PNR prompt resumes
  // next turn since state is rebuilt from history. A PNR phrased as a question
  // ("is it ABC123?") still falls through to verification. A clear new flight
  // report phrased as a question ("can you check southwest 565?") is NOT
  // deferred here — isNewFlightReport excludes it so applyFnolMessage handles
  // the flight switch, keeping this in lockstep with the confirming_pnr branch
  // in applyFnolMessage (fnol-state.ts) so live and history replay never drift.
  if (
    state.step === 'confirming_pnr' &&
    looksLikeQuestion(userMessage) &&
    extractPnr(userMessage, state.pendingApproval?.flightNumber) === null &&
    !isNewFlightReport(userMessage)
  ) {
    return { handled: false, updatedState: state };
  }

  const { action, flightNumber, delayMinutes } = applyFnolMessage(state, userMessage);

  // PNR-phase outcomes (only returned while confirming a PNR with a PNR answer).
  if (action === 'pnr_missing') {
    return {
      handled: true,
      updatedState: state,
      response: `I still need the PNR (booking confirmation number) on your reservation to verify this claim — could you share that?`,
    };
  }
  if (action === 'pnr_retry') {
    return {
      handled: true,
      updatedState: state,
      response: `No data found for that PNR for flight ${flightNumber}. Could you please double check the PNR or confirmation number and try again?`,
    };
  }
  if (action === 'pnr_deflect') {
    return {
      handled: true,
      updatedState: state,
      response: `I wasn't able to verify that PNR against our records for flight ${flightNumber}. Please contact TII directly at [1-800-243-3174](tel:+18002433174) (weekdays 8:00 AM – 6:00 PM ET) so a specialist can complete this manually.`,
    };
  }
  if (action === 'approve') {
    return {
      handled: true,
      updatedState: state,
      response: buildApprovalMessage(flightNumber!, delayMinutes ?? TRIP_DELAY_MIN_MINUTES),
    };
  }
  if (action === 'pnr_orphan') {
    // A PNR was given but we have no confirmed-delayed flight to attach it to.
    // Ask which flight it's for — never look the PNR up as a flight number, and
    // never echo the reference back.
    return {
      handled: true,
      updatedState: state,
      response: `Thanks — it looks like that's your booking reference. Which flight is it for? If you share the flight number, I can look it up and check the delay.`,
    };
  }

  if (action === 'validate' && flightNumber) {
    // Only run the lookup when THIS message actually names a flight number. The
    // server is stateless — FNOL state is rebuilt from history every request —
    // so a flight number with no new number in the current message is one that
    // was already validated on an earlier turn (and, when not delayed / not
    // found, was never recorded in claimedFlights). Re-validating it would loop
    // the same not-delayed / not-found scripted reply forever. Defer instead so
    // the model can answer the follow-up. Mirrors the 'duplicate' guard below.
    if (extractFlightNumber(userMessage) === null) {
      return { handled: false, updatedState: state };
    }
    return validateFlight(state, flightNumber);
  }

  // Same flight already claimed this session: respond with a scripted message
  // (handled, no model call) so it is never re-approved. Defer to the model
  // ONLY for a non-trigger follow-up that names no flight number (e.g. a
  // post-approval "how long until I get paid") — there the 'duplicate' came
  // from a flight still carried in state, not a genuine re-file, so let the
  // model answer. A fresh trigger (opening) IS a re-file attempt even when it
  // doesn't repeat the number ("my flight was delayed" again after approval),
  // so show the scripted duplicate reply rather than starting over.
  if (action === 'duplicate' && flightNumber) {
    if (!opening && extractFlightNumber(userMessage) === null) {
      return { handled: false, updatedState: state };
    }
    return {
      handled: true,
      updatedState: state,
      response: `Your Trip Delay claim for flight ${flightNumber} is already on file and being processed — there's no need to file it again. If you have a different flight that was also delayed, please share that flight number and I can check it for you.`,
    };
  }

  if (action === 'ask') {
    // If the traveler asks an unrelated question mid-intake (rather than giving
    // the next field), hand it to the model so they actually get an answer. The
    // intake resumes next turn because state is rebuilt from history. Don't
    // intercept the opening trigger — that should still start the claim.
    if (!opening && looksLikeQuestion(userMessage)) {
      return { handled: false, updatedState: state };
    }
    return {
      handled: true,
      updatedState: state,
      response: buildAskPrompt(state.collectedInfo, opening),
    };
  }

  // 'defer': not an FNOL message, or a flight already validated with no new
  // information — let the model handle it.
  return { handled: false, updatedState: state };
}
