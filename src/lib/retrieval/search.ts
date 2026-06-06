import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SOURCE } from "@/config/tii";
import { PINNED_PASSAGES } from "@/config/plan-reference";
import type { RetrievedPassage } from "@/types";

const DEFAULT_TOP_K = Number(process.env.RETRIEVAL_TOP_K ?? 10);

/**
 * Retrieve the most relevant passages for a question using PostgreSQL
 * full-text search (see supabase/migrations for the `match_chunks` function).
 *
 * The Confirmation of Benefits holds the traveler's plan-specific facts
 * (plan number, dates, destination, purchased options), so we ALWAYS include
 * its key passages regardless of the text-search score. This guarantees the
 * bot can answer "what plan do I have?" style questions reliably.
 */
export async function retrievePassages(
  query: string,
  topK: number = DEFAULT_TOP_K,
): Promise<RetrievedPassage[]> {
  const supabase = getSupabaseServerClient();

  // 1. Full-text search across all chunks.
  const { data: matches, error } = await supabase.rpc("match_chunks", {
    query_text: query,
    match_count: topK,
  });
  if (error) {
    throw new Error(`Retrieval failed: ${error.message}`);
  }

  // 2. Always pull the Confirmation of Benefits chunks so plan-specific
  //    facts are never missed.
  const { data: cob, error: cobError } = await supabase
    .from("document_chunks")
    .select("*")
    .eq("source", SOURCE.CONFIRMATION_OF_BENEFITS);
  if (cobError) {
    throw new Error(`Failed to load Confirmation of Benefits: ${cobError.message}`);
  }

  // 3. Merge, de-duplicate by id, keep highest rank.
  const byId = new Map<string, RetrievedPassage>();
  for (const row of (matches ?? []) as RetrievedPassage[]) {
    byId.set(row.id, row);
  }
  for (const row of cob ?? []) {
    if (!byId.has(row.id)) {
      byId.set(row.id, { ...(row as RetrievedPassage), rank: 0 });
    }
  }

  // 4. Always include curated Plan Document sub-limits and key definitions
  //    that full-text search frequently misses (dental, per-article,
  //    passport, credit card, traveling companion).
  for (const pinned of PINNED_PASSAGES) {
    if (!byId.has(pinned.id)) {
      byId.set(pinned.id, pinned);
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.rank - a.rank);
}
