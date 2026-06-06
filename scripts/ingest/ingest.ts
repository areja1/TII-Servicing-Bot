/**
 * One-time document ingestion script.
 *
 * Parses the two source PDFs, splits them into reasonably sized chunks, tags
 * each chunk with its source (Confirmation of Benefits vs FlexiPAX Plan
 * Document), and loads them into the Supabase `document_chunks` table.
 *
 * Usage:
 *   1. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 *   2. Place the PDFs in docs/source-documents/ (see filenames below)
 *   3. npm run ingest
 *
 * NOTE: This is scaffold-level structure. Tune CHUNK_SIZE / heading detection
 * to your documents before relying on retrieval quality.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
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
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + CHUNK_SIZE, clean.length);
    chunks.push(clean.slice(start, end));
    // Stop once we've consumed the final chunk; otherwise `start` would reset
    // to (length - overlap) on every pass and loop forever.
    if (end >= clean.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks.filter((c) => c.trim().length > 0);
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

  // Start clean so re-running ingestion is idempotent. Matching on a
  // never-occurring uuid deletes all rows without an invalid-uuid comparison.
  const { error: deleteError } = await supabase
    .from("document_chunks")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (deleteError) throw deleteError;

  for (const { source, file } of SOURCES) {
    const buffer = await readFile(path.join(DOCS_DIR, file));
    const parsed = await pdfParse(buffer);
    const chunks = chunkText(parsed.text);

    const rows = chunks.map((content) => ({
      source,
      section: null,
      page: null,
      content,
    }));

    const { error } = await supabase.from("document_chunks").insert(rows);
    if (error) throw error;

    console.log(`Ingested ${rows.length} chunks from ${file} (${source}).`);
  }

  console.log("Ingestion complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
