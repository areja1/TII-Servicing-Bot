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
