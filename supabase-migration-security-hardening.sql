-- Security hardening: explicit permissions, fail-closed RLS, and scoped writes.
-- Run after all existing migrations.

-- Existing restricted users previously defaulted to Analyze when allowed_tabs was empty.
update public.user_permissions
set allowed_tabs = '["analyze"]'::jsonb, updated_at = now()
where role = 'analyze_only' and allowed_tabs = '[]'::jsonb;

-- Every Auth user must have an explicit permission row. New/missing users start denied.
insert into public.user_permissions (email, role, allowed_ad_accounts, allowed_tabs, allowed_pages, allowed_settings)
select lower(email), 'analyze_only', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
from auth.users
where email is not null
on conflict (email) do nothing;

alter table public.profiles alter column role set default 'analyze_only';
update public.profiles set role = 'analyze_only' where role is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'analyze_only')
  on conflict (id) do nothing;

  if new.email is not null then
    insert into public.user_permissions
      (email, role, allowed_ad_accounts, allowed_tabs, allowed_pages, allowed_settings)
    values
      (lower(new.email), 'analyze_only', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
    on conflict (email) do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.app_has_permission()
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_permissions p
    where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and p.role in ('admin', 'analyze_only')
  );
$$;

create or replace function public.app_is_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_permissions p
    where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and p.role = 'admin'
  );
$$;

create or replace function public.app_has_tab(required_tab text)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.app_is_admin() or exists (
    select 1 from public.user_permissions p
    where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and p.role = 'analyze_only'
      and p.allowed_tabs ? required_tab
  );
$$;

create or replace function public.app_has_any_tab(required_tabs text[])
returns boolean
language sql
stable
set search_path = public
as $$
  select public.app_is_admin() or exists (
    select 1 from public.user_permissions p
    where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and p.role = 'analyze_only'
      and p.allowed_tabs ?| required_tabs
  );
$$;

create or replace function public.app_has_page(required_page text)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.app_is_admin() or exists (
    select 1 from public.user_permissions p
    where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and p.role = 'analyze_only'
      and required_page is not null
      and p.allowed_pages ? required_page
  );
$$;

create or replace function public.app_has_account(required_account text)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.app_is_admin() or exists (
    select 1 from public.user_permissions p
    where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and p.role = 'analyze_only'
      and replace(coalesce(required_account, ''), 'act_', '') <> ''
      and p.allowed_ad_accounts ? replace(required_account, 'act_', '')
  );
$$;

create or replace function public.app_has_setting(required_setting text)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.app_is_admin() or exists (
    select 1 from public.user_permissions p
    where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and p.role = 'analyze_only'
      and p.allowed_tabs ? 'settings'
      and p.allowed_settings ? required_setting
  );
$$;

create or replace function public.app_can_write_setting(setting_key text)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.app_is_admin()
    or (setting_key = 'campaign_defaults' and public.app_has_setting('campaign'))
    or (setting_key = 'optimization_thresholds' and public.app_has_setting('decision'))
    or (setting_key in ('brand_voice', 'brand_assets') and public.app_has_setting('brand'))
    or (setting_key = 'ai_models' and public.app_has_setting('ai_models'))
    or (setting_key = 'ai_prompts' and public.app_has_setting('ai_prompts'))
    or (setting_key = 'ghost_protection' and public.app_has_setting('ghost'))
    or (setting_key = 'chat_sync_config' and public.app_has_setting('synccfg'))
    or (setting_key = 'office_hours' and public.app_has_setting('replystats'))
    or (setting_key = 'leaderboard' and public.app_has_setting('leaderboard'))
    or (setting_key = 'game_office' and public.app_has_setting('chat'))
    or setting_key = 'inbox_page_filter:' || coalesce(auth.jwt() ->> 'email', '');
$$;

