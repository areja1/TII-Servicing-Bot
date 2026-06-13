/**
 * One-time document ingestion script.
 *
 * Parses the two source PDFs page-by-page and loads them into Supabase in the
 * shape the live read path now expects:
 *
 *   plans  -- ONE clean full-text record for the FlexiPAX Plan Document, with
 *            page boundaries preserved as labeled (p.N) markers. This is the
 *            large, stable block prompt caching reuses across every traveler.
 *   cob    -- the traveler's Confirmation of Benefits: the structured purchased
 *            amounts (from src/config/cob-fields.ts) plus labeled, privacy-
 *            redacted page text for "summarize page N of my CoB" queries.
 *
 * It also keeps populating `document_chunks` so the parked full-text retrieval
 * scaffold (src/lib/retrieval/search.ts + query-intents.ts) stays usable.
 *
 * Usage:
 *   1. Apply migrations 0001_init.sql and 0002_plans_cob.sql to Supabase.
 *   2. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 *   3. Place the PDFs in docs/source-documents/ (see filenames below)
 *   4. (Optional) Set COB_REDACT_STRINGS in .env.local to the traveler's home
 *      address lines so they are stripped from the CoB page text at ingest.
 *   5. npm run ingest
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { PLAN_DOCUMENT_PAGE_1_COVER } from "../../src/config/plan-document-cover";
import {
  COB_FIELDS,
  COB_POLICYHOLDER_ID,
  redactPrivateDetails,
} from "../../src/config/cob-fields";
// pdf-parse is CommonJS; import the implementation entry directly.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

loadEnv({ path: ".env.local" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, "../../docs/source-documents");

const PLAN_SOURCE = {
  source: "plan_document" as const,
  file: "Flexipax Plan Document.pdf",
};
const COB_SOURCE = {
  source: "confirmation_of_benefits" as const,
  file: "Confirmation of Benefits.pdf",
};

const CHUNK_SIZE = 1200; // characters
const CHUNK_OVERLAP = 150;

function chunkText(text: string): string[] {
  const clean = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + CHUNK_SIZE, clean.length);
    chunks.push(clean.slice(start, end));
    if (end >= clean.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks.filter((c) => c.trim().length > 0);
}

async function extractPageTexts(buffer: Buffer): Promise<string[]> {
  const pageTexts: string[] = [];

  await pdfParse(buffer, {
    pagerender: (pageData: {
      getTextContent: () => Promise<{ items: Array<{ str: string }> }>;
    }) =>
      pageData.getTextContent().then((content) => {
        const text = content.items
          .map((item) => item.str)
          .join(" ")
          .trim();
        pageTexts.push(text);
        return text;
      }),
  });

  return pageTexts;
}

/**
 * Normalize the extracted page texts for one source, substituting the
 * image-only Plan Document cover page (pdf-parse cannot read it).
 */
function normalizePageTexts(
  pageTexts: string[],
  source: "plan_document" | "confirmation_of_benefits",
): string[] {
  return pageTexts.map((pageText, i) => {
    const pageNumber = i + 1;
    if (!pageText.trim() && pageNumber === 1 && source === "plan_document") {
      return PLAN_DOCUMENT_PAGE_1_COVER;
    }
    return pageText;
  });
}

/** Join page texts into one clean block with labeled (p.N) markers preserved. */
function buildLabeledFullText(pageTexts: string[]): string {
  return pageTexts
    .map((text, i) => {
      const clean = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      return `(p.${i + 1})\n${clean}`;
    })
    .join("\n\n");
}

