# Architecture

The TII Servicing Bot is a document-grounded chat assistant built as a single
Next.js application. Supabase stores chunked PDF text; the API loads the full
corpus on every request and sends it to Claude with servicing guardrails.

## High-level flow

```
User (browser)
   │  message
   ▼
Next.js page  ──►  /api/chat (route handler)
                        │
                        │ 0. rate limit + empty-input check
                        │
                        │ 1. retrievePassages() — load ALL chunks from both PDFs
                        ▼
                Supabase Postgres  ── document_chunks (source + page + content)
                        ▼
                formatContext() — passages grouped by document, sorted by page,
                                  labeled (p.N)
                        │
                        │ 2. buildSystemPrompt + turn directives
                        │    (guardrails, page-query hints)
                        ▼
                Claude Sonnet 4.6 (Anthropic, via Vercel AI SDK)
                        │ 3. streamed answer
                        ▼
                  User (browser)
```

## Components

| Area | File(s) | Responsibility |
|---|---|---|
| Chat UI | `src/components/chat/Chat.tsx`, `src/app/page.tsx` | Streaming chat interface, suggested questions |
| Chat API | `src/app/api/chat/route.ts` | Rate limit → load docs → prompt → model stream |
| Retrieval | `src/lib/retrieval/search.ts` | Full-document load; `pageQueryDirective()` for page questions |
| Prompt | `src/lib/ai/prompt.ts`, `src/lib/ai/grounding-rules.ts` | System instructions + formatted document context |
| Guardrails | `src/lib/ai/guardrails.ts` | Deterministic checks for emergency / claim-outcome questions |
| Rate limit | `src/lib/rate-limit.ts` | In-memory per-IP limit before model calls |
| Knowledge base | `supabase/migrations/0001_init.sql` | `document_chunks` table (FTS index exists but is unused in current flow) |
| Ingestion | `scripts/ingest/ingest.ts` | Page-by-page PDF parse, chunk, tag, load into Supabase |
| Cover supplement | `src/config/plan-document-cover.ts` | Plan Document page 1 text (PDF cover is image-only) |
| Config | `src/config/tii.ts` | TII phone numbers, website, source labels |

## Document corpus

| Document | Pages | Chunks (approx.) |
|---|---|---|
| Confirmation of Benefits | 1–4 | 8 |
| FlexiPAX Plan Document | 1–57 | 205 |
| **Total** | | **~212** |

Each chunk stores:
- `source` — `confirmation_of_benefits` or `plan_document`
- `page` — 1-indexed PDF page number
- `content` — extracted text (1200-char chunks with overlap)
- `section` — optional heading (when detected)

## Why full-document context

The corpus is small enough to load entirely on every request. This avoids
retrieval gaps that caused early POC failures (concierge services, page 4
assistance, sub-limits buried in dense tables). Trade-offs:

| Benefit | Cost |
|---|---|
| Every page and section always available | Higher token use per request |
| No missed passages from ranking | Not scalable to large document sets without change |
| Page queries work via `(p.N)` labels + turn directives | Model must locate the right page in a long context |

If the document set grows, consider hybrid retrieval (full CoB + ranked Plan
Document passages, or vector search) while keeping pinned critical sections.

## Page-specific questions

When the user mentions a page number (with or without naming the document):

1. Full text of both documents is still loaded.
2. `pageQueryDirective()` adds a turn-specific instruction telling the model
   which document and page to summarize using `(p.N)` labels.
3. If both documents share that page number and no document is named, the model
   is instructed to summarize each document separately.

Random page accuracy is validated by `scripts/test/run-random-pages.mjs`, which
extracts anchor terms directly from the source PDFs (not from Supabase) and
checks bot answers against them.

## Guardrails (two layers)

1. **Prompt-level** — `grounding-rules.ts` defines what the bot may and may not
   do, TII contact routing, privacy (withhold home address only), and response format.
2. **Deterministic** — `guardrails.ts` detects emergency and claim-outcome
   phrasing and appends reinforcing directives for that turn.

## Deployment notes

Local fixes are ineffective on production until **both** are true:

1. Latest code is deployed to Vercel.
2. Production Supabase has been re-ingested with page-tagged chunks.

The migration’s `match_chunks` RPC and FTS index remain in the schema from an
earlier retrieval design; the current API loads all rows by source instead.