-- Permission rows are readable only by their owner, case-insensitively.
drop policy if exists "read own permission" on public.user_permissions;
create policy "read own permission" on public.user_permissions
  for select to authenticated
  using (lower(auth.jwt() ->> 'email') = lower(email));

-- Settings: explicit users may read; writes are admin or mapped sub-setting only.
drop policy if exists "settings: authenticated can read" on public.settings;
drop policy if exists "settings: authenticated can write" on public.settings;
drop policy if exists "settings: permitted read" on public.settings;
drop policy if exists "settings: scoped write" on public.settings;
create policy "settings: permitted read" on public.settings
  for select to authenticated using (public.app_has_permission());
create policy "settings: scoped write" on public.settings
  for all to authenticated
  using (public.app_can_write_setting(key))
  with check (public.app_can_write_setting(key));

-- Ads data: restricted users may read for granted tabs; mutations require admin.
drop policy if exists "ad_content: authenticated full access" on public.ad_content;
drop policy if exists "ad_content: permitted read" on public.ad_content;
drop policy if exists "ad_content: admin write" on public.ad_content;
create policy "ad_content: permitted read" on public.ad_content
  for select to authenticated
  using (public.app_has_any_tab(array['overview','review','campaigns','analyze']));
create policy "ad_content: admin write" on public.ad_content
  for all to authenticated using (public.app_is_admin()) with check (public.app_is_admin());

drop policy if exists "metrics_log: authenticated full access" on public.metrics_log;
drop policy if exists "metrics_log: permitted read" on public.metrics_log;
drop policy if exists "metrics_log: admin write" on public.metrics_log;
create policy "metrics_log: permitted read" on public.metrics_log
  for select to authenticated
  using (public.app_has_any_tab(array['overview','campaigns','analyze']));
create policy "metrics_log: admin write" on public.metrics_log
  for all to authenticated using (public.app_is_admin()) with check (public.app_is_admin());

drop policy if exists "ad_copies: authenticated full access" on public.ad_copies;
drop policy if exists "ad_copies: permitted read" on public.ad_copies;
drop policy if exists "ad_copies: admin write" on public.ad_copies;
create policy "ad_copies: permitted read" on public.ad_copies
  for select to authenticated using (public.app_has_any_tab(array['overview','generate','review']));
create policy "ad_copies: admin write" on public.ad_copies
  for all to authenticated using (public.app_is_admin()) with check (public.app_is_admin());

drop policy if exists "ad_images: authenticated full access" on public.ad_images;
drop policy if exists "ad_images: permitted read" on public.ad_images;
drop policy if exists "ad_images: admin write" on public.ad_images;
create policy "ad_images: permitted read" on public.ad_images
  for select to authenticated using (public.app_has_any_tab(array['overview','generate','review']));
create policy "ad_images: admin write" on public.ad_images
  for all to authenticated using (public.app_is_admin()) with check (public.app_is_admin());

drop policy if exists "ai_pairing_suggestions: authenticated full access" on public.ai_pairing_suggestions;
drop policy if exists "ai_pairing_suggestions: permitted read" on public.ai_pairing_suggestions;
drop policy if exists "ai_pairing_suggestions: admin write" on public.ai_pairing_suggestions;
create policy "ai_pairing_suggestions: permitted read" on public.ai_pairing_suggestions
  for select to authenticated using (public.app_has_tab('review'));
create policy "ai_pairing_suggestions: admin write" on public.ai_pairing_suggestions
  for all to authenticated using (public.app_is_admin()) with check (public.app_is_admin());

-- Chat/customer data: both the tab and the page must be granted.
drop policy if exists "read chat_customers" on public.chat_customers;
drop policy if exists "update chat_customers" on public.chat_customers;
create policy "read chat_customers" on public.chat_customers
  for select to authenticated
  using (
    public.app_has_any_tab(array['inbox','chat','customerdb'])
    and public.app_has_page(page_id)
  );
