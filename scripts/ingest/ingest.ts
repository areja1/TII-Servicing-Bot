/**
 * One-time document ingestion script.
 *
 * Parses the two source PDFs page-by-page, splits each page into chunks, tags
 * each chunk with its source (Confirmation of Benefits vs FlexiPAX Plan
 * Document) and page number, and loads them into Supabase `document_chunks`.
 *
 * Usage:
 *   1. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 *   2. Place the PDFs in docs/source-documents/ (see filenames below)
 *   3. npm run ingest
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { PLAN_DOCUMENT_PAGE_1_COVER } from "../../src/config/plan-document-cover";
// pdf-parse is CommonJS; import the implementation entry directly.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

loadEnv({ path: ".env.local" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, "../../docs/source-documents");

const SOURCES = [
  {
    source: "confirmation_of_benefits" as const,
    file: "Confirmation of Benefits.pdf",
  },
  {
    source: "plan_document" as const,
    file: "Flexipax Plan Document.pdf",
  },
];

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

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { error: deleteError } = await supabase
    .from("document_chunks")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (deleteError) throw deleteError;

  for (const { source, file } of SOURCES) {
    const buffer = await readFile(path.join(DOCS_DIR, file));
    const pageTexts = await extractPageTexts(buffer);

    const rows: Array<{
      source: typeof source;
      section: null;
      page: number;
      content: string;
    }> = [];

    for (let i = 0; i < pageTexts.length; i++) {
      const pageNumber = i + 1;
      let pageText = pageTexts[i];
      if (
        !pageText.trim() &&
        pageNumber === 1 &&
        source === "plan_document"
      ) {
        pageText = PLAN_DOCUMENT_PAGE_1_COVER;
      }
      const pageChunks = chunkText(pageText);
      for (const content of pageChunks) {
        rows.push({
          source,
          section: null,
          page: pageNumber,
          content,
        });
      }
    }

    const { error } = await supabase.from("document_chunks").insert(rows);
    if (error) throw error;

    console.log(
      `Ingested ${rows.length} chunks from ${file} (${source}) across ${pageTexts.length} pages.`,
    );
  }

  console.log("Ingestion complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
