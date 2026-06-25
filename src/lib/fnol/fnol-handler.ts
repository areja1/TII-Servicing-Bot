import { checkFlightStatus } from '@/lib/flight/flight-status';
import { applyFnolMessage, isFnolTrigger, extractFlightNumber } from '@/lib/fnol/fnol-state';
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

/** Fields still missing from the collected info (used to ask only what's needed). */
function missingFields(info: FnolCollectedInfo): string[] {
  const missing: string[] = [];
  if (!info.travelerName) missing.push('your full name');
  if (!info.policyNumber) missing.push('your policy or plan number');
  if (!info.flightNumber) missing.push('your flight number (for example, SWA566)');
  return missing;
}

/** Ask only for the fields that are still missing. */
function buildAskPrompt(info: FnolCollectedInfo, opening: boolean): string {
  const ask = humanList(missingFields(info));
  // Returning traveler whose name and policy are already on file (e.g. a fresh
  // trigger after an approved claim): skip the apology/"To begin" opener and
  // just ask for the new flight number.
  if (opening && info.travelerName && info.policyNumber) {
    return `Of course — could you share ${ask}?`;
  }
  if (opening) {
    return `I'm sorry to hear your flight was delayed — let's get your Trip Delay claim started. To begin, could you share ${ask}?`;
  }
  return `Thanks! I just need ${ask}.`;
}

/**
 * Run the flight-status lookup and build the terminal scripted response.
 * The flight number is the ONLY input needed — no delay duration or reason.
 */
async function validateFlight(
  state: FnolState,
  flightNumber: string,
): Promise<FnolHandlerResult> {
  const result = await checkFlightStatus(flightNumber);

  if (result.found === false) {
    state.step = 'error';
    state.outcome = 'not_found';
    return {
      handled: true,
      updatedState: state,
      response: `I wasn't able to find flight ${flightNumber} in our system. Could you double-check the flight number? It should be the airline code followed by the flight digits, for example SWA566.

If you believe this is correct, please contact TII directly at [1-800-243-3174](tel:+18002433174) (weekdays 8:00 AM – 6:00 PM ET).`,
    };
  }

  if (result.isDelayed === false) {
    state.step = 'not_delayed';
    state.outcome = 'not_delayed';
    return {
      handled: true,
      updatedState: state,
      response: `I checked flight ${flightNumber} and it does not currently show a qualifying delay of 6 hours or more, which is the minimum threshold for a Trip Delay claim under your FlexiPAX plan.

Could you verify the flight number? If you believe this is an error, please contact TII directly at [1-800-243-3174](tel:+18002433174) (weekdays 8:00 AM – 6:00 PM ET).`,
    };
  }

  // Delayed past the 6-hour minimum: approve and compute the doc-grounded amount.
  state.step = 'complete';
  state.outcome = 'approved';
  // Only APPROVED flights are recorded as claimed, so they can't be claimed
  // again; not-delayed / not-found flights stay re-tryable.
  state.claimedFlights = [...(state.claimedFlights ?? []), flightNumber];

  // Maximum entitlement as per the docs: $150/day for the confirmed delay,
  // capped at the $1,500 plan maximum. Floor the delay at the 6-hour trigger so
  // the wording never contradicts the eligibility.
  const delayMinutes = Math.max(result.delayMinutes ?? 0, TRIP_DELAY_MIN_MINUTES);
  const days = delayDays(delayMinutes);
  const eligibleAmount = Math.min(days * TRIP_DELAY_PER_DIEM, TRIP_DELAY_MAX);

  return {
    handled: true,
    updatedState: state,
    response: `Great news — flight ${flightNumber} is confirmed delayed ${formatDelay(delayMinutes)}, which meets your plan's 6-consecutive-hour Trip Delay requirement.

Under your FlexiPAX plan, Trip Delay reimburses your reasonable additional expenses and additional transportation costs at up to $${TRIP_DELAY_PER_DIEM} per day, up to your $${TRIP_DELAY_MAX.toLocaleString('en-US')} maximum. For a delay of this length (${days} day${days === 1 ? '' : 's'}), you're eligible for up to $${eligibleAmount.toLocaleString('en-US')}.

Your Trip Delay claim is now in process and should be approved within the next 30 minutes. If you have not received your payout via virtual debit card by then, please contact us again at [1-800-243-3174](tel:+18002433174) or reach out in this chat.`,
  };
}

/**
 * Dynamic FNOL turn. Extracts whatever fields are in the message, then:
 *  - validates immediately once a flight number is present (any turn, any order);
 *  - otherwise asks only for the fields still missing;
 *  - otherwise defers to the model.
 */
/** True if the message reads like a question or a topic switch, not an answer. */
function looksLikeQuestion(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.endsWith('?')) return true;
  if (/^(what|how|can|do|does|is|are|show|tell|why|who)\b/i.test(trimmed)) return true;
  // Topic-switch / deflection signals anywhere in the message.
  const lower = trimmed.toLowerCase();
  if (/\b(forget|ignore|skip|instead|go back|actually)\b/.test(lower)) return true;
  if (lower.includes('what is the maximum')) return true;
  return false;
}

export async function handleFnolTurn(
  state: FnolState,
  userMessage: string,
): Promise<FnolHandlerResult> {
  // A trigger message opens a (possibly fresh) intake — show the warm opener.
  const opening = isFnolTrigger(userMessage);

  const { action, flightNumber } = applyFnolMessage(state, userMessage);

  if (action === 'validate' && flightNumber) {
    return validateFlight(state, flightNumber);
  }

  // Same flight already claimed this session: respond with a scripted message
  // (handled, no model call) so it is never re-approved. Only fire when THIS
  // message actually names a flight number — otherwise the 'duplicate' came
  // from a flight still carried in state (e.g. a post-approval follow-up like
  // "how long until I get paid"), so defer and let the model answer.
  if (action === 'duplicate' && flightNumber) {
    if (extractFlightNumber(userMessage) === null) {
      return { handled: false, updatedState: state };
    }
    return {
      handled: true,
      updatedState: state,
      response: `Your Trip Delay claim for flight ${flightNumber} is already on file and being processed — there's no need to file it again. If you haven't received your payout via virtual debit card yet, you can reach us at [1-800-243-3174](tel:+18002433174).`,
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