function buildPageMap(pageTexts: string[]) {
  return {
    pageCount: pageTexts.length,
    pages: pageTexts.map((_, i) => ({ page: i + 1, label: `(p.${i + 1})` })),
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Factory so helpers can infer the permissive client type from the call site. */
function createSupabase(url: string, key: string) {
  return createClient(url, key, { auth: { persistSession: false } });
}
type SupabaseClientLike = ReturnType<typeof createSupabase>;

/** Re-chunk both documents into document_chunks (parked retrieval scaffold). */
async function loadDocumentChunks(
  supabase: SupabaseClientLike,
  planPages: string[],
  cobPages: string[],
) {
  const { error: deleteError } = await supabase
    .from("document_chunks")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (deleteError) throw deleteError;

  const sources: Array<{
    source: "plan_document" | "confirmation_of_benefits";
    pages: string[];
  }> = [
    { source: PLAN_SOURCE.source, pages: planPages },
    { source: COB_SOURCE.source, pages: cobPages },
  ];

  for (const { source, pages } of sources) {
    const rows: Array<{
      source: typeof source;
      section: null;
      page: number;
      content: string;
    }> = [];

    pages.forEach((pageText, i) => {
      for (const content of chunkText(pageText)) {
        rows.push({ source, section: null, page: i + 1, content });
      }
    });

    const { error } = await supabase.from("document_chunks").insert(rows);
    if (error) throw error;
    console.log(
      `document_chunks: ${rows.length} chunks from ${source} across ${pages.length} pages.`,
    );
  }
}

/** Load the shared FlexiPAX plan document as one active full-text record. */
async function loadPlanRecord(supabase: SupabaseClientLike, planPages: string[]) {
  if (planPages.length === 0 || planPages.some((p) => !p.trim())) {
    throw new Error(
      `Plan document validation failed: expected non-empty text for all ${planPages.length} pages.`,
    );
  }

  const fullText = buildLabeledFullText(planPages);
  const planId = COB_FIELDS.plan_id;

  // Idempotent activate: deactivate any prior versions, then upsert this one as
  // the single active row for the plan.
  const { error: deactivateError } = await supabase
    .from("plans")
    .update({ is_active: false })
    .eq("plan_id", planId);
  if (deactivateError) throw deactivateError;

  const { error: upsertError } = await supabase.from("plans").upsert(
    {
      plan_id: planId,
      version: 1,
      effective_date: COB_FIELDS.effective_date,
      jurisdiction: null,
      full_text: fullText,
      page_map: buildPageMap(planPages),
      checksum: sha256(fullText),
      is_active: true,
    },
    { onConflict: "plan_id,version" },
  );
  if (upsertError) throw upsertError;

  console.log(
    `plans: loaded ${planId} v1 (${planPages.length} pages, ${fullText.length} chars, active).`,
  );
}

/** Load the traveler's Confirmation of Benefits (structured fields + page text). */
async function loadCobRecord(supabase: SupabaseClientLike, cobPages: string[]) {
  if (cobPages.length === 0) {
    throw new Error("Confirmation of Benefits validation failed: no pages parsed.");
  }

  const pageText = redactPrivateDetails(buildLabeledFullText(cobPages));

  const { error } = await supabase.from("cob").upsert(
    {
      plan_number: COB_FIELDS.plan_number,
      plan_id: COB_FIELDS.plan_id,
      policyholder_id: COB_POLICYHOLDER_ID,
      fields: COB_FIELDS,
      page_text: pageText,
    },
    { onConflict: "plan_number" },
  );
  if (error) throw error;

  console.log(
    `cob: loaded ${COB_FIELDS.plan_number} (${cobPages.length} pages, plan_id=${COB_FIELDS.plan_id}).`,
  );
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }
  const supabase = createSupabase(url, key);

  const planBuffer = await readFile(path.join(DOCS_DIR, PLAN_SOURCE.file));
  const cobBuffer = await readFile(path.join(DOCS_DIR, COB_SOURCE.file));

  const planPages = normalizePageTexts(
    await extractPageTexts(planBuffer),
    PLAN_SOURCE.source,
  );
  const cobPages = normalizePageTexts(
    await extractPageTexts(cobBuffer),
    COB_SOURCE.source,
  );

  // Live read path: shared plan full text + per-traveler CoB.
  await loadPlanRecord(supabase, planPages);
  await loadCobRecord(supabase, cobPages);

  // Parked retrieval scaffold: keep document_chunks in sync.
  await loadDocumentChunks(supabase, planPages, cobPages);

  console.log("Ingestion complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
