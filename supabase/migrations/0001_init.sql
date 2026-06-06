-- ---------------------------------------------------------------------------
-- TII Servicing Bot - knowledge base schema
-- PostgreSQL full-text search over chunked, source-tagged document text.
-- ---------------------------------------------------------------------------

-- Each row is one chunk of text from one of the two source documents.
create table if not exists public.document_chunks (
  id          uuid primary key default gen_random_uuid(),
  -- 'confirmation_of_benefits' | 'plan_document'
  source      text not null check (source in ('confirmation_of_benefits', 'plan_document')),
  section     text,
  page        integer,
  content     text not null,
  -- Generated tsvector column kept in sync automatically.
  fts         tsvector generated always as (to_tsvector('english', content)) stored,
  created_at  timestamptz not null default now()
);

create index if not exists document_chunks_fts_idx
  on public.document_chunks using gin (fts);

create index if not exists document_chunks_source_idx
  on public.document_chunks (source);

-- ---------------------------------------------------------------------------
-- Full-text search RPC used by the retrieval layer.
-- Returns the top `match_count` chunks ranked by relevance to `query_text`.
-- websearch_to_tsquery handles natural-language input gracefully.
-- ---------------------------------------------------------------------------
create or replace function public.match_chunks(
  query_text  text,
  match_count integer default 6
)
returns table (
  id      uuid,
  source  text,
  section text,
  page    integer,
  content text,
  rank    real
)
language sql
stable
as $$
  select
    c.id,
    c.source,
    c.section,
    c.page,
    c.content,
    ts_rank(c.fts, websearch_to_tsquery('english', query_text)) as rank
  from public.document_chunks c
  where c.fts @@ websearch_to_tsquery('english', query_text)
  order by rank desc
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security: the browser never reads chunks directly. All access
-- goes through the server (service role key), so we keep RLS on with no
-- public policies.
-- ---------------------------------------------------------------------------
alter table public.document_chunks enable row level security;
