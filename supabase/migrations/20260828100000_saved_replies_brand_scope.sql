-- Scope canned replies by brand in addition to page.
alter table public.saved_replies add column if not exists brand_id bigint references public.tv_brands(id) on delete set null;
create index if not exists saved_replies_brand_page_idx on public.saved_replies (brand_id, page_id, sort, created_at);
