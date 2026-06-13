-- ---------------------------------------------------------------------------
-- TII Servicing Bot - shared plan documents + per-traveler Confirmation of Benefits
--
-- This migration moves the live read path off the chunked `document_chunks`
-- table (kept for the parked retrieval scaffold) and onto two purpose-built
-- tables that make prompt caching effective:
--
--   plans  -- ONE clean full-text record per (plan_id, version), shared across
--            every traveler on that plan. This is the large, stable block that
--            gets cached once and read cheaply by everyone on the plan.
--   cob    -- per-traveler Confirmation of Benefits: structured purchased
--            amounts (JSONB) the model reads instead of parsing the PDF, plus
--            labeled page text so "summarize page N of my CoB" still works.
--
-- `document_chunks` (0001_init.sql) is intentionally left in place; it is off
-- the hot path and only used if/when the full-text retrieval scaffold is
-- switched back on (see src/lib/retrieval/search.ts + query-intents.ts).
-- ---------------------------------------------------------------------------

-- Shared plan document, one row per (plan_id, version).
create table if not exists public.plans (
  plan_id        text        not null,
  version        integer     not null default 1,
  effective_date date,
  jurisdiction   text,
  -- Clean, de-duplicated full text with labeled (p.N) page markers preserved.
  full_text      text        not null,
  -- Page metadata: { "pageCount": N, "pages": [{ "page": 1, "label": "(p.1)" }, ...] }.
  page_map       jsonb       not null default '{}'::jsonb,
  -- sha256 of full_text, used to make ingestion idempotent / detect drift.
  checksum       text        not null,
  -- Exactly one active row per plan_id is loaded at request time.
  is_active      boolean     not null default true,
  created_at     timestamptz not null default now(),
  primary key (plan_id, version)
);

-- At most one active version per plan_id.
create unique index if not exists plans_active_unique_idx
  on public.plans (plan_id)
  where is_active;

create index if not exists plans_plan_id_idx
  on public.plans (plan_id);

-- Per-traveler Confirmation of Benefits.
create table if not exists public.cob (
  plan_number     text        primary key,
  -- Which shared plan this CoB belongs to (used to load the right plans row).
  plan_id         text        not null,
  policyholder_id text,
  -- Structured, authoritative purchased amounts + trip facts. The model reads
  -- these fields directly; it never parses dollar amounts out of the PDF text.
  -- NOTE: the traveler's home/residential address is intentionally NOT stored
  -- here (privacy by omission).
  fields          jsonb       not null,
  -- Labeled (p.1)..(p.N) CoB page text, with private details (home address)
  -- redacted at ingest. Powers page-summary queries.
  page_text       text        not null,
  created_at      timestamptz not null default now()
);

create index if not exists cob_plan_id_idx
  on public.cob (plan_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: as with document_chunks, all access is server-side via
-- the service-role key, so RLS stays on with no public policies.
-- ---------------------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.cob   enable row level security;
