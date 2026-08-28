-- ============================================================
-- AI Ads Automation — Supabase schema (รันครั้งแรกครั้งเดียว)
-- ไปที่ Supabase Dashboard → SQL Editor → New query → วางทั้งไฟล์ → Run
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- profiles (สิทธิ์จริงอ่านจาก user_permissions; ผู้ใช้ใหม่เริ่มแบบจำกัดสิทธิ์) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'analyze_only',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: user sees own row"
  on public.profiles for select
  using (auth.uid() = id);

-- สร้างแถว profiles อัตโนมัติทุกครั้งที่มีการสมัคร/เพิ่มผู้ใช้ใหม่ใน Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role) values (new.id, 'analyze_only');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- settings (key-value เดียว ใช้เก็บค่าปรับแต่งระบบทั้งหมด) ----------
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;

create policy "settings: authenticated can read"
  on public.settings for select
  to authenticated using (true);

create policy "settings: authenticated can write"
  on public.settings for all
  to authenticated using (true) with check (true);

-- ค่าเริ่มต้น (แก้ทีหลังได้จากหน้า "ตั้งค่า" ในเว็บแอป)
insert into public.settings (key, value) values
  ('campaign_defaults', jsonb_build_object(
    'daily_budget_thb', 300,
    'audience_id', '',
    'age_min', 22,
    'age_max', 55,
    'page_id', '',
    'pixel_id', '',
    'ad_account_id', '',
    'landing_url', ''
  )),
  ('optimization_thresholds', jsonb_build_object(
    'target_cpa_thb', 150,
    'min_spend_before_judging_thb', 200,
    'underperform_multiplier', 1.5,
    'outperform_multiplier', 0.7,
    'scale_up_pct', 20,
    'monitor_interval_minutes', 180
  )),
  ('brand_voice', jsonb_build_object(
    'brand_voice', 'เป็นกันเอง น่าเชื่อถือ ไม่โอเวอร์ ไม่การันตีกำไร',
    'target_audience_desc', 'นักเทรด forex/gold มือใหม่-กลาง อายุ 22-45 สนใจ passive income'
  ))
on conflict (key) do nothing;

-- ---------- ad_content (ตารางหลัก แทน Google Sheet เดิม) ----------
create table if not exists public.ad_content (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  product text,
  headline text,
  primary_text text,
  description text,
  cta text,
  image_prompt text,
  image_hash text,
  image_url text,
  status text not null default 'pending_approval',
  -- pending_approval | approved | rejected | active | paused_auto | paused_manual
  campaign_id text,
  adset_id text,
  ad_id text,
  daily_budget_thb integer,
  scale_suggested boolean not null default false,
  suggested_budget_thb integer,
  notes text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz
);

alter table public.ad_content enable row level security;

create policy "ad_content: authenticated full access"
  on public.ad_content for all
  to authenticated using (true) with check (true);

-- ---------- metrics_log (ประวัติผลลัพธ์ทุกรอบที่ monitor-ads เช็ค) ----------
create table if not exists public.metrics_log (
  id bigserial primary key,
  checked_at timestamptz not null default now(),
  ad_content_id uuid references public.ad_content(id) on delete cascade,
  spend numeric,
  leads numeric,
  cpa numeric,
  verdict text
);

alter table public.metrics_log enable row level security;

create policy "metrics_log: authenticated full access"
  on public.metrics_log for all
  to authenticated using (true) with check (true);

create index if not exists idx_metrics_log_ad_content_id on public.metrics_log(ad_content_id);
create index if not exists idx_ad_content_status on public.ad_content(status);

-- ---------- Storage bucket สำหรับรูปโฆษณาที่ AI สร้าง ----------
insert into storage.buckets (id, name, public)
values ('ad-creatives', 'ad-creatives', true)
on conflict (id) do nothing;

create policy "ad-creatives: public read"
  on storage.objects for select
  using (bucket_id = 'ad-creatives');

create policy "ad-creatives: authenticated upload"
  on storage.objects for insert
  to authenticated with check (bucket_id = 'ad-creatives');

create policy "ad-creatives: service role full access"
  on storage.objects for all
  to service_role using (bucket_id = 'ad-creatives');
