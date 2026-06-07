# Travel Insured International: Servicing Bot
## Technology Stack

A publicly accessible chat assistant that answers travel-insurance servicing
questions grounded in the Confirmation of Benefits and FlexiPAX Plan Document.

| Layer | Technology | Why |
|---|---|---|
| Application | Next.js (TypeScript) | Single project for chat UI and API; fast to build and deploy |
| Chat experience | Vercel AI SDK | Real-time streaming responses |
| Language model | Claude Sonnet 4.6 (Anthropic) | Strong instruction-following for guardrails and dense policy text |
| Knowledge base | Supabase (managed PostgreSQL) | Stores chunked, source-tagged, page-tagged document text |
| Context loading | Full-document load per request | Small corpus (~212 chunks); ensures all pages/sections are always available |
| Document ingestion | `scripts/ingest/ingest.ts` | Page-by-page PDF parse, chunk, tag, and load |
| Guardrails | Backend rules + prompt-level rules | No claim decisions, no invented coverage, correct TII escalation |
| Rate limiting | In-memory per-IP (`src/lib/rate-limit.ts`) | Protects public endpoint and API key |
| Hosting | Vercel | Public URL, no login, secure env vars |

See [`architecture.md`](architecture.md) for the request flow and [`../README.md`](../README.md) for setup and next steps.
