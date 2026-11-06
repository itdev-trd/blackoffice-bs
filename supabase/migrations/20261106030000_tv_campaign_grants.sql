-- กิจกรรมแจกสิทธิ์ Indicator ให้คนทั่วไป (ไม่ต้องมีไอดีเทรด) — ตัวกิจกรรมอยู่ใน settings.tv_campaigns
-- ตารางนี้จดว่าใครได้สิทธิ์จากกิจกรรมไหน · คนเดิมได้ได้ครั้งเดียวต่อกิจกรรม (unique campaign + username)
create table if not exists public.tv_campaign_grants (
  id bigserial primary key,
  campaign_id text not null,
  campaign_name text,
  username text not null,
  pine_ids text[] not null default '{}',
  expiration timestamptz,
  chat_id text,
  customer_name text,
  granted_by text,
  granted_at timestamptz not null default now()
);
create unique index if not exists tv_campaign_grants_once on public.tv_campaign_grants (campaign_id, lower(username));
create index if not exists tv_campaign_grants_campaign on public.tv_campaign_grants (campaign_id, granted_at desc);

alter table public.tv_campaign_grants enable row level security;
drop policy if exists "tv_campaign_grants read" on public.tv_campaign_grants;
create policy "tv_campaign_grants read" on public.tv_campaign_grants for select to authenticated using ((select public.app_has_tab('tv_members')));
drop policy if exists "tv_campaign_grants insert" on public.tv_campaign_grants;
create policy "tv_campaign_grants insert" on public.tv_campaign_grants for insert to authenticated
  with check ((select public.app_has_tab('tv_members')) and granted_by = (select auth.jwt() ->> 'email'));
