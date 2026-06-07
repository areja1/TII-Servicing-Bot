# TII Servicing Bot

A publicly accessible text-chat assistant for **Travel Insured International (TII)**
that answers travel-insurance servicing questions grounded in two documents:
the traveler's **Confirmation of Benefits** and the **FlexiPAX Plan Document**.

Each question is answered using the **full text of both documents** loaded from
Supabase, with guardrails that prevent claim decisions, invented benefits, and
medical/legal advice, and that escalate urgent issues to the correct TII contact.

> Proof-of-concept built to the requirements in
> [`docs/Proof of Concept Requirements.docx`](docs/Proof%20of%20Concept%20Requirements.docx).

---

## Tech stack

| Layer | Technology |
|---|---|
| Application | Next.js (TypeScript, App Router) |
| Chat experience | Vercel AI SDK (streaming) |
| Language model | Claude Sonnet 4.6 (Anthropic) |
| Knowledge base | Supabase (managed PostgreSQL) |
| Context loading | Full-document load on every request (~212 chunks, both PDFs) |
| Ingestion | Page-by-page PDF parsing, chunking, tagging, and load script |
| Guardrails | Backend rules + prompt-level rules |
| Hosting | Vercel |

See [`docs/architecture.md`](docs/architecture.md) for the full flow.

## Project structure

```
TII-Servicing-Bot/
├── src/
│   ├── app/
│   │   ├── api/chat/route.ts       # Chat endpoint (load docs → prompt → stream)
│   │   ├── layout.tsx
│   │   ├── page.tsx                # Chat page
│   │   └── globals.css
│   ├── components/chat/            # Streaming chat UI
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── grounding-rules.ts  # Core servicing instructions
│   │   │   ├── prompt.ts           # System prompt + source-tagged context
│   │   │   └── guardrails.ts       # Deterministic safety checks
│   │   ├── retrieval/search.ts     # Full-document load + page-query directives
│   │   ├── rate-limit.ts           # Per-IP rate limiting
│   │   └── supabase/server.ts
│   ├── config/
│   │   ├── tii.ts                  # TII contacts + source labels
│   │   └── plan-document-cover.ts  # Plan Document page 1 (image-only cover)
│   └── types/index.ts
├── supabase/
│   ├── migrations/0001_init.sql
│   └── README.md
├── scripts/
│   ├── ingest/ingest.ts            # One-time document ingestion (page-aware)
│   └── test/
│       ├── run-suite.mjs           # Full scenario suite (~95 questions)
│       ├── run-both-docs.mjs       # Both-doc regression (11 cases)
│       ├── run-random-pages.mjs    # Random page summaries vs source PDFs
│       └── run-client-feedback.mjs # Client feedback smoke tests
├── docs/
│   ├── architecture.md
│   ├── test-questions.md
│   ├── tech-stack.md
│   └── source-documents/           # The two source PDFs
├── .env.example
└── package.json
```

## Getting started

### 1. Prerequisites
- Node.js 20+ (developed on Node 22)
- A Supabase project
- An Anthropic API key

### 2. Install
```bash
npm install
```

### 3. Configure environment
```bash
cp .env.example .env.local
```
Fill in `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

### 4. Create the database schema
Apply `supabase/migrations/0001_init.sql` (see `supabase/README.md`).

### 5. Ingest the documents
```bash
npm run ingest
```
This parses both PDFs **page by page**, tags each chunk with `source` and `page`,
and loads ~212 chunks (CoB pages 1–4, Plan Document pages 1–57). Plan Document
page 1 is supplemented at ingest because the PDF cover is image-only.

### 6. Run locally
```bash
npm run dev
```
Open http://localhost:3000.

### 7. Run tests
With the dev server running:

```bash
# Full scenario suite (writes scripts/test/results.md)
node scripts/test/run-suite.mjs

# Both-document regression (11 cases)
node scripts/test/run-both-docs.mjs

# Random page summaries validated against source PDFs (5 cases)
node scripts/test/run-random-pages.mjs

# Client feedback smoke tests
node scripts/test/run-client-feedback.mjs
```

Test against production:

```bash
CHAT_URL=https://tii-servicing-bot.vercel.app/api/chat node scripts/test/run-both-docs.mjs
```

## How answers are grounded

The POC is **document-grounded only** — the bot answers from the two ingested
PDFs, not from general world knowledge.

1. **Full context every turn** — both documents are loaded from Supabase on every
   request so the assistant has knowledge of all pages and sections.
2. **Page labels** — each passage is tagged with `(p.N)` so page-specific
   questions (“What’s on page 17?”) can be answered accurately.
3. **Turn-specific instructions** — page queries, emergencies, and claim-outcome
   questions get extra directives layered on the system prompt.
4. **Purchased amounts** — when CoB and Plan Document differ, the traveler's
   actual purchased amounts from the Confirmation of Benefits take precedence.

## Guardrails

- No claim approval/denial or outcome prediction.
- No invented benefits, amounts, dates, or contacts.
- No medical, legal, or financial advice.
- Grounded answers only; route to TII when the documents don't cover a question.
- Emergency / evacuation questions are routed to the 24/7 assistance line.
- Home/residential street address is withheld; all other plan content may be summarized.

Enforced in two layers: `src/lib/ai/grounding-rules.ts` (system prompt) and
deterministic backend checks (`src/lib/ai/guardrails.ts`).

## POC scope (client messaging)

| In scope | Out of scope (unless new content is ingested) |
|---|---|
| Benefits, coverage amounts, exclusions, definitions | General travel advice not in the documents |
| Claims steps, required documentation | Claim approval/denial decisions |
| 24/7 assistance, concierge, non-insurance services | Medical or legal advice |
| Page/section summaries from both PDFs | Questions about other travelers' plans |
| “Why buy insurance?” framed from **this plan’s** documented benefits | Open-ended general knowledge |

## Limitations

- Corpus is fixed to the two sample PDFs; adding new plans or FAQs requires re-ingestion.
- Full-document context works for this small corpus (~212 chunks) but would need
  retrieval tuning or vector search at larger scale.
- No authentication (public POC by design). In-memory per-IP rate limiting
  (`RATE_LIMIT_PER_MIN`, default 15) is per-instance and resets on restart.
- Plan Document page 1 cover text is manually supplemented because the PDF page
  has no extractable text layer.

## Next steps (Monday delivery)

1. **Commit and push** all local changes to the repository.
2. **Deploy to Vercel** — promote the latest build to production
   (`https://tii-servicing-bot.vercel.app/`).
3. **Verify production env vars** — `ANTHROPIC_API_KEY`, Supabase URL/keys, and
   `ANTHROPIC_MODEL` must match the tested local configuration.
4. **Re-run ingest on production Supabase** — production must have page-tagged
   chunks from the updated ingest script:
   ```bash
   npm run ingest
   ```
   Confirm ~212 chunks with non-null `page` values before demo.
5. **Smoke-test production** — run `run-both-docs.mjs` and `run-random-pages.mjs`
   against the live URL; verify concierge, “why buy insurance?”, and page queries.
6. **Demo prep** — use the POC scope table above if the client asks about
   “general knowledge” limits; emphasize both PDFs are in the knowledge base.
7. **Post-POC enhancements** (optional):
   - Shared rate limiting (e.g. Upstash Redis) for multi-instance Vercel
   - Source citations in the chat UI
   - Vector/hybrid search if the document set grows
   - Authentication or embed behind TII’s portal

See also [`docs/test-questions.md`](docs/test-questions.md) for the full test
matrix and [`docs/architecture.md`](docs/architecture.md) for technical detail.
