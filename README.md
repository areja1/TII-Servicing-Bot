# TII Servicing Bot

A publicly accessible text-chat assistant for **Travel Insured International (TII)**
that answers travel-insurance servicing questions grounded in two documents:
the traveler's **Confirmation of Benefits** and the **FlexiPAX Plan Document**.

It uses Retrieval-Augmented Generation (RAG): each question is answered using
passages retrieved from the documents, with guardrails that prevent claim
decisions, invented benefits, and medical/legal advice, and that escalate
urgent issues to the correct TII contact.

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
| Retrieval | PostgreSQL full-text search (Confirmation of Benefits always included) |
| Ingestion | One-time PDF parsing + chunking + tagging script |
| Guardrails | Backend rules + prompt-level rules |
| Hosting | Vercel |

See [`docs/architecture.md`](docs/architecture.md) for the full flow.

## Project structure

```
TII-Servicing-Bot/
├── src/
│   ├── app/
│   │   ├── api/chat/route.ts     # RAG chat endpoint (retrieve → prompt → stream)
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Chat page
│   │   └── globals.css
│   ├── components/chat/Chat.tsx  # Streaming chat UI
│   ├── lib/
│   │   ├── ai/prompt.ts          # System prompt + source-tagged context
│   │   ├── ai/guardrails.ts      # Deterministic safety checks
│   │   ├── retrieval/search.ts   # Full-text search retrieval
│   │   └── supabase/server.ts    # Server-side Supabase client
│   ├── config/tii.ts             # TII contacts + source labels
│   └── types/index.ts
├── supabase/
│   ├── migrations/0001_init.sql  # Schema, FTS index, match_chunks RPC
│   └── README.md
├── scripts/ingest/ingest.ts      # One-time document ingestion
├── docs/
│   ├── architecture.md
│   ├── test-questions.md         # 10 required scenarios + edge cases
│   ├── tech-stack.md
│   └── source-documents/         # The two source PDFs
├── .env.example
├── .gitignore
└── package.json
```

## Getting started

### 1. Prerequisites
- Node.js 20+ (this repo is developed on Node 22)
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

### 6. Run locally
```bash
npm run dev
```
Open http://localhost:3000.

## Model choice

**Claude Sonnet 4.6** was chosen for strong instruction-following — important
for enforcing the guardrails — and for accurate, grounded answers over dense
policy text.

## Retrieval approach

PostgreSQL full-text search ranks chunked passages by relevance to the
question. Because the corpus is small and fact-dense, lexical search is fast,
cheap, and transparent. The **Confirmation of Benefits is always included** in
the context so plan-specific facts (plan number, trip dates, destination,
purchased options) are never missed.

## Guardrails

- No claim approval/denial or outcome prediction.
- No invented benefits, amounts, dates, or contacts.
- No medical, legal, or financial advice.
- Grounded answers only; route to TII when the documents don't cover a question.
- Emergency / evacuation questions are routed to the 24/7 assistance line.

Enforced in two layers: the system prompt (`src/lib/ai/prompt.ts`) and
deterministic backend checks (`src/lib/ai/guardrails.ts`).

## Limitations & next steps

- Ingestion chunking is size-based; heading/section detection should be tuned
  per document for better citations.
- Full-text search can miss paraphrased queries; consider adding vector/hybrid
  search if recall is insufficient.
- No authentication (public POC by design). A lightweight in-memory per-IP
  rate limit (`src/lib/rate-limit.ts`, default 15 req/min via
  `RATE_LIMIT_PER_MIN`) guards the endpoint; for production, move this to a
  shared store (e.g. Upstash Redis) since the in-memory limit is per-instance
  and resets on restart.
- Answer-level source citations in the UI are a planned enhancement.
