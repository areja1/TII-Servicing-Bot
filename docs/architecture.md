# Architecture

The TII Servicing Bot is a Retrieval-Augmented Generation (RAG) chat assistant
built as a single Next.js application.

## High-level flow

```
User (browser)
   │  message
   ▼
Next.js page  ──►  /api/chat (route handler)
                        │
                        │ 1. retrievePassages(query)
                        ▼
                Supabase Postgres  ── full-text search (match_chunks)
                        │            + always-include Confirmation of Benefits
                        ▼
                grounded context (source-tagged passages)
                        │ 2. buildSystemPrompt + guardrail directive
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
| Chat API | `src/app/api/chat/route.ts` | Orchestrates retrieval → prompt → model stream |
| Retrieval | `src/lib/retrieval/search.ts` | Postgres full-text search; always includes Confirmation of Benefits |
| Prompt | `src/lib/ai/prompt.ts` | System prompt + source-tagged context formatting |
| Guardrails | `src/lib/ai/guardrails.ts` | Deterministic checks for emergency / claim-outcome questions |
| Knowledge base | `supabase/migrations/0001_init.sql` | `document_chunks` table, `fts` index, `match_chunks` RPC |
| Ingestion | `scripts/ingest/ingest.ts` | Parses PDFs, chunks, tags, loads into Supabase |
| Config | `src/config/tii.ts` | TII phone numbers, website, source labels |

## Why these choices

- **Postgres full-text search (not vector search):** the corpus is small and
  fact-dense; lexical search over chunked text is fast, cheap, and easy to
  reason about. The Confirmation of Benefits is always injected so
  plan-specific facts are never missed.
- **Two-layer guardrails:** prompt-level rules plus deterministic backend
  checks so the safety-critical behaviors (no claim decisions, emergency
  routing) do not rely on the model alone.
- **Single Next.js app:** UI + API in one deployable unit on Vercel.
