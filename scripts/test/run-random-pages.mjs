/**
 * Random page-summary tests validated against source PDFs (not Supabase).
 *
 *   node scripts/test/run-random-pages.mjs
 *   CHAT_URL=http://localhost:3000/api/chat node scripts/test/run-random-pages.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

const PLAN_PAGE_1_COVER =
  "FlexiPAX Individual Travel Insurance Policy Plan Summary Cover Page Underwriter United States Fire Insurance Company Administrator Travel Insured International travelinsured.com 855-752-8303 800-494-9907";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, "../../docs/source-documents");
const URL = process.env.CHAT_URL ?? "http://localhost:3000/api/chat";
const OUT = path.resolve(__dirname, "random-pages-results.md");

/** Fixed random-ish pages spread across both PDFs; mix named / unnamed doc. */
const CASES = [
  { id: "RAND-PD-17", doc: "plan", page: 17, question: "Can you summarize page 17 of my plan document?" },
  { id: "RAND-PD-42", doc: "plan", page: 42, question: "What's on page 42?" },
  { id: "RAND-COB-2", doc: "cob", page: 2, question: "Give me a summary of page 2 of my confirmation of benefits." },
  { id: "RAND-PD-31", doc: "plan", page: 31, question: "Tell me about page 31 of the FlexiPAX plan document." },
  { id: "RAND-BOTH-4", doc: "both", page: 4, question: "What does page 4 cover?" },
];

const REFUSAL = /don't have page|not available|cannot help|cannot tell|privacy|I don't have access|out of scope/i;

async function extractPages(filePath) {
  const buffer = await readFile(filePath);
  const pages = [];
  await pdfParse(buffer, {
    pagerender: (pageData) =>
      pageData.getTextContent().then((content) => {
        const text = content.items.map((item) => item.str).join(" ").trim();
        pages.push(text);
        return text;
      }),
  });
  return pages;
}

/** Distinctive terms from PDF page text for loose grounding checks. */
function anchorTerms(text, count = 5) {
  const stop = new Set([
    "about", "after", "also", "been", "before", "being", "between", "cover",
    "covered", "coverage", "document", "following", "from", "have", "including",
    "insured", "insurance", "other", "plan", "shall", "such", "that", "their",
    "there", "these", "this", "those", "travel", "under", "which", "with",
    "your", "benefit", "benefits", "amount", "maximum",
  ]);

  const phrases = [];
  const section = text.match(/\bSECTION [IVXLC]+\b[^.]{0,60}/i);
  if (section) phrases.push(section[0].trim());

  const caps = [...text.matchAll(/\b[A-Z][A-Za-z\-]{3,}(?:\s+[A-Z][A-Za-z\-]{3,}){0,3}\b/g)]
    .map((m) => m[0])
    .filter((p) => p.length > 5 && !/PAGE|FLEXIPAX|CONFIRMATION/.test(p));
  for (const p of caps.slice(0, 3)) phrases.push(p);

  const words = text
    .replace(/[^a-zA-Z0-9$%-\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 5 && !stop.has(w.toLowerCase()));
  const freq = new Map();
  for (const w of words) {
    const k = w.toLowerCase();
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
  for (const w of ranked) {
    if (phrases.length >= count) break;
    if (!phrases.some((p) => p.toLowerCase().includes(w))) phrases.push(w);
  }

  return [...new Set(phrases)].slice(0, count);
}

function parseStream(text) {
  let out = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("0:")) {
      try {
        out += JSON.parse(line.slice(2));
      } catch {
        /* ignore */
      }
    }
  }
  return out.trim();
}

function scoreAnswer(answer, anchors) {
  const lower = answer.toLowerCase();
  const hits = anchors.filter((a) => lower.includes(a.toLowerCase()));
  return { hits, hitRate: hits.length / Math.max(anchors.length, 1) };
}

async function askChat(question) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
  });
  return parseStream(await res.text());
}

const cobPages = await extractPages(path.join(DOCS_DIR, "Confirmation of Benefits.pdf"));
const planPages = await extractPages(path.join(DOCS_DIR, "Flexipax Plan Document.pdf"));
if (!planPages[0]?.trim()) planPages[0] = PLAN_PAGE_1_COVER;

console.log(`Source PDFs: CoB ${cobPages.length} pages, Plan ${planPages.length} pages`);
console.log(`Chat API: ${URL}\n`);

const results = [];

for (const c of CASES) {
  process.stdout.write(`${c.id} ... `);

  let pdfSnippet = "";
  let anchors = [];

  if (c.doc === "both") {
    const cobText = cobPages[c.page - 1] ?? "";
    const planText = planPages[c.page - 1] ?? "";
    pdfSnippet = `CoB: ${cobText.slice(0, 300)}\n\nPlan: ${planText.slice(0, 300)}`;
    anchors = [...anchorTerms(cobText, 3), ...anchorTerms(planText, 3)];
  } else {
    const pages = c.doc === "cob" ? cobPages : planPages;
    const text = pages[c.page - 1] ?? "";
    pdfSnippet = text.slice(0, 400);
    anchors = anchorTerms(text, 5);
  }

  try {
    const answer = await askChat(c.question);
    const refused = REFUSAL.test(answer);
    const { hits, hitRate } = scoreAnswer(answer, anchors);
    // Pass if substantive, not refused, and at least 2 PDF anchor terms appear
    const pass = answer.length > 80 && !refused && hits.length >= 2;
    results.push({ ...c, pass, answer, pdfSnippet, anchors, hits, hitRate, refused });
    console.log(pass ? "PASS" : "FAIL");
  } catch (err) {
    results.push({ ...c, pass: false, error: String(err), pdfSnippet, anchors });
    console.log("ERROR");
  }

  await new Promise((r) => setTimeout(r, 2000));
}

const passed = results.filter((r) => r.pass).length;
const lines = [
  `# Random page tests (validated against source PDFs)`,
  ``,
  `Run: ${new Date().toISOString()}`,
  `API: ${URL}`,
  `Result: **${passed}/${results.length} passed**`,
  ``,
];

for (const r of results) {
  lines.push(`## ${r.id} — ${r.pass ? "PASS" : "FAIL"}`);
  lines.push(`**Question:** ${r.question}`);
  lines.push(`**PDF page(s):** ${r.doc} page ${r.page}`);
  lines.push(`**Anchor terms from PDF:** ${r.anchors?.join(", ") ?? "n/a"}`);
  if (r.hits) lines.push(`**Matched in answer:** ${r.hits.join(", ") || "(none)"}`);
  lines.push(`**PDF snippet:**\n\`\`\`\n${r.pdfSnippet ?? ""}\n\`\`\``);
  lines.push(`**Bot answer:**\n${r.error ?? r.answer ?? "(no answer)"}`);
  lines.push("");
}

await writeFile(OUT, lines.join("\n"), "utf8");

console.log(`\n${"=".repeat(60)}`);
console.log(`RESULT: ${passed}/${results.length} passed`);
console.log(`Report: ${OUT}`);
console.log("=".repeat(60));

for (const r of results.filter((x) => !x.pass)) {
  console.log(`\n--- FAIL: ${r.id} ---`);
  console.log(`Q: ${r.question}`);
  console.log(`PDF anchors: ${r.anchors?.join(", ")}`);
  console.log(`Matched: ${r.hits?.join(", ") ?? "n/a"}`);
  console.log(r.answer?.slice(0, 500) ?? r.error);
}

process.exit(passed === results.length ? 0 : 1);