create policy "update chat_customers" on public.chat_customers
  for update to authenticated
  using (
    public.app_has_any_tab(array['inbox','chat','customerdb'])
    and public.app_has_page(page_id)
  )
  with check (
    public.app_has_any_tab(array['inbox','chat','customerdb'])
    and public.app_has_page(page_id)
  );

drop policy if exists "read chat_referrals" on public.chat_referrals;
create policy "read chat_referrals" on public.chat_referrals
  for select to authenticated
  using (public.app_has_any_tab(array['inbox','chat']) and public.app_has_page(page_id));

drop policy if exists "read page_lead_config" on public.page_lead_config;
drop policy if exists "write page_lead_config" on public.page_lead_config;
create policy "read page_lead_config" on public.page_lead_config
  for select to authenticated
  using (
    public.app_has_page(page_id)
    and (
      public.app_has_any_tab(array['inbox','chat','customerdb'])
      or public.app_has_tab('settings')
    )
  );
create policy "write page_lead_config" on public.page_lead_config
  for all to authenticated
  using (
    public.app_has_page(page_id)
    and (public.app_has_setting('leadfields') or public.app_has_setting('synccfg'))
  )
  with check (
    public.app_has_page(page_id)
    and (public.app_has_setting('leadfields') or public.app_has_setting('synccfg'))
  );

drop policy if exists "rw saved_replies" on public.saved_replies;
create policy "rw saved_replies" on public.saved_replies
  for all to authenticated
  using (
    public.app_is_admin()
    or (
      public.app_has_setting('savedreplies')
      and (page_id is null or public.app_has_page(page_id))
    )
  )
  with check (
    public.app_is_admin()
    or (
      public.app_has_setting('savedreplies')
      and (page_id is null or public.app_has_page(page_id))
    )
  );

drop policy if exists "read ad_config_snapshots" on public.ad_config_snapshots;
create policy "read ad_config_snapshots" on public.ad_config_snapshots
  for select to authenticated
  using (
    public.app_has_any_tab(array['campaigns','analyze'])
    and public.app_has_account(account_id)
  );

-- Storage writes: no longer granted to every authenticated user.
drop policy if exists "brand-assets: authenticated upload" on storage.objects;
drop policy if exists "brand-assets: authenticated update" on storage.objects;
drop policy if exists "brand-assets: authenticated delete" on storage.objects;
create policy "brand-assets: scoped upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'brand-assets' and public.app_has_setting('brand'));
create policy "brand-assets: scoped update" on storage.objects
  for update to authenticated
  using (bucket_id = 'brand-assets' and public.app_has_setting('brand'))
  with check (bucket_id = 'brand-assets' and public.app_has_setting('brand'));
create policy "brand-assets: scoped delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'brand-assets' and public.app_has_setting('brand'));

-- AI creatives are uploaded only by the service-role Edge Function.
drop policy if exists "ad-creatives: authenticated upload" on storage.objects;

drop policy if exists "chat-media upload" on storage.objects;
create policy "chat-media upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (
      (storage.foldername(name))[1] = 'saved' and public.app_has_setting('savedreplies')
      or public.app_has_page((storage.foldername(name))[1])
    )
  );

-- Ensure table grants do not accidentally restore unrestricted writes.
revoke insert, delete on public.chat_customers from authenticated;
revoke insert, update, delete on public.metrics_log from authenticated;
grant select on public.settings, public.ad_content, public.metrics_log, public.ad_copies, public.ad_images,
  public.ai_pairing_suggestions, public.chat_customers, public.chat_referrals, public.page_lead_config,
  public.saved_replies, public.ad_config_snapshots to authenticated;
grant insert, update, delete on public.settings, public.ad_content, public.ad_copies, public.ad_images,
  public.ai_pairing_suggestions, public.page_lead_config, public.saved_replies to authenticated;
grant update (stage, stage_manual, phone, trade_id, username, email, unread, updated_at)
  on public.chat_customers to authenticated;
