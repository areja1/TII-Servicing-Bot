# Supabase

This folder holds the database schema for the knowledge base.

## Apply the migrations

Apply **both** migrations in order.

**Option A — Supabase SQL Editor (quickest for the POC):**
Open your project → SQL Editor → paste the contents of
`migrations/0001_init.sql`, Run, then `migrations/0002_plans_cob.sql`, Run.

**Option B — Supabase CLI:**

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## What they create

`0001_init.sql` (parked retrieval scaffold):
- `document_chunks` table: `source`, `page`, `section`, `content`, plus a
  generated `tsvector` (`fts`) column and GIN index.
- `match_chunks(query_text, match_count)` RPC (legacy FTS path).

`0002_plans_cob.sql` (the live read path):
- `plans` — ONE clean full-text record per `(plan_id, version)`, with page
  boundaries preserved as labeled `(p.N)` markers, a `checksum`, and an
  `is_active` flag. This is the large, stable, plan-shared block that prompt
  caching reuses across every traveler on the plan.
- `cob` — per-traveler Confirmation of Benefits: structured purchased amounts
  (`fields` JSONB) the model reads instead of parsing the PDF, plus labeled
  `page_text` (home address redacted at ingest).

Row Level Security is enabled on all tables (access is via the server
service-role key only).

## After migration

Load the documents:

```bash
npm run ingest
```

This populates `plans` (one active FlexiPAX full-text record), `cob` (the
traveler's structured fields + labeled page text), and re-syncs
`document_chunks` for the parked path.

> Privacy: before ingesting, optionally set `COB_REDACT_STRINGS` in `.env.local`
> to the traveler's home-address lines (pipe-separated) so they are stripped from
> the CoB page text (privacy by omission). The prompt-level privacy rule remains
> the backstop, and the loader re-applies redaction at read time.

Re-run ingest whenever source PDFs change or when promoting to a new environment
(e.g. production Supabase must be ingested separately from local).

## Verify ingest

In the Supabase SQL editor:

```sql
-- Live read path
select plan_id, version, is_active, length(full_text) as chars,
       page_map->>'pageCount' as pages
from plans;

select plan_number, plan_id, jsonb_pretty(fields) as fields
from cob;

-- Parked path
select source, count(*) as chunks, min(page) as min_page, max(page) as max_page
from document_chunks
group by source
order by source;
```
