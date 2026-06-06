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

- `document_chunks` table with a generated `tsvector` (`fts`) column and a GIN
  index for full-text search.
- `match_chunks(query_text, match_count)` RPC used by the retrieval layer.
- Row Level Security enabled (all access is via the server service-role key).

After applying the migration, load the documents with `npm run ingest`.
