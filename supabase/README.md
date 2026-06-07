# Supabase

This folder holds the database schema for the knowledge base.

## Apply the migration

**Option A — Supabase SQL Editor (quickest for the POC):**
Open your project → SQL Editor → paste the contents of
`migrations/0001_init.sql` → Run.

**Option B — Supabase CLI:**

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## What it creates

- `document_chunks` table with columns: `source`, `page`, `section`, `content`,
  plus a generated `tsvector` (`fts`) column and GIN index.
- `match_chunks(query_text, match_count)` RPC (legacy — the current API loads
  all chunks by source instead of calling this function).
- Row Level Security enabled (all access is via the server service-role key).

## After migration

Load the documents with page-aware ingest:

```bash
npm run ingest
```

Expected result: **~212 chunks**, all with non-null `page` values:
- Confirmation of Benefits: pages 1–4
- FlexiPAX Plan Document: pages 1–57

Re-run ingest whenever source PDFs change or when promoting to a new environment
(e.g. production Supabase must be ingested separately from local).

## Verify ingest

In the Supabase SQL editor:

```sql
select source, count(*) as chunks, min(page) as min_page, max(page) as max_page
from document_chunks
group by source
order by source;
```
