import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SOURCE, SOURCE_LABELS } from "@/config/tii";
import type { RetrievalResult, RetrievedPassage } from "@/types";

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
 * Loads the complete text of both plan documents on every request so the
 * assistant has knowledge of all pages. Page-specific questions are handled
 * via turn instructions that point the model at the labeled (p.N) passages.
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
