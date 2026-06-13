import type { SourceTag } from "@/config/tii";

/** A single chunk of source text stored in the knowledge base. */
export interface DocumentChunk {
  id: string;
  /** Which document this chunk came from. */
  source: SourceTag;
  /** Human-readable section heading the chunk belongs to, if known. */
  section: string | null;
  /** Original page number in the source PDF. */
  page: number | null;
  /** The chunk text content. */
  content: string;
}

/** A retrieved passage with its relevance score from full-text search. */
export interface RetrievedPassage extends DocumentChunk {
  /** PostgreSQL ts_rank relevance score (higher = more relevant). */
  rank: number;
}

/** Result of loading document passages for one chat turn. */
export interface RetrievalResult {
  passages: RetrievedPassage[];
  /** Human-readable description of what was loaded (for the system prompt). */
  scope: string;
}

/** Page metadata stored alongside a plan's full text. */
export interface PlanPageMap {
  pageCount: number;
  pages: Array<{ page: number; label: string }>;
}

/** A shared plan document, one row per (plan_id, version). */
export interface PlanRecord {
  plan_id: string;
  version: number;
  effective_date: string | null;
  jurisdiction: string | null;
  /** Clean full text with labeled (p.N) page markers. */
  full_text: string;
  page_map: PlanPageMap;
  checksum: string;
  is_active: boolean;
}

/** A per-traveler Confirmation of Benefits row. */
export interface CobRecord {
  plan_number: string;
  plan_id: string;
  policyholder_id: string | null;
  /** Structured, authoritative purchased amounts + trip facts (see CobFields). */
  fields: import("@/config/cob-fields").CobFields;
  /** Labeled (p.N) CoB page text with private details redacted. */
  page_text: string;
}

/**
 * Everything needed to ground one chat turn: the shared plan full text plus the
 * traveler's CoB (structured facts + page text).
 */
export interface GroundingContext {
  planText: string;
  cobPageText: string;
  cobFields: import("@/config/cob-fields").CobFields;
  planNumber: string;
  planId: string;
  /** Human-readable description of what was loaded (for the page directive). */
  scope: string;
}
