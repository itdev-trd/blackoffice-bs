-- Metadata for real-time comments that can be attached to more than one ad.
alter table public.chat_customers
  add column if not exists comment_ad_ids jsonb not null default '[]'::jsonb,
  add column if not exists comment_ad_names jsonb not null default '[]'::jsonb,
  add column if not exists comment_is_ad boolean not null default false,
  add column if not exists comment_promoted_to_inbox boolean not null default false;

update public.chat_customers
set comment_is_ad = true
where source = 'comment' and entry_ad_id is not null and comment_is_ad = false;

create index if not exists chat_customers_realtime_comments_page_idx
  on public.chat_customers (page_id, last_message_at desc)
  where source = 'comment';
