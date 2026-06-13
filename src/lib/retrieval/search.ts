import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SOURCE, SOURCE_LABELS } from "@/config/tii";
import { DEFAULT_PLAN_NUMBER, redactPrivateDetails } from "@/config/cob-fields";
import type { CobFields } from "@/config/cob-fields";
import type { GroundingContext, RetrievalResult, RetrievedPassage } from "@/types";

/**
 * Loads the grounding context for one chat turn: the shared plan document's
 * full text (by plan_id, taken from the traveler's CoB) plus the traveler's
 * Confirmation of Benefits (structured purchased amounts + labeled page text).
 *
 * This is the live read path. It replaces the old "load every chunk of both
 * PDFs" approach: the plan document is now a single shared record that prompt
 * caching reuses across every traveler on that plan, and the CoB is a small
 * per-traveler block. Cost grows with conversation volume, not traveler count.
 *
 * Cross-user safety: every request loads strictly by the given plan_number;
 * there is no shared/global mutable "current document" state.
 */
export async function loadGroundingContext(
  planNumber: string = DEFAULT_PLAN_NUMBER,
): Promise<GroundingContext> {
  const supabase = getSupabaseServerClient();

  // 1. Load this traveler's CoB (structured facts + labeled page text).
  const { data: cob, error: cobError } = await supabase
    .from("cob")
    .select("plan_id, fields, page_text")
    .eq("plan_number", planNumber)
    .maybeSingle();
  if (cobError) {
    throw new Error(`Failed to load Confirmation of Benefits: ${cobError.message}`);
  }
  if (!cob) {
    throw new Error(`No Confirmation of Benefits found for plan_number ${planNumber}.`);
  }

  const planId = cob.plan_id as string;

  // 2. Load the active shared plan document for that CoB's plan_id.
  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("full_text")
    .eq("plan_id", planId)
    .eq("is_active", true)
    .maybeSingle();
  if (planError) {
    throw new Error(`Failed to load plan document for ${planId}: ${planError.message}`);
  }
  if (!plan) {
    throw new Error(`No active plan document found for plan_id ${planId}.`);
  }

  return {
    planText: plan.full_text as string,
    // Safety net: re-redact at read time so even a stale, unredacted DB row
    // (ingested before COB_REDACT_STRINGS was set) can't leak into context.
    cobPageText: redactPrivateDetails(cob.page_text as string),
    cobFields: cob.fields as CobFields,
    planNumber,
    planId,
    scope: "both documents, complete text (all pages)",
  };
}

function parsePageNumber(query: string): number | null {
  const match = query.match(/\bpage\s*(\d+)\b/i);
  return match ? parseInt(match[1], 10) : null;
}

function parsePageSourceFilter(
  query: string,
): typeof SOURCE.CONFIRMATION_OF_BENEFITS | typeof SOURCE.PLAN_DOCUMENT | null {
  if (/\bconfirmation of benefits\b|\bcob\b/i.test(query)) {
    return SOURCE.CONFIRMATION_OF_BENEFITS;
  }
  if (/\bplan document\b|\bflexipax\b|\bmy plan document\b/i.test(query)) {
    return SOURCE.PLAN_DOCUMENT;
  }
  return null;
}

/**
 * PARKED retrieval scaffold (not on the live read path — see
 * {@link loadGroundingContext}). Loads the complete text of both documents
 * from the chunked `document_chunks` table. Retained for the full-text /
 * FTS retrieval path that may be switched back on if a single plan document
 * approaches the 200K-token request limit (see query-intents.ts).
 */
export async function retrievePassages(_userQuery: string): Promise<RetrievalResult> {
  const supabase = getSupabaseServerClient();

  const { data: cob, error: cobError } = await supabase
    .from("document_chunks")
    .select("*")
    .eq("source", SOURCE.CONFIRMATION_OF_BENEFITS)
    .order("page", { ascending: true })
    .order("created_at", { ascending: true });
  if (cobError) {
    throw new Error(`Failed to load Confirmation of Benefits: ${cobError.message}`);
  }

  const { data: plan, error: planError } = await supabase
    .from("document_chunks")
    .select("*")
    .eq("source", SOURCE.PLAN_DOCUMENT)
    .order("page", { ascending: true })
    .order("created_at", { ascending: true });
  if (planError) {
    throw new Error(`Failed to load FlexiPAX Plan Document: ${planError.message}`);
  }

  return {
    passages: [...(cob ?? []), ...(plan ?? [])].map((row) => ({
      ...(row as RetrievedPassage),
      rank: 0,
    })),
    scope: "both documents, complete text (all pages)",
  };
}

/** Extra instruction when the user asks about a specific document page. */
export function pageQueryDirective(query: string, _scope: string): string {
  const pageNumber = parsePageNumber(query);
  if (pageNumber === null) return "";

  const sourceFilter = parsePageSourceFilter(query);
  const parts = [
    `The traveler asked about page ${pageNumber}. The full text of both documents is provided below; each passage is labeled (p.N) with its PDF page number.`,
    `Summarize what is on page ${pageNumber} using only passages labeled (p.${pageNumber}).`,
    "Do not refuse for privacy — summarizing plan pages from the provided text is your job.",
    "Do not substitute content from a different page or document.",
  ];

  if (sourceFilter === SOURCE.PLAN_DOCUMENT) {
    parts.push(
      `They asked about the FlexiPAX Plan Document — use only passages under "${SOURCE_LABELS[SOURCE.PLAN_DOCUMENT]}" labeled (p.${pageNumber}). Do not answer with Confirmation of Benefits content.`,
    );
  } else if (sourceFilter === SOURCE.CONFIRMATION_OF_BENEFITS) {
    parts.push(
      `They asked about the Confirmation of Benefits — use only passages under "${SOURCE_LABELS[SOURCE.CONFIRMATION_OF_BENEFITS]}" labeled (p.${pageNumber}). Do not answer with Plan Document content.`,
    );
  } else {
    parts.push(
      `If both documents have a page ${pageNumber}, summarize each document separately under clear headings.`,
    );
  }

  return parts.join(" ");
}
