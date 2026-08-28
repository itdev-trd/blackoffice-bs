create table if not exists public.customer_report_cache (
  cache_key text primary key,
  page_id text not null,
  date_filter text not null,
  date_from text,
  date_to text,
  rows jsonb not null default '[]'::jsonb,
  total bigint not null default 0,
  refreshed_at timestamptz not null default now(),
  refreshed_by text
);

create index if not exists customer_report_cache_page_idx
  on public.customer_report_cache (page_id, refreshed_at desc);

alter table public.customer_report_cache enable row level security;
revoke all on table public.customer_report_cache from anon, authenticated;

comment on table public.customer_report_cache is
  'Shared customer database report snapshots. Access is only through the authorized customer-report Edge Function.';
