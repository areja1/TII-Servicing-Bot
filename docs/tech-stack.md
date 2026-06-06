# Travel Insured International: Servicing Bot
## Technology Stack

A publicly accessible chat assistant that answers travel-insurance servicing questions grounded in the provided documents, using Retrieval-Augmented Generation (RAG).

| Layer                   | Technology                            | Why                                                                                                                                             |
|---                      |---                                    |---                                                                                                                                              |
| Application             | Next.js (TypeScript)                  | Single project containing both the chat interface and the API; fast to build and deploy                                                         |
| Chat experience         | Vercel AI SDK                         | Real-time streaming responses for a smooth conversational feel                                                                                  |
| Language model          | Claude Sonnet 4.6 (Anthropic)         | Strong instruction-following for the guardrails and accurate, grounded answers over dense policy text                                           |
| Knowledge base          | Supabase (managed PostgreSQL)         | Stores the two documents as chunked, source-tagged text                                                                                         |
| Retrieval               | PostgreSQL full-text search           | Finds the relevant passages for each question; the Confirmation of Benefits is always included so plan-specific facts are never missed          |
| Document ingestion      | One-time processing script            | Parses the PDFs, splits into sections, tags each as Confirmation of Benefits vs Plan Document, and loads them into the knowledge base           |
| Guardrails              | Backend rules + prompt-level rules    | No claim decisions, no invented coverage, no medical or legal advice; answers stay grounded and escalate to the correct TII contact when needed |
| Hosting                 | Vercel                                | Public URL, no login required, credentials stored securely                                                                                      |

