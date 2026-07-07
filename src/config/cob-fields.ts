/**
 * Structured Confirmation of Benefits (CoB) facts for the POC traveler.
 *
 * These are the *authoritative* purchased amounts and trip details. The model
 * reads these fields directly instead of parsing dollar figures out of the PDF
 * text, which is what guarantees the source-precedence rule: the CoB purchased
 * amount always wins over the base plan amount (e.g. trip delay = $1,500, not
 * the base $1,000).
 *
 * Privacy by omission: the traveler's home/residential address is deliberately
 * absent from this object and must never be added. See {@link redactPrivateDetails}
 * (driven by COB_REDACT_STRINGS) for stripping it out of the CoB page text.
 *
 * For the single-plan POC these values are curated here (the same pattern as
 * {@link file://../config/plan-reference.ts} and plan-document-cover.ts). When
 * scaling to many travelers, this object becomes one row per CoB in the `cob`
 * table, extracted at ingest from each traveler's document.
 */
export interface CobTripDates {
  /** ISO date (YYYY-MM-DD). */
  departure: string;
  /** ISO date (YYYY-MM-DD). */
  return: string;
}

export interface CobPurchasedLimits {
  /**
   * Trip Delay max benefit, including the purchased optional increase.
   *
   * AMBIGUITY (documented, not resolved — flag for Isaiah / TII to clarify in
   * production): this is stored as a single aggregate total ($1,500) with no
   * explicit per-flight or per-occurrence language in the plan config. It is
   * NOT definitively answered here whether two separate delayed flights on the
   * same trip can each generate a claim up to a combined $1,500, or whether it
   * is one claim per trip regardless of how many flights were delayed. No code
   * currently branches on this — the FNOL flow treats each qualifying flight
   * independently — but the aggregate-vs-per-occurrence question should be
   * confirmed with the plan owner before this is relied on in production.
   */
  trip_delay: number;
  /** Baggage & Personal Effects max, including the purchased optional increase. */
  baggage_personal_effects: number;
  /** Baggage Delay max, including the purchased optional increase. */
  baggage_delay: number;
  /** Base trip-protection plan cost (the FlexiPAX base amount). */
  base_plan: number;
}

export interface CobFields {
  plan_number: string;
  plan_id: string;
  policyholder: string;
  trip_dates: CobTripDates;
  destination: string;
  purchased_limits: CobPurchasedLimits;
  issue_date: string;
  effective_date: string;
}

export const COB_FIELDS: CobFields = {
  plan_number: "260210RTL08",
  plan_id: "FlexiPAX",
  policyholder: "Isaiah Lopez",
  trip_dates: { departure: "2026-02-16", return: "2026-02-20" },
  destination: "Costa Rica",
  purchased_limits: {
    trip_delay: 1500,
    baggage_personal_effects: 2500,
    baggage_delay: 500,
    base_plan: 2500,
  },
  issue_date: "2026-02-10",
  effective_date: "2026-02-10",
};

/** Stable identifier for this CoB's policyholder (no PII beyond the name on file). */
export const COB_POLICYHOLDER_ID = "isaiah-lopez";

/** The traveler's plan number — the key the loader uses to fetch their CoB. */
export const DEFAULT_PLAN_NUMBER = COB_FIELDS.plan_number;

/** The shared plan this CoB belongs to — used to load the right `plans` row. */
export const DEFAULT_PLAN_ID = COB_FIELDS.plan_id;

/**
 * Strings to strip from the CoB page text, enforcing privacy by omission rather
 * than relying on a prompt rule alone. These are the traveler's home/residential
 * address lines.
 *
 * Sourced from the COB_REDACT_STRINGS environment variable (pipe- or
 * newline-separated) so the address — which is PII — is never committed to the
 * repo. Returns [] when the var is unset. The prompt-level privacy rule (see
 * grounding-rules.ts) remains the backstop.
 *
 * Read lazily (at call time, not module load) so it works regardless of when the
 * caller loads the env — Next.js loads .env before any module, but the ingest
 * script loads dotenv inside its own body, after imports have evaluated.
 *
 * Example (.env.local):
 *   COB_REDACT_STRINGS=123 Main Street Apt 4|Springfield, CA 90210
 */
export function getPrivateRedactions(): string[] {
  return (process.env.COB_REDACT_STRINGS ?? "")
    .split(/[|\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const REDACTION_MARKER = "[redacted]";

/** Escape regex metacharacters in a literal string. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace any configured private strings with a redaction marker. Each secret is
 * matched case-insensitively, with every whitespace run treated as `\s+`, so the
 * address is stripped regardless of how pdf-parse happened to space it — the
 * operator can supply it in normal human form.
 */
export function redactPrivateDetails(text: string): string {
  let out = text;
  for (const secret of getPrivateRedactions()) {
    if (!secret.trim()) continue;
    // Escape metacharacters first, then relax every whitespace run to \s+ so the
    // match is insensitive to how the PDF spaced/wrapped the address.
    const pattern = escapeRegExp(secret.trim()).replace(/\s+/g, "\\s+");
    out = out.replace(new RegExp(pattern, "gi"), REDACTION_MARKER);
  }
  return out;
}
