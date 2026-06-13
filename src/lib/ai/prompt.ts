import { buildCoreInstructions } from "@/lib/ai/grounding-rules";
import { SOURCE_LABELS, SOURCE } from "@/config/tii";
import type { CobFields } from "@/config/cob-fields";

/**
 * Prompt assembly for prompt-cached requests. The system prompt is split into
 * two stable blocks (cached) plus a per-turn directive (volatile, kept out of
 * here — see the route). Order matters for caching: the longer-lived, more
 * widely shared block comes first.
 *
 *   1. {@link buildCachedCore}  — core rules/guardrails + shared plan document.
 *      Shared across every traveler on the plan. Cached with the longer TTL.
 *   2. {@link buildCobBlock}    — the traveler's CoB (structured facts + page
 *      text). Per-traveler. Cached with the default TTL.
 *
 * Nothing volatile (chat history, the latest question, the turn directive) goes
 * into these blocks — any byte change before a cache breakpoint is a cache miss.
 */

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * Cached prefix block #1: standing rules + the shared FlexiPAX plan document.
 * This is the large, stable, plan-shared block (cache with the longer TTL).
 */
export function buildCachedCore(planText: string): string {
  return `${buildCoreInstructions()}

${SOURCE_LABELS[SOURCE.PLAN_DOCUMENT]} (full text, all pages; each page labeled (p.N))

${planText}`;
}

/** Render the authoritative structured CoB facts as a labeled block. */
function formatStructuredFacts(fields: CobFields): string {
  const { purchased_limits: limits, trip_dates: trip } = fields;
  return [
    "CONFIRMATION OF BENEFITS — STRUCTURED FACTS (authoritative)",
    "These are the traveler's actual purchased amounts and trip details. Use these exact values.",
    "SOURCE PRECEDENCE: the Confirmation of Benefits purchased amount ALWAYS overrides the base plan amount in the FlexiPAX Plan Document when the two differ (for example, Trip Delay is $1,500 from the CoB, not the $1,000 base). Read amounts from these fields — do not parse dollar figures out of the plan document text.",
    "",
    `Plan number: ${fields.plan_number}`,
    `Plan: ${fields.plan_id}`,
    `Policyholder: ${fields.policyholder}`,
    `Trip dates: ${trip.departure} to ${trip.return}`,
    `Destination: ${fields.destination}`,
    "Purchased benefit limits:",
    `- Trip Delay: ${USD.format(limits.trip_delay)}`,
    `- Baggage & Personal Effects: ${USD.format(limits.baggage_personal_effects)}`,
    `- Baggage Delay: ${USD.format(limits.baggage_delay)}`,
    `- Base plan: ${USD.format(limits.base_plan)}`,
    `Issue date: ${fields.issue_date}`,
    `Effective date: ${fields.effective_date}`,
  ].join("\n");
}

/**
 * Cached prefix block #2: the traveler's Confirmation of Benefits.
 * Structured facts (authoritative) followed by the labeled page text (so
 * page-summary queries still work). Cache with the default TTL.
 */
export function buildCobBlock(cobPageText: string, cobFields: CobFields): string {
  return `${formatStructuredFacts(cobFields)}

${SOURCE_LABELS[SOURCE.CONFIRMATION_OF_BENEFITS]} — PAGE TEXT (each page labeled (p.N))

${cobPageText}`;
}
