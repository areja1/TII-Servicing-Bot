import { TII_CONTACTS } from "@/config/tii";

/**
 * Lightweight backend (deterministic) guardrail layer that complements the
 * prompt-level guardrails. These checks run before and after the model call
 * so the most safety-critical behaviors do not rely on the model alone.
 */

/** Phrases that strongly indicate an emergency / time-sensitive medical need. */
const EMERGENCY_PATTERNS = [
  /\bemergency\b/i,
  /\bevacuat/i,
  /\bambulance\b/i,
  /\blife[-\s]?threatening\b/i,
  /\bhospitaliz/i,
  /\bstranded\b/i,
];

/** Phrases asking for a claim outcome the bot must never guarantee. */
const CLAIM_OUTCOME_PATTERNS = [
  /\b(will|would|can)\b.*\bclaim\b.*\b(approv|pay|cover|denied|reject)/i,
  /\bapprove(d)?\b.*\bclaim\b/i,
  /\bis (this|that|it) covered\b/i,
];

export interface GuardrailSignal {
  isEmergency: boolean;
  asksClaimOutcome: boolean;
}

export function analyzeUserMessage(message: string): GuardrailSignal {
  return {
    isEmergency: EMERGENCY_PATTERNS.some((re) => re.test(message)),
    asksClaimOutcome: CLAIM_OUTCOME_PATTERNS.some((re) => re.test(message)),
  };
}

/**
 * Extra instruction injected into the system prompt when a guardrail signal
 * fires, reinforcing the correct behavior for that turn.
 */
export function guardrailDirective(signal: GuardrailSignal): string {
  const parts: string[] = [];
  if (signal.isEmergency) {
    parts.push(
      `The traveler may be describing an urgent situation. Lead your answer by directing them to the 24/7 assistance line ${TII_CONTACTS.emergencyAssistance.tollFreeUsCanada} (or collect ${TII_CONTACTS.emergencyAssistance.collect}), and note that emergency medical evacuation must be pre-authorized.`,
    );
  }
  if (signal.asksClaimOutcome) {
    parts.push(
      `The traveler is asking about a claim outcome. You MUST decline to guarantee approval or denial, and explain that claims are subject to the plan terms, required documentation, and a complete review by TII.`,
    );
  }
  return parts.join(" ");
}
