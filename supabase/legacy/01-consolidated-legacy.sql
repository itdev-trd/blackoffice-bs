-- ======================================================================
-- FILE: supabase-schema.sql
-- ======================================================================

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

-- ======================================================================
-- FILE: supabase-migration-account-opened.sql
-- ======================================================================

-- ป้าย "ลูกค้าเปิดบัญชีใหม่" — ประทับเวลาเมื่อแอดมินกดส่งป้ายนี้ไป Meta สำเร็จ
-- ใช้ตอนสร้างตาราง "สรุปรายวัน" ใน PDF แดชบอร์ดรายแอด (นับจำนวนเปิดบัญชีต่อวันต่อแอด)
alter table public.chat_customers
  add column if not exists account_opened_at timestamptz;

-- ช่วยให้ query "นับเปิดบัญชีต่อแอดต่อวัน" เร็ว (กรอง entry_ad_id + ไม่ว่าง)
create index if not exists chat_customers_account_opened_idx
  on public.chat_customers (entry_ad_id, account_opened_at)
  where account_opened_at is not null;

-- ======================================================================
-- FILE: supabase-migration-activity-log.sql
-- ======================================================================

-- บันทึกกิจกรรมการใช้งาน (audit log): ใครเข้าใช้ เมื่อไหร่ ทำอะไร จากที่ไหน device อะไร
create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  email text,
  event text not null,           -- login / logout / pull_report / open_dashboard / ai_analyze ...
  detail jsonb,                  -- รายละเอียดเพิ่ม เช่น ชื่อแคมเปญ/แอดที่เปิด
  ip text,
  location text,                 -- เมือง, ประเทศ (จาก IP)
  user_agent text,
  device text,                   -- สรุปอุปกรณ์/เบราว์เซอร์
  created_at timestamptz not null default now()
);

create index if not exists activity_log_created_idx on public.activity_log (created_at desc);
create index if not exists activity_log_email_idx on public.activity_log (email);

-- ล็อกให้เขียน/อ่านผ่าน edge function (service role) เท่านั้น — ไม่เปิด policy ให้ client เข้าตรง
alter table public.activity_log enable row level security;

-- ======================================================================
-- FILE: supabase-migration-ad-archive.sql
-- ======================================================================

-- ซ่อนแอดออกจากรายการหน้า "แคมเปญ" และ "วิเคราะห์" โดยไม่ลบข้อมูล
-- ทำไมไม่ลบทิ้ง: metrics_log ผูกกับ ad_content แบบ on delete cascade
-- ถ้าลบแถวแอด ประวัติผลทั้งหมดของแอดนั้น (หลักร้อยรายการ) จะหายตามไปด้วยและกู้คืนไม่ได้
-- ใช้ธง archived_at แทน = หน้าเว็บไม่แสดง แต่ข้อมูล/ประวัติยังอยู่ครบ กดกู้คืนได้ตลอด
alter table public.ad_content add column if not exists archived_at timestamptz;

comment on column public.ad_content.archived_at is 'เวลาที่ถูกซ่อนออกจากรายการ (null = แสดงปกติ) — ข้อมูลและ metrics_log ยังอยู่ครบ';

-- index บางส่วน: ดึงเฉพาะรายการที่ยังไม่ถูกซ่อนได้เร็ว
create index if not exists ad_content_active_idx on public.ad_content (created_at desc) where archived_at is null;

-- ======================================================================
-- FILE: supabase-migration-ad-config-snapshots.sql
-- ======================================================================

-- เก็บ snapshot การตั้งค่าโฆษณา (targeting/creative/งบ) เป็นเวอร์ชัน เพื่อดูย้อนหลัง/เทียบ diff
-- บันทึกเฉพาะเมื่อค่าเปลี่ยน (เทียบ hash) เพื่อประหยัดพื้นที่
create table if not exists public.ad_config_snapshots (
  id bigint generated always as identity primary key,
  node_id text not null,
  node_level text not null,          -- campaign / adset / ad
  account_id text,
  hash text not null,
  config jsonb not null,             -- ค่าที่ตั้งไว้ (targeting/creative/งบ ฯลฯ)
  summary text,                      -- สรุปสั้นๆ อ่านง่าย
  captured_at timestamptz not null default now()
);
create index if not exists ad_config_snapshots_node_idx on public.ad_config_snapshots (node_id, captured_at desc);

alter table public.ad_config_snapshots enable row level security;
drop policy if exists "read ad_config_snapshots" on public.ad_config_snapshots;
create policy "read ad_config_snapshots" on public.ad_config_snapshots for select using (auth.role() = 'authenticated');
-- insert ทำผ่าน service role (ฟังก์ชัน snapshot-config) เท่านั้น

-- ======================================================================
-- FILE: supabase-migration-ad-insights-cache.sql
-- ======================================================================

-- Cache ผลแดชบอร์ด ads (ad-insights) ใช้ร่วมกันทุก user — ใครดึงแล้วคนอื่นเปิดได้เลย ไม่ยิง Meta ซ้ำ
-- key = "{level}:{node_id}:{range_key}" · เก็บ payload ทั้งก้อน + เวลาที่ดึง
create table if not exists public.ad_insights_cache (
  cache_key text primary key,
  node_id text not null,
  level text not null,
  range_key text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);
create index if not exists ad_insights_cache_fetched_idx on public.ad_insights_cache (fetched_at);
create index if not exists ad_insights_cache_node_idx on public.ad_insights_cache (node_id);

-- อ่าน/เขียนผ่าน edge function (service role) เท่านั้น
alter table public.ad_insights_cache enable row level security;

-- ตั้งค่า TTL cache (นาที) เก็บใน settings.insights_cache_ttl_min (ว่าง = ใช้ค่าเริ่มต้นในโค้ด 360 นาที)
-- ตั้งค่าช่วงเวลาที่ให้ cron ดึงล่วงหน้าใน settings.insights_prefetch (ทำใน Phase ถัดไป)

-- ======================================================================
-- FILE: supabase-migration-ai-attempts.sql
-- ======================================================================

-- ตัวนับความพยายามของ AI ต่อแชท — กันแชทที่โมเดลตอบไม่ได้ (JSON เพี้ยน/id หาย) ค้างหัวคิววนยิงซ้ำไม่จบ
-- job classify/verify จะข้ามแถวที่ลองเกิน 5 ครั้ง และตัวนับรีเซ็ตเป็น 0 อัตโนมัติเมื่อเนื้อหาแชทเปลี่ยน
-- ** ต้องรันไฟล์นี้ก่อน deploy sync-conversations / meta-webhook เวอร์ชันใหม่ **
alter table public.chat_customers add column if not exists ai_attempts int not null default 0;
alter table public.chat_customers add column if not exists verify_attempts int not null default 0;

-- ======================================================================
-- FILE: supabase-migration-alert-per-user.sql
-- ======================================================================

-- ตั้งค่าแจ้งเตือน "แชทค้างอ่าน" แบบรายผู้ใช้ — แอดมินคุมทั้งหมด ผู้ใช้ปรับเองไม่ได้
-- เดิม: เกณฑ์นาที + เพจที่เตือน เก็บใน localStorage ของแต่ละเครื่อง (ผู้ใช้เปลี่ยน/ปิดเองได้ และหายเมื่อล้างแคช)
-- ใหม่: เก็บใน user_permissions ให้แอดมินกำหนดรายคน เพราะแต่ละคนดูแลคนละเพจ
alter table public.user_permissions add column if not exists alert_minutes int not null default 3;         -- ค้างอ่านเกินกี่นาทีถึงเตือน
alter table public.user_permissions add column if not exists alert_pages jsonb not null default '[]'::jsonb; -- page_id ที่ให้เตือน (ว่าง = ทุกเพจที่ผู้ใช้เข้าถึงได้)
alter table public.user_permissions add column if not exists alert_sound boolean not null default true;     -- เสียงเตือน

comment on column public.user_permissions.alert_minutes is 'แจ้งเตือนเมื่อแชทค้างอ่านเกินกี่นาที (แอดมินตั้งให้)';
comment on column public.user_permissions.alert_pages is 'เพจที่ผู้ใช้คนนี้จะได้รับแจ้งเตือน — ว่าง = ทุกเพจที่เข้าถึงได้';

-- ======================================================================
-- FILE: supabase-migration-app-secrets.sql
-- ======================================================================

-- ============================================================
-- Migration: เก็บ META_ACCESS_TOKEN ในฐานข้อมูล เพื่อให้ตั้ง/ต่ออายุได้จากหน้าเว็บแอป
-- ตารางนี้ "ฝั่งเว็บ (authenticated) อ่าน/เขียนตรงไม่ได้" — มีแต่ service role (Edge Functions) เท่านั้น
-- การตั้งค่า token ต้องผ่าน Edge Function `set-meta-token` เท่านั้น (กัน token หลุดไปฝั่ง client)
-- รันใน Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run
-- ============================================================

create table if not exists public.app_secrets (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table public.app_secrets enable row level security;
-- ไม่สร้าง policy ใดๆ ให้ anon/authenticated => เข้าถึงตรงไม่ได้เลย
-- service role (Edge Functions) bypass RLS อยู่แล้ว จึงอ่าน/เขียนได้ฝ่ายเดียว

-- ======================================================================
-- FILE: supabase-migration-brand-assets.sql
-- ======================================================================

-- ============================================================
-- Migration: เพิ่ม storage bucket สำหรับโลโก้/ป้ายริบบิ้นแบรนด์
-- รันหลังจาก supabase-schema.sql และ supabase-migration-split-copy-image.sql แล้ว
-- ไปที่ Supabase Dashboard → SQL Editor → New query → วางทั้งไฟล์ → Run
-- ============================================================

-- ---------- Storage bucket สำหรับโลโก้/ริบบิ้นที่แอดมินอัปโหลดเอง ----------
insert into storage.buckets (id, name, public)
values ('brand-assets', 'brand-assets', true)
on conflict (id) do nothing;

create policy "brand-assets: public read"
  on storage.objects for select
  using (bucket_id = 'brand-assets');

create policy "brand-assets: authenticated upload"
  on storage.objects for insert
  to authenticated with check (bucket_id = 'brand-assets');

create policy "brand-assets: authenticated update"
  on storage.objects for update
  to authenticated using (bucket_id = 'brand-assets');

create policy "brand-assets: authenticated delete"
  on storage.objects for delete
  to authenticated using (bucket_id = 'brand-assets');

create policy "brand-assets: service role full access"
  on storage.objects for all
  to service_role using (bucket_id = 'brand-assets');

-- ---------- settings: เพิ่มคีย์ brand_assets (โลโก้/ริบบิ้น + ตำแหน่งที่จะวาง) ----------
insert into public.settings (key, value) values
  ('brand_assets', jsonb_build_object(
    'logo_url', '',
    'logo_position', 'bottom-right',
    -- 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'bottom-center' | 'top-center'
    'logo_scale_pct', 15,
    -- ขนาดโลโก้เทียบกับความกว้างภาพ (%)
    'ribbon_url', '',
    'ribbon_position', 'top-left',
    'ribbon_scale_pct', 25,
    'placement_notes', ''
    -- คำอธิบายเพิ่มเติมเป็นข้อความอิสระ เช่น "อยากให้โลโก้อยู่มุมขวาล่างเสมอ ห่างขอบนิดหน่อย"
  ))
on conflict (key) do nothing;

-- ======================================================================
-- FILE: supabase-migration-chat-ai-jobs.sql
-- ======================================================================

-- แยกงาน AI ออกจากการซิงก์:
--   ปุ่มซิงก์  = ดึงข้อมูลลูกค้าอย่างเดียว (กฎฟรี + แท็กแอดมิน) ไม่ใช้ AI
--   ปุ่ม AI เล็ก = จัดสถานะลูกค้าที่ยัง ≠ สร้างคอนเวอร์ชั่น และเนื้อหาแชทอัปเดต  → มาร์ค "โดย AI"
--   ปุ่ม AI ใหญ่ = ตรวจซ้ำลูกค้าสถานะ สร้างคอนเวอร์ชั่น + มีคุณสมบัติ            → มาร์ค "AI ✓"
alter table public.chat_customers add column if not exists content_hash text;                          -- hash เนื้อหาแชทล่าสุด (ไว้เทียบว่ามีอัปเดตไหม)
alter table public.chat_customers add column if not exists needs_ai boolean not null default true;      -- ต้องให้ AI ตัวเล็กจัดสถานะ (มีข้อมูลอัปเดต)
alter table public.chat_customers add column if not exists needs_verify boolean not null default false; -- ต้องให้ AI ตัวใหญ่ตรวจซ้ำ

-- index บางส่วน (เฉพาะแถวที่ต้องทำงาน) — ให้ปุ่ม AI ดึง candidate ได้เร็ว
create index if not exists chat_customers_needs_ai_idx on public.chat_customers (last_message_at desc) where needs_ai;
create index if not exists chat_customers_needs_verify_idx on public.chat_customers (last_message_at desc) where needs_verify;

-- ======================================================================
-- FILE: supabase-migration-chat-ai.sql
-- ======================================================================

-- ฟิลด์สำหรับการจัดสถานะด้วย AI (ไฮบริด: กฎ + AI เฉพาะเคสก้ำกึ่ง)
alter table public.chat_customers add column if not exists ai_hash text;        -- hash เนื้อแชทที่ AI จัดล่าสุด (กันยิงซ้ำ)
alter table public.chat_customers add column if not exists ai_reason text;      -- เหตุผลสั้นๆ จาก AI
alter table public.chat_customers add column if not exists classified_by text;  -- 'rule' | 'ai'

-- เลือกได้ว่าเพจไหนใช้ AI (เมื่อเปิด AI แบบ global แล้ว)
alter table public.page_lead_config add column if not exists use_ai boolean not null default true;

-- ค่า AI ใน settings.chat_sync_config (เพิ่ม key ย่อย): ai_enabled, ai_model, ai_mode, ai_max_per_run
-- ตัวอย่าง (ไม่บังคับรัน):
-- update public.settings set value = value || '{"ai_enabled":false,"ai_model":"gpt-4o-mini","ai_mode":"ambiguous","ai_max_per_run":150}'::jsonb where key='chat_sync_config';

-- ======================================================================
-- FILE: supabase-migration-chat-alert-user.sql
-- ======================================================================

-- สิทธิ์รับแจ้งเตือน "แชทค้างอ่าน" ต่อผู้ใช้ (admin เปิด/ปิดให้แต่ละคนได้จากหน้าจัดการสิทธิ์)
alter table public.user_permissions add column if not exists chat_alert boolean not null default true;
-- เด้งเตือน "ทุกข้อความใหม่" ทันที (เหมือน Messenger) — admin เปิด/ปิดต่อผู้ใช้
alter table public.user_permissions add column if not exists alert_new boolean not null default true;

-- ======================================================================
-- FILE: supabase-migration-chat-block.sql
-- ======================================================================

-- ระบบบล็อก/สแปมแชท (chat_customers)
-- แชทที่ถูกบล็อก = ซ่อนจากลิสต์ + ข้อความใหม่ไม่เด้ง/ไม่แจ้งเตือน (แต่ยังเก็บประวัติไว้)
-- ตั้ง/ปลดผ่าน edge function "block-customer" (service role) หรือ sync spam-folder poll
alter table public.chat_customers add column if not exists blocked_at timestamptz;      -- เวลาที่ถูกบล็อก (null = ปกติ)
alter table public.chat_customers add column if not exists blocked_by text;             -- ใครบล็อก (อีเมลพนักงาน) หรือ "spam-folder" (จากเพจ)
alter table public.chat_customers add column if not exists blocked_reason text;          -- เหตุผล (ไม่บังคับ)

-- index บางส่วน: ดึงรายการที่ถูกบล็อกได้เร็ว (หน้า "ดูที่บล็อกไว้")
create index if not exists chat_customers_blocked_idx on public.chat_customers (last_message_at desc) where blocked_at is not null;

-- หมายเหตุ: การตั้ง/ปลด blocked_at ทำผ่าน service role (edge function) เท่านั้น
-- client (authenticated) อ่าน blocked_at ได้ (ใช้กรองลิสต์) แต่แก้ไม่ได้ (ไม่อยู่ใน grant update ของ chat-rls-columns)

-- ======================================================================
-- FILE: supabase-migration-chat-comments.sql
-- ======================================================================

-- คอมเมนต์ใต้โฆษณา/โพสต์ — เก็บเป็น "บทสนทนา" ในกล่องแชทเดียวกัน (source = 'comment')
-- id ของแถวใช้รูปแบบ  fbc_<comment_id>  เพื่อไม่ชนกับ conversation id ของ Messenger
alter table public.chat_customers
  add column if not exists comment_post_id  text,   -- post id ของโพสต์/แอดที่ถูกคอมเมนต์
  add column if not exists comment_permalink text,   -- ลิงก์เปิดดูคอมเมนต์/โพสต์บน Facebook
  add column if not exists comment_ad_name  text;    -- ชื่อแอด (ถ้ารู้จากตอนดึงย้อนหลัง)

-- ช่วยกรอง/แสดงเฉพาะคอมเมนต์ได้เร็ว
create index if not exists chat_customers_source_idx on public.chat_customers (source);

-- ======================================================================
-- FILE: supabase-migration-chat-customers.sql
-- ======================================================================

-- ลูกค้าจากแชท Messenger + ระยะสถานะ (lead lifecycle) ที่ระบบติดให้อัตโนมัติ
-- stage: new (มาใหม่) / qualified (มีคุณสมบัติ) / converted (สร้างคอนเวอร์ชั่นแล้ว) / ghost (แชทผี)
create table if not exists public.chat_customers (
  id text primary key,                 -- conversation id จาก Meta
  page_id text,
  page_name text,
  psid text,                           -- page-scoped user id
  customer_name text,
  message_count int not null default 0,       -- ข้อความรวมทั้งสองฝั่ง
  user_message_count int not null default 0,  -- ข้อความจากลูกค้า
  phone text,                          -- เบอร์ที่พบในข้อความลูกค้า (ถ้ามี)
  province text,                       -- จังหวัดที่พบในข้อความลูกค้า (ถ้ามี)
  last_user_text text,                 -- ข้อความล่าสุดของลูกค้า (ตัดสั้น)
  last_message_at timestamptz,
  stage text not null default 'new',   -- สถานะที่ใช้จริง (manual override ถ้ามี ไม่งั้นใช้ auto)
  stage_auto text not null default 'new',
  stage_manual text,                   -- ถ้าแอดมินตั้งเอง จะทับ auto
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_customers_stage_idx on public.chat_customers (stage);
create index if not exists chat_customers_last_msg_idx on public.chat_customers (last_message_at desc);

alter table public.chat_customers enable row level security;

-- ทีมงานที่ล็อกอินอ่านได้ และแก้สถานะเองได้ (manual) ; insert/ลบทำผ่าน service role (ฟังก์ชันซิงก์) เท่านั้น
drop policy if exists "read chat_customers" on public.chat_customers;
create policy "read chat_customers" on public.chat_customers for select using (auth.role() = 'authenticated');
drop policy if exists "update chat_customers" on public.chat_customers;
create policy "update chat_customers" on public.chat_customers for update using (auth.role() = 'authenticated');

-- ======================================================================
-- FILE: supabase-migration-chat-detail.sql
-- ======================================================================

-- ฟิลด์เพิ่มสำหรับหน้า "ฐานข้อมูลลูกค้า":
--   email      = อีเมลที่พบในข้อความลูกค้า (ถ้ามี)
--   transcript = บทสนทนาที่ดึงมา (ทั้งสองฝั่ง) ไว้กดดูรายคนว่าดึงอะไรมาวิเคราะห์
--                รูปแบบ: [{ "w": "u"|"p", "t": "ข้อความ", "at": "timestamp" }, ...]  (u = ลูกค้า, p = เพจ)
alter table public.chat_customers add column if not exists email text;
alter table public.chat_customers add column if not exists transcript jsonb;

-- หมายเหตุ: source / entry_ad_id (แหล่งที่มา/แอดตัวไหน) มีคอลัมน์อยู่แล้วจาก migration ก่อนหน้า
-- แต่การรู้ว่ามาจาก "แอดตัวไหน" ต้องรับค่า ad_id จาก Messenger referral webhook (แยกต่างหาก)

-- ======================================================================
-- FILE: supabase-migration-chat-inbox.sql
-- ======================================================================

-- หน้า "ตอบแชท" (Inbox สไตล์ Messenger + แปลอัตโนมัติ)
alter table public.chat_customers add column if not exists awaiting_reply boolean not null default false; -- ข้อความล่าสุดมาจากลูกค้า (เรายังไม่ได้ตอบ)
alter table public.chat_customers add column if not exists cust_lang text;    -- ภาษาลูกค้าที่ตรวจได้ (เช่น Vietnamese, Bahasa Indonesia, Tagalog)
alter table public.chat_customers add column if not exists country text;      -- ประเทศที่คาดว่าลูกค้าอยู่ (เดาจากภาษา/บริบท)

-- index: ลิสต์ "ยังไม่ได้ตอบ" เรียงตามเวลาล่าสุด
create index if not exists chat_customers_awaiting_idx on public.chat_customers (last_message_at desc) where awaiting_reply;

-- ======================================================================
-- FILE: supabase-migration-chat-leadconfig.sql
-- ======================================================================

-- เพิ่มฟิลด์ให้ chat_customers + ตั้งค่าข้อมูลที่ต้องการต่อเพจ (page_lead_config)

alter table public.chat_customers add column if not exists source text;          -- organic / ad / unknown
alter table public.chat_customers add column if not exists entry_ad_id text;      -- แอดที่ทักเข้ามา (ถ้ารู้)
alter table public.chat_customers add column if not exists trade_id text;         -- ไอดีเทรด MT4/MT5
alter table public.chat_customers add column if not exists username text;         -- username TradingView

-- ตั้งค่ารายเพจ: ต้องได้ข้อมูลอะไรถึงนับเป็น "สร้างคอนเวอร์ชั่นแล้ว" (ได้อย่างน้อย 1 อย่าง)
--   required_fields = อาเรย์ของ: "phone" | "trade_id" | "username"
create table if not exists public.page_lead_config (
  page_id text primary key,
  page_name text,
  required_fields jsonb not null default '["phone","trade_id","username"]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.page_lead_config enable row level security;
drop policy if exists "read page_lead_config" on public.page_lead_config;
create policy "read page_lead_config" on public.page_lead_config for select using (auth.role() = 'authenticated');
drop policy if exists "write page_lead_config" on public.page_lead_config;
create policy "write page_lead_config" on public.page_lead_config for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ======================================================================
-- FILE: supabase-migration-chat-media.sql
-- ======================================================================

-- ที่เก็บรูป/ไฟล์ที่แอดมินส่งในหน้า "ตอบแชท" (public เพื่อให้ Meta ดึงไปส่ง + แสดงในแชทได้)
insert into storage.buckets (id, name, public) values ('chat-media', 'chat-media', true)
  on conflict (id) do update set public = true;

-- อัปโหลดได้เฉพาะผู้ล็อกอิน, อ่าน (ดูรูป) ได้สาธารณะ
drop policy if exists "chat-media upload" on storage.objects;
create policy "chat-media upload" on storage.objects for insert to authenticated with check (bucket_id = 'chat-media');
drop policy if exists "chat-media read" on storage.objects;
create policy "chat-media read" on storage.objects for select using (bucket_id = 'chat-media');

-- ======================================================================
-- FILE: supabase-migration-chat-profilepic.sql
-- ======================================================================

-- รูปโปรไฟล์ลูกค้า (Messenger) — ดึงจาก User Profile API แล้วเก็บไว้ ไม่ต้องดึงซ้ำทุกครั้ง
alter table public.chat_customers add column if not exists profile_pic text;

-- ======================================================================
-- FILE: supabase-migration-chat-referrals-multi.sql
-- ======================================================================

-- ให้เก็บ referral ได้ "หลายแอดต่อลูกค้า" (เดิม PK = page_id+psid เก็บได้อันเดียว)
alter table public.chat_referrals drop constraint if exists chat_referrals_pkey;
-- unique ต่อ (เพจ, ลูกค้า, แอด) — ลูกค้าที่ทักจากหลายแอดจะเก็บครบทุกตัว
create unique index if not exists chat_referrals_uniq on public.chat_referrals (page_id, psid, ad_id);
create index if not exists chat_referrals_lookup_idx on public.chat_referrals (page_id, psid);

-- ======================================================================
-- FILE: supabase-migration-chat-referrals.sql
-- ======================================================================

-- เก็บ referral จาก Messenger webhook (ลูกค้ามาจากแอด/ลิงก์ไหน) ต่อ (page_id, psid)
-- webhook มักมาก่อนที่ sync จะดึงบทสนทนาเข้ามา จึงพักไว้ที่นี่ แล้ว sync ค่อย join เติม source/entry_ad_id
create table if not exists public.chat_referrals (
  page_id text not null,
  psid text not null,
  ad_id text,                 -- แอด Click-to-Messenger (ถ้ามาจากแอด)
  ref text,                   -- ค่า ref ในลิงก์ m.me?ref=
  source text,                -- ADS / SHORTLINK / CUSTOMER_CHAT_PLUGIN / ...
  ads_context jsonb,          -- ข้อมูลแอดเพิ่มเติม (ชื่อแอด/รูป) ถ้ามี
  received_at timestamptz not null default now(),
  primary key (page_id, psid)
);

alter table public.chat_referrals enable row level security;
drop policy if exists "read chat_referrals" on public.chat_referrals;
create policy "read chat_referrals" on public.chat_referrals for select using (auth.role() = 'authenticated');
-- insert/update ทำผ่าน service role (webhook) เท่านั้น — ไม่ต้องมี policy

-- ======================================================================
-- FILE: supabase-migration-chat-reply-meta.sql
-- ======================================================================

-- ข้อมูลเพิ่มสำหรับหน้าตอบแชท
-- 1) ข้อความ/ชื่อ/เวลา ของ "การตอบล่าสุดฝั่งเพจ" — ไว้โชว์บนป้ายชื่อทางซ้าย (เดิมโชว์แต่ข้อความลูกค้า)
alter table public.chat_customers add column if not exists last_reply_text text;   -- ข้อความล่าสุดที่แอดมินตอบ
alter table public.chat_customers add column if not exists last_reply_by text;     -- ชื่อแอดมินที่ตอบ (ถ้ารู้)
alter table public.chat_customers add column if not exists last_reply_at timestamptz;

-- 2) เวลาที่ "ลูกค้าเปิดอ่าน" ข้อความของเราล่าสุด — จาก webhook field message_reads
alter table public.chat_customers add column if not exists cust_read_at timestamptz;

comment on column public.chat_customers.last_reply_text is 'ข้อความล่าสุดฝั่งเพจ — โชว์บนป้ายชื่อซ้ายเมื่อแอดมินตอบทีหลังลูกค้า';
comment on column public.chat_customers.cust_read_at is 'เวลาที่ลูกค้าเปิดอ่านข้อความเราล่าสุด (message_reads watermark)';

-- ======================================================================
-- FILE: supabase-migration-chat-rls-columns.sql
-- ======================================================================

-- จำกัดคอลัมน์ที่ผู้ใช้ (authenticated) แก้ได้ใน chat_customers
-- เดิม policy เปิด update ทุกคอลัมน์ — ผู้ใช้ role analyze_only ก็แก้ needs_ai/ai_verified/meta_push_status ฯลฯ ได้ผ่าน supabase-js ตรงๆ
-- หน้าเว็บใช้จริงแค่: แก้สถานะเอง + แก้ข้อมูลติดต่อ inline + ธงยังไม่อ่าน
revoke update on public.chat_customers from authenticated;
revoke update on public.chat_customers from anon;
grant update (stage, stage_manual, phone, trade_id, username, email, unread, updated_at)
  on public.chat_customers to authenticated;
-- หมายเหตุ: edge functions ใช้ service role จึงไม่กระทบ

-- ======================================================================
-- FILE: supabase-migration-chat-sync-config.sql
-- ======================================================================

-- เลือกได้ว่าเพจไหนจะซิงก์ (default ซิงก์)
alter table public.page_lead_config add column if not exists sync_enabled boolean not null default true;

-- ค่าตั้งค่าการซิงก์ (จำนวนคิว/จำนวนข้อความ/คีย์เวิร์ด converted/ความเข้มการจับไอดีเทรด)
-- เก็บใน settings เดิม key = 'chat_sync_config' (ไม่ต้องสร้างตารางใหม่)
insert into public.settings (key, value)
values ('chat_sync_config', '{"per_page":200,"messages":30,"strict_trade_id":true,"keywords":["เปิดบัญชีแล้ว","เปิดบัญชีเรียบร้อย","สมัครแล้ว","สมัครเรียบร้อย","เทรดแล้ว","โอนแล้ว","ฝากแล้ว","ยืนยันแล้ว","จ่ายแล้ว","ชำระแล้ว"]}'::jsonb)
on conflict (key) do nothing;

-- ======================================================================
-- FILE: supabase-migration-chat-sync-cron.sql
-- ======================================================================

-- ตั้งเวลาให้ sync-conversations ดึงแชทเข้ามาอัตโนมัติทุก 30 นาที
-- ทำหลัง deploy edge function "sync-conversations" และเปิด pg_cron + pg_net แล้ว
select cron.unschedule(jobid) from cron.job where jobname = 'chat-sync-every-30min';

select cron.schedule(
  'chat-sync-every-30min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sync-conversations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ถ้า project ยังไม่ได้ตั้ง Vault ให้ใช้แบบระบุค่าตรงแทน (แก้ 2 ค่าให้ตรงโปรเจกต์):
-- select cron.schedule('chat-sync-every-30min','*/30 * * * *', $$
--   select net.http_post(
--     url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/sync-conversations',
--     headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer YOUR-SERVICE-ROLE-KEY'),
--     body := '{}'::jsonb);
-- $$);

-- ======================================================================
-- FILE: supabase-migration-chat-translations.sql
-- ======================================================================

-- cache คำแปล (หน้าตอบแชท) — แปลข้อความเดิมครั้งเดียว จำไว้ ไม่แปลซ้ำทุกครั้งที่เปิดแชท (ประหยัดโทเคน)
-- คีย์ด้วย hash ของข้อความต้นฉบับ → ข้อความเดิม (แม้คนละลูกค้า) ใช้คำแปลเดิมได้เลย
create table if not exists public.chat_translations (
  hash text primary key,
  th text not null,
  lang text,
  created_at timestamptz not null default now()
);
alter table public.chat_translations enable row level security;
-- เขียน/อ่านผ่าน service role (edge function) เท่านั้น — ฝั่ง client ไม่ต้องแตะ

-- ======================================================================
-- FILE: supabase-migration-chat-unread.sql
-- ======================================================================

-- จุดแดง = "ยังไม่อ่าน" (มีข้อความใหม่ที่แอดมินยังไม่เปิดอ่าน) แทน "ยังไม่ตอบ"
alter table public.chat_customers add column if not exists unread boolean not null default false;
-- ตั้งค่าเริ่มต้น: ที่ยังไม่ได้ตอบอยู่ตอนนี้ ให้ถือว่ายังไม่อ่านไปก่อน
update public.chat_customers set unread = true where awaiting_reply = true and unread = false;
create index if not exists chat_customers_unread_idx on public.chat_customers (last_message_at desc) where unread;

-- ======================================================================
-- FILE: supabase-migration-chat-verify.sql
-- ======================================================================

-- Two-stage AI: โมเดลใหญ่ตรวจซ้ำคอนเวอร์ชั่น แล้ว "แช่แข็ง" ไม่ส่ง AI อีกเพื่อประหยัดโทเคน
alter table public.chat_customers add column if not exists verify_hash text;                       -- hash เนื้อแชทตอนโมเดลใหญ่ตรวจล่าสุด
alter table public.chat_customers add column if not exists ai_verified boolean not null default false; -- true = โมเดลใหญ่ยืนยัน converted จริง → รอบถัดไปไม่ส่ง AI อีก

-- ======================================================================
-- FILE: supabase-migration-comment-realtime.sql
-- ======================================================================

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

-- ======================================================================
-- FILE: supabase-migration-cron.sql
-- ======================================================================

-- ============================================================
-- ตั้งเวลาให้ monitor-ads ทำงานอัตโนมัติ (pg_cron + pg_net)
-- ทำหลังจาก deploy edge function "monitor-ads" เสร็จแล้วเท่านั้น
-- ไปที่ Database → Extensions → เปิดใช้งาน pg_cron และ pg_net ก่อน (ข้ามได้ถ้าเคยเปิดไว้แล้ว)
-- แล้วค่อยรันไฟล์นี้ใน SQL Editor
-- ============================================================

-- ยกเลิก cron job เดิมของฟังก์ชันนี้ก่อน (ถ้ามี) กันซ้ำซ้อนตอนรันไฟล์นี้ใหม่
select cron.unschedule(jobid)
from cron.job
where jobname = 'ai-ads-monitor-every-15min';

-- รันทุก 15 นาที — ตัวฟังก์ชัน monitor-ads เองจะเช็คเวลาที่เหมาะสมอีกที
-- (ปรับความถี่การ "ตัดสินใจ" จริงได้จากหน้าตั้งค่าในเว็บแอป โดยไม่ต้องมาแก้ cron นี้ซ้ำ
--  เพราะฟังก์ชันจะเทียบเวลาล่าสุดที่เช็คแต่ละแอดกับ monitor_interval_minutes เอง)
select cron.schedule(
  'ai-ads-monitor-every-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/monitor-ads',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- หมายเหตุ: วิธีข้างบนอ้างอิง Supabase Vault ซึ่งบางโปรเจกต์อาจยังไม่ได้ตั้งค่า
-- ถ้ารันแล้ว error เรื่อง vault.decrypted_secrets ไม่มีข้อมูล ให้ใช้วิธีง่ายกว่านี้แทน (แก้ 2 ค่าให้ตรงโปรเจกต์คุณ
-- แล้วรันแทนคำสั่ง cron.schedule ด้านบน):
--
-- select cron.schedule(
--   'ai-ads-monitor-every-15min',
--   '*/15 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/monitor-ads',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer YOUR-SERVICE-ROLE-KEY'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
--
-- เช็คว่าตั้งสำเร็จ:
-- select * from cron.job;
-- ดู log การรันย้อนหลัง:
-- select * from cron.job_run_details order by start_time desc limit 20;

-- ======================================================================
-- FILE: supabase-migration-device-id.sql
-- ======================================================================

-- ระบุ "เครื่อง" ที่ใช้งาน (นับได้ว่าเมลเดียวกันล็อกอินพร้อมกันกี่เครื่อง)
alter table public.activity_log add column if not exists device_id text;
create index if not exists activity_log_recent_idx on public.activity_log (created_at desc, email, device_id);

-- ======================================================================
-- FILE: supabase-migration-disable-monitor-cron.sql
-- ======================================================================

-- ปิด cron ตรวจโฆษณาอัตโนมัติ (monitor-ads) ทิ้งถาวร
-- เหตุผล: ตัวฟังก์ชัน monitor-ads ใส่ kill-switch no-op ไว้แล้ว (settings.monitor_ads_enabled)
--         แต่ cron ยังยิงทุก 15 นาทีตลอด 24 ชม. (96 ครั้ง/วัน) เข้าไปเจอ no-op แล้วออก = เปลือง edge invocation ฟรีๆ
-- ผลของสคริปต์นี้: ลบ job ออกจาก pg_cron + มาร์คปิดในตาราง scheduled_jobs (ถ้ามี)
-- เปิดกลับภายหลัง: รัน migration cron เดิมใหม่ (supabase-migration-cron.sql) แล้วตั้ง settings.monitor_ads_enabled=true

-- 1) ลบออกจาก pg_cron (กันชื่อซ้ำหลาย job)
select cron.unschedule(jobid) from cron.job where jobname = 'ai-ads-monitor-every-15min';

-- 2) มาร์คปิดในตารางคุมงาน (ไม่ให้ปุ่ม/หน้าตั้งค่าเผลอเปิดกลับ) — ข้ามเงียบถ้ายังไม่มีตารางนี้
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'scheduled_jobs') then
    update public.scheduled_jobs set enabled = false where jobname = 'ai-ads-monitor-every-15min';
  end if;
end $$;

-- ตรวจผล: ควรได้ 0 แถว = ไม่มี job นี้ใน cron แล้ว
select jobname, schedule, active from cron.job where jobname = 'ai-ads-monitor-every-15min';

-- ======================================================================
-- FILE: supabase-migration-entry-ad-name.sql
-- ======================================================================

-- เก็บ "ชื่อโฆษณา" ที่ resolve ได้จากหน้าตอบแชท (ad_id -> ad name ผ่าน Meta)
-- ใช้แสดงในคอลัมน์แหล่งที่มาของหน้าฐานข้อมูลลูกค้า (บรรทัดบน = ชื่อแอด, บรรทัดล่าง = ads id)
-- รันใน Supabase SQL Editor
alter table public.chat_customers add column if not exists entry_ad_name text;

-- เช็ค: select customer_name, entry_ad_id, entry_ad_name from public.chat_customers where entry_ad_id is not null limit 10;

-- ======================================================================
-- FILE: supabase-migration-ghost-protection.sql
-- ======================================================================

-- ============================================================
-- Migration: ป้องกัน "แชทผี" (ghost chats / ลีดขยะ)
-- รันหลัง supabase-schema.sql แล้ว: Supabase Dashboard → SQL Editor → New query → วางทั้งไฟล์ → Run
-- ============================================================

-- ---------- ad_content: คอลัมน์เก็บสถานะ/สัญญาณแชทผี ----------
alter table public.ad_content
  add column if not exists ghost_flagged boolean not null default false,
  -- ghost_flagged = ระบบสงสัยว่าเป็นแชทผี/ลีดขยะ รอแอดมินตัดสิน (โหมด alert ไม่หยุดเอง)
  add column if not exists ghost_reason text,
  add column if not exists ghost_checked_at timestamptz,
  add column if not exists conversations numeric,   -- จำนวนแชทที่เริ่ม (messaging conversations started)
  add column if not exists replies numeric,          -- จำนวนแชทที่มีการตอบกลับจริง (first reply)
  add column if not exists reply_rate numeric;        -- replies / conversations (ตัวชี้วัดแชทผี)

create index if not exists idx_ad_content_ghost on public.ad_content(ghost_flagged);

-- ---------- ค่าเริ่มต้นของฟีเจอร์ป้องกันแชทผี ----------
-- enabled: เปิด/ปิดทั้งฟีเจอร์
-- exclude_audience_network: ตอนลอนช์ให้ตัด Audience Network ออก (แหล่งแชทผี/มิสคลิกอันดับ 1)
-- min_conversations: ต้องมีแชทเริ่มอย่างน้อยกี่ครั้งก่อนถึงจะตัดสิน (กันตัวอย่างน้อยเกินไป)
-- min_reply_rate: ถ้าอัตราการตอบกลับต่ำกว่านี้ = สงสัยแชทผี
-- action: "alert" = แจ้งเตือนรออนุมัติ (ไม่หยุดเอง) | "auto_pause" = หยุดอัตโนมัติ
insert into public.settings (key, value) values
  ('ghost_protection', jsonb_build_object(
    'enabled', true,
    'exclude_audience_network', true,
    'min_conversations', 10,
    'min_reply_rate', 0.4,
    'action', 'alert'
  ))
on conflict (key) do nothing;

-- ======================================================================
-- FILE: supabase-migration-label-push-rework.sql
-- ======================================================================

-- ปรับตรรกะ "ติดป้ายสถานะบน Meta" + "AI ตรวจซ้ำ" (รันครั้งเดียวใน SQL editor)
-- ไม่มีคอลัมน์ใหม่ — แค่เคลียร์/ปรับข้อมูลเดิมให้เข้ากับตรรกะใหม่

-- 1) ล็อกสถานะระดับคอนเวอร์ชั่น: ไม่ต้องจัด/ตรวจซ้ำอีก (เคลียร์ธงที่ค้างจากตรรกะเก่า)
--    ทำให้ตัวเลข "รอตรวจซ้ำ" ไม่ค้างเพราะแถว converted เดิม
update public.chat_customers
   set needs_verify = false, needs_ai = false
 where stage in ('converted', 'account_opened')
   and (needs_verify is true or needs_ai is true);

-- 2) (ไม่บังคับ) ทำให้ลูกค้าที่ "สร้างคอนเวอร์ชั่น/เปิดบัญชี" อยู่แล้ว ส่งป้ายได้
--    ตรรกะใหม่ยิงป้ายเฉพาะ classified_by = 'ai-verify' หรือ ตั้งเอง (stage_manual)
--    ถ้าต้องการให้คอนเวอร์ชั่นเดิม (ที่ได้ข้อมูลครบ) ถือว่า "ยืนยันแล้ว" และส่งป้ายได้ทันที
--    ปลดคอมเมนต์บล็อกด้านล่างแล้วรัน:
-- update public.chat_customers
--    set classified_by = 'ai-verify'
--  where stage in ('converted', 'account_opened')
--    and stage_manual is null
--    and classified_by in ('ai', 'rule', 'pending')
--    and (phone is not null or trade_id is not null or username is not null);

-- ======================================================================
-- FILE: supabase-migration-label-push.sql
-- ======================================================================

-- จำว่าติดป้ายสถานะอะไรไปแล้วบ้างบน Meta — ใช้กับปุ่ม "ส่งสถานะไป Meta" (ติดป้ายทั้งหมด)
-- เดิมฟังก์ชันเลือกแถวแบบ limit เฉยๆ ไม่มีการจำ กดซ้ำ = ทำ 500 รายเดิมวนไปเรื่อยๆ ไม่มีวันครบ 4,000+ ราย
-- มีคอลัมน์นี้แล้ว: เลือกเฉพาะรายที่ "ป้ายบน Meta ยังไม่ตรงกับสถานะปัจจุบัน" → ทำต่อจากที่ค้างได้ และไม่ยิงซ้ำฟรี
alter table public.chat_customers add column if not exists label_push_stage text;        -- สถานะที่ติดป้ายไปล่าสุด
alter table public.chat_customers add column if not exists label_push_at timestamptz;    -- เวลาที่ติดป้ายล่าสุด
alter table public.chat_customers add column if not exists label_push_error text;        -- ข้อความ error ถ้าติดไม่สำเร็จ
-- ตัวนับความพยายาม — กันแถวที่ติดป้ายไม่สำเร็จซ้ำๆ วนกลับมาบล็อกคิวไม่จบ (รีเซ็ตเมื่อสำเร็จ)
alter table public.chat_customers add column if not exists label_push_attempts int not null default 0;

-- index บางส่วน: หาแถวที่ยังต้องติดป้ายได้เร็ว (ป้ายไม่ตรงสถานะ)
create index if not exists chat_customers_label_pending_idx
  on public.chat_customers (last_message_at desc)
  where psid is not null;

-- ======================================================================
-- FILE: supabase-migration-lead-push.sql
-- ======================================================================

-- ติดตามการส่งสถานะไป Meta (Conversion Leads) — กันส่งซ้ำ + retry เฉพาะที่ล้มเหลว
alter table public.chat_customers add column if not exists meta_push_status text;     -- 'success' | 'failed'
alter table public.chat_customers add column if not exists meta_push_stage  text;     -- สถานะที่ส่งไปครั้งล่าสุด
alter table public.chat_customers add column if not exists meta_push_error  text;     -- ข้อความ error ถ้าไม่สำเร็จ
alter table public.chat_customers add column if not exists meta_push_at     timestamptz;

create index if not exists chat_customers_push_idx on public.chat_customers (meta_push_status);

-- Dataset ID เก็บใน settings.chat_sync_config.meta_dataset_id (ตั้งในหน้าตั้งค่าการซิงก์แชท)

-- ======================================================================
-- FILE: supabase-migration-leaderboard-realtime.sql
-- ======================================================================

-- กระดานแต้ม (Leaderboard): ให้ reply_stats ส่ง realtime เพื่ออัปเดตอันดับสด
-- รันครั้งเดียวใน Supabase SQL editor
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reply_stats'
  ) then
    alter publication supabase_realtime add table public.reply_stats;
  end if;
end $$;

-- ค่าเริ่มต้นการตั้งค่า (เปิดให้ทุกคนเห็น, นับทุกเพจ) — แอดมินแก้ได้ที่หน้าตั้งค่า
insert into public.settings (key, value, updated_at)
values ('leaderboard', '{"enabled": true, "emails": [], "pages": []}'::jsonb, now())
on conflict (key) do nothing;

-- ======================================================================
-- FILE: supabase-migration-manual-lead-data.sql
-- ======================================================================

-- แอดมินป้อนข้อมูลลูกค้าเอง (ไอดีเทรด/username/เบอร์/อีเมล) จากหน้าตอบแชท
-- มาร์คว่า "ป้อนโดยแอดมิน" + ใครป้อน + เมื่อไหร่ · AI/sync/webhook ต้องไม่แก้ทับข้อมูลชุดนี้
alter table public.chat_customers add column if not exists manual_data boolean not null default false;  -- true = ข้อมูลติดต่อถูกแอดมินป้อนเอง (ล็อก ไม่ให้ AI แก้)
alter table public.chat_customers add column if not exists manual_data_by text;                          -- อีเมลแอดมินที่ป้อน
alter table public.chat_customers add column if not exists manual_data_at timestamptz;                   -- เวลาที่ป้อน

-- หมายเหตุ: การตั้ง manual_data/manual_data_by ทำผ่าน service role (edge function save-lead-fields) เท่านั้น
-- client อ่านได้ (โชว์ในหน้าฐานข้อมูล) แต่แก้ไม่ได้ (ไม่อยู่ใน grant update ของ chat-rls-columns) กันปลอมชื่อผู้ป้อน

-- ======================================================================
-- FILE: supabase-migration-page-dataset.sql
-- ======================================================================

-- Dataset ID ของ Conversion Leads "แยกตามเพจ"
-- เอกสาร Meta ระบุชัดว่า 1 เพจผูกได้กับ 1 ชุดข้อมูลเท่านั้น (one dataset per page)
-- ของเดิมเก็บ dataset เดียวรวมทุกเพจใน settings.chat_sync_config.meta_dataset_id ซึ่งผิดโครงสร้าง
-- เมื่อมีหลายเพจ: ส่ง event ของเพจ A เข้า dataset ของเพจ B → Meta ปฏิเสธ หรือระบุที่มาผิด
--
-- ดึงค่านี้อัตโนมัติได้จากปุ่ม "ดึง Dataset ของทุกเพจ" ในหน้าตั้งค่า (เรียก POST /{page_id}/dataset)
alter table public.page_lead_config add column if not exists dataset_id text;

-- เก็บผลการส่งไว้ดูย้อนหลังได้ว่าเพจไหนตั้งค่าครบแล้ว
comment on column public.page_lead_config.dataset_id is 'Dataset ID ของ Conversion Leads สำหรับเพจนี้ (1 เพจ = 1 dataset ตามข้อกำหนด Meta)';

-- ======================================================================
-- FILE: supabase-migration-page-logos.sql
-- ======================================================================

-- ================================================================
-- เก็บ "โลโก้เพจ" ไว้ในระบบเราเอง — ดึงจาก Meta ครั้งเดียว แล้วเก็บรูปลง Storage + URL ลง DB
-- หลังจากนั้นแอปใช้ URL จาก DB (Supabase Storage) ตลอด ไม่ต้องยิง Meta อีก (เสถียร ไม่หลุด)
-- รันใน Supabase SQL Editor
-- ================================================================

-- (1) คอลัมน์เก็บ URL โลโก้ + เวลาที่อัปเดตล่าสุด (ไว้เช็ครีเฟรชเป็นระยะ)
alter table public.page_lead_config add column if not exists picture_url text;
alter table public.page_lead_config add column if not exists picture_updated_at timestamptz;

-- (2) bucket เก็บไฟล์โลโก้เพจ (public = อ่านได้เลย ไม่ต้องเซ็นชื่อ URL)
insert into storage.buckets (id, name, public)
values ('page-logos', 'page-logos', true)
on conflict (id) do update set public = true;

-- หมายเหตุ: การเขียนไฟล์ทำผ่าน edge function (service role) ซึ่ง bypass RLS อยู่แล้ว
-- อ่านเป็น public เพราะ bucket public — ไม่ต้องตั้ง policy เพิ่ม

-- ======================================================================
-- FILE: supabase-migration-perms-nickname.sql
-- ======================================================================

-- เพิ่มชื่อเล่น/ชื่อจำง่ายให้แต่ละผู้ใช้ (ไว้กันสับสนว่าเมลไหนของใคร)
alter table public.user_permissions add column if not exists nickname text;

-- ======================================================================
-- FILE: supabase-migration-perms-settings.sql
-- ======================================================================

-- ขยายสิทธิ์เพิ่ม: เลือกหัวข้อย่อยในหน้า "ตั้งค่า" ที่เข้าถึงได้ต่อผู้ใช้
alter table public.user_permissions add column if not exists allowed_settings jsonb not null default '[]'::jsonb;  -- คีย์หัวข้อตั้งค่า เช่น ["chat","synccfg"] (ว่าง = ไม่มีหัวข้อ)

-- ======================================================================
-- FILE: supabase-migration-perms-tabs-pages.sql
-- ======================================================================

-- ขยายสิทธิ์: เลือกเมนูที่เข้าถึงได้ + เพจที่เข้าถึงได้ (ตอบแชท) ต่อผู้ใช้
alter table public.user_permissions add column if not exists allowed_tabs jsonb not null default '[]'::jsonb;   -- คีย์เมนู เช่น ["inbox","customerdb"]  (ว่าง = ไม่มีสิทธิ์)
alter table public.user_permissions add column if not exists allowed_pages jsonb not null default '[]'::jsonb;  -- page_id ที่เข้าถึงได้ (ว่าง = ไม่เห็นเพจ)

-- ======================================================================
-- FILE: supabase-migration-prefetch-cron.sql
-- ======================================================================

-- ตั้ง cron ให้ prefetch-insights ดึงรีพอร์ต ads ล่วงหน้ามา cache
-- ต้องเปิด pg_cron + pg_net และตั้ง Vault (project_url, service_role_key) ก่อน — เหมือน cron อื่นในระบบ
-- แก้ URL/KEY ให้ตรงโปรเจกต์ถ้าไม่ได้ใช้ Vault (ดูตัวอย่างใน supabase-migration-cron.sql)

-- 1) SEED ทุกวันตี 1 (เวลาไทย = 18:00 UTC ของวันก่อนหน้า) — สร้างคิวงานใหม่จากที่เลือกไว้
select cron.unschedule(jobid) from cron.job where jobname = 'insights-prefetch-seed';
select cron.schedule('insights-prefetch-seed', '0 18 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/prefetch-insights',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := '{"seed":true}'::jsonb
  );
$$);

-- 2) DRAIN ทุก 15 นาที — ทยอยดึงจากคิวทีละก้อน (เช็ค rate guard เอง ใกล้เต็มก็พัก)
select cron.unschedule(jobid) from cron.job where jobname = 'insights-prefetch-drain';
select cron.schedule('insights-prefetch-drain', '*/15 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/prefetch-insights',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := '{}'::jsonb
  );
$$);

-- เช็ค: select jobname, schedule from cron.job;
-- ปิดชั่วคราว: select cron.unschedule('insights-prefetch-seed'); select cron.unschedule('insights-prefetch-drain');

-- ======================================================================
-- FILE: supabase-migration-push-dedupe.sql
-- ======================================================================

-- ================================================================
-- ลดจำนวน push_subscriptions ที่งอกซ้ำ/ตายค้าง (เช่น 37 แถวต่อ 1 เมล ทั้งที่มีไม่กี่เครื่อง)
-- สาเหตุ: ทุกครั้งที่ endpoint หมุน/ติดตั้งใหม่ = แถวใหม่ ส่วนแถวเก่าลบเฉพาะตอนยิงเจอ 410
-- แก้: (1) เพิ่ม device_id เพื่อผูก "1 เครื่อง = 1 แถว" ในอนาคต  (2) ลบแถวตายค้างทิ้งครั้งเดียว
-- รันใน Supabase SQL Editor
-- ================================================================

-- (1) เพิ่มคอลัมน์ device_id (แอปส่ง getDeviceId() มาตอน subscribe → server ลบ endpoint เก่าของเครื่องเดียวกันให้)
alter table public.push_subscriptions add column if not exists device_id text;
create index if not exists push_subs_email_device_idx on public.push_subscriptions (email, device_id);

-- ================================================================
-- ลำดับการทำให้ตัวเลขลดลงจริง (ทำตามนี้):
--   ขั้น 1) deploy send-push เวอร์ชันใหม่ + build/deploy หน้าเว็บ (โค้ดที่ส่ง device_id)
--   ขั้น 2) รัน (1) ด้านบน (เพิ่มคอลัมน์ device_id) — ทำก่อน
--   ขั้น 3) เปิดแอป 1 รอบ "บนทุกเครื่องจริง" ที่ยังใช้อยู่
--            → แถวปัจจุบันของแต่ละเครื่องจะได้ device_id ติดไว้ (แถวเก่าที่ตายยังเป็น NULL)
--   ขั้น 4) รัน (2) ด้านล่าง — ลบแถวเก่าทั้งหมดที่ device_id ยังว่าง (= ของตายที่สะสมมา)
-- ================================================================

-- (2) ล้างของตายค้าง: ลบแถวที่ยังไม่มี device_id (แถวเก่าก่อนอัปเดตนี้)
--     ⚠️ ต้องทำ "หลัง" เปิดแอปบนทุกเครื่องจริงแล้ว (ขั้น 3) ไม่งั้นเครื่องจริงที่ยังไม่เปิดจะโดนลบไปด้วย
--        (ถ้าโดนลบก็แค่ต้องเปิดแอปใหม่ 1 ครั้งให้ subscribe ใหม่)
delete from public.push_subscriptions where device_id is null;

-- ตรวจผล: เหลือกี่แถวต่อเมล (ควรใกล้เคียงจำนวนเครื่องจริง)
select email, count(*) as devices from public.push_subscriptions group by email order by devices desc;

-- ======================================================================
-- FILE: supabase-migration-push-notify-new.sql
-- ======================================================================

-- เปิด/ปิด "เตือนทุกข้อความใหม่ทันที" (เหมือน Messenger) ต่อเครื่อง/subscription
-- true = เด้งทุกครั้งที่ลูกค้าทัก ; false = เตือนเฉพาะแชทค้างเกินเกณฑ์ (cron)
alter table public.push_subscriptions add column if not exists notify_new boolean not null default true;

-- ======================================================================
-- FILE: supabase-migration-push-subscriptions.sql
-- ======================================================================

-- Web Push: เก็บ subscription ของแต่ละเครื่อง/เบราว์เซอร์ ผูกกับอีเมลผู้ใช้
-- 1 คนมีได้หลายเครื่อง (คอม + มือถือ) → คีย์ที่ endpoint (ไม่ซ้ำต่อ subscription)
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  email text not null,                 -- ผู้ใช้ที่เป็นเจ้าของ subscription นี้
  endpoint text not null unique,       -- URL ของ push service (unique ต่อ subscription)
  p256dh text not null,                -- กุญแจเข้ารหัสของ subscription
  auth text not null,
  pages jsonb not null default '[]'::jsonb,  -- เพจที่เครื่องนี้อยากรับแจ้งเตือน (ว่าง = ตามสิทธิ์ผู้ใช้)
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,              -- ส่งสำเร็จล่าสุด (ไว้ดูว่ายัง active ไหม)
  updated_at timestamptz not null default now()
);
create index if not exists push_subs_email_idx on public.push_subscriptions (email);

-- อ่าน/เขียนผ่าน edge function (service role) เท่านั้น
alter table public.push_subscriptions enable row level security;

-- กันส่งแจ้งเตือนซ้ำ: จำว่าเคยส่งแชทค้างรายไหนไปแล้วเมื่อไหร่
create table if not exists public.push_sent_log (
  conversation_id text not null,
  endpoint text not null,
  sent_at timestamptz not null default now(),
  primary key (conversation_id, endpoint)
);
alter table public.push_sent_log enable row level security;

-- ลงทะเบียนงาน cron: เช็คแชทค้างแล้วส่ง push ทุก 2 นาที (เบามาก ไม่เรียก Meta/AI)
insert into public.scheduled_jobs (key, jobname, label, description, function_name, cron_expr, enabled)
values ('pushcheck', 'push-overdue-2min', 'ส่งแจ้งเตือนแชทค้าง (Push)',
        'เช็คแชทค้างอ่านเกินเกณฑ์ แล้วส่ง Web Push ไปเครื่องพนักงาน แม้ปิดแท็บแอปไปแล้ว',
        'send-push', '*/2 * * * *', true)
on conflict (key) do nothing;

-- ======================================================================
-- FILE: supabase-migration-read-at.sql
-- ======================================================================

-- เวลาที่แอดมิน "อ่านในแอป" ล่าสุด — ใช้กัน unread_count ของ Meta เขียนทับสถานะอ่านกลับ
-- กติกา: unread จะกลับมาเป็น true ได้ก็ต่อเมื่อมีข้อความใหม่กว่าเวลาที่อ่าน (last_message_at > read_at)
alter table public.chat_customers add column if not exists read_at timestamptz;

-- ======================================================================
-- FILE: supabase-migration-realtime-replica-identity.sql
-- ======================================================================

-- ================================================================
-- แก้: พนักงาน (analyze_only) ไม่ได้รับ event เรียลไทม์ตอน UPDATE แต่ admin ได้
-- สาเหตุ: RLS ของพนักงานต้องเช็ค page_id ของแถว แต่ REPLICA IDENTITY เป็น default (แค่ PK)
--   → ตอน UPDATE "แถวเก่า" ใน WAL ไม่มี page_id → Realtime เช็ค RLS ของพนักงานไม่ผ่าน → ไม่ส่ง event
--   admin ผ่านด้วย app_is_admin() (ไม่ต้องใช้ page_id) จึงยังได้เรียลไทม์ปกติ
-- วิธีแก้: ตั้ง REPLICA IDENTITY FULL ให้ WAL ใส่ทุกคอลัมน์ (รวม page_id) เวลาส่งการเปลี่ยนแปลง
-- ================================================================

alter table public.chat_customers replica identity full;

-- (ถ้าใช้เรียลไทม์กับตารางอื่นที่มี RLS อ้างอิงคอลัมน์ที่ไม่ใช่ PK ก็ควรตั้งเช่นกัน เช่น)
-- alter table public.reply_stats replica identity full;

-- ตรวจผล: relreplident ควรเป็น 'f' (full)  [d=default, f=full]
select relname, relreplident
from pg_class
where relname = 'chat_customers';

-- ======================================================================
-- FILE: supabase-migration-realtime.sql
-- ======================================================================

-- เปิด Realtime ให้ตาราง chat_customers → หน้า "ตอบแชท" เด้งทันทีเมื่อมีข้อความใหม่ (ไม่ต้อง poll)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_customers'
  ) then
    alter publication supabase_realtime add table public.chat_customers;
  end if;
end $$;

-- ======================================================================
-- FILE: supabase-migration-reply-stats-closing.sql
-- ======================================================================

-- แยก "ลูกค้าปิดบทสนทนาเอง" ออกจาก "ยังไม่ตอบ"
-- ปัญหา: ลูกค้าพิมพ์ "ขอบคุณครับ" หรือกดไลก์เป็นข้อความสุดท้ายแล้วแอดมินไม่ตอบ (ซึ่งถูกต้องแล้ว)
--        ระบบเดิมนับเป็น "ยังไม่ตอบ" ค้างตลอดไป → ตัวเลขดูแย่เกินจริงและโทษพนักงานผิด
alter table public.reply_stats add column if not exists is_closing boolean not null default false;

comment on column public.reply_stats.is_closing is 'true = ข้อความสุดท้ายเป็นการปิดบทสนทนาของลูกค้าเอง (ขอบคุณ/ไลก์/สติกเกอร์) ไม่นับเป็นค้างตอบ';

-- คำที่ถือว่า "ปิดบทสนทนา" — แก้ได้ในหน้าสถิติการตอบแชท
-- ครอบคลุมไทย/อังกฤษ/ตากาล็อก/อินโดฯ ตามภาษาลูกค้าที่เพจรับจริง
update public.settings
set value = value || jsonb_build_object('closing_words', to_jsonb(array[
  'ขอบคุณ','ขอบคุณครับ','ขอบคุณค่ะ','ขอบใจ','ครับ','ค่ะ','คับ','จ้า','โอเค','ตกลง','รับทราบ','ได้ครับ','ได้ค่ะ','เข้าใจแล้ว','ไว้ติดต่อใหม่',
  'thank','thanks','thank you','tq','ok','okay','noted','got it','alright','sure',
  'salamat','sige','ok po','opo','thank you po','salamat po',
  'terima kasih','makasih','oke','baik','siap',
  'cảm ơn','ok ạ'
]::text[]))
where key = 'office_hours';

-- ======================================================================
-- FILE: supabase-migration-reply-stats-read.sql
-- ======================================================================

-- สถิติ "การอ่าน" เพิ่มจากสถิติ "การตอบ"
-- อ่านช้า = ลูกค้าทักแล้วกว่าจะมีคนเปิดอ่านใช้เวลานาน (คนละเรื่องกับตอบช้า — อ่านแล้วอาจยังไม่ตอบ)
-- ยังไม่อ่าน = ยังไม่มีใครเปิดดูเลย
alter table public.reply_stats add column if not exists read_at timestamptz;      -- เวลาที่เปิดอ่านรอบนี้ (null = ยังไม่อ่าน/ไม่ทราบ)
alter table public.reply_stats add column if not exists is_unread boolean not null default false;  -- รอบล่าสุดที่ยังไม่ถูกอ่าน

comment on column public.reply_stats.read_at is 'เวลาที่เปิดอ่านข้อความรอบนี้ — จับคู่จาก chat_customers.read_at ที่ตกอยู่ในช่วงของรอบนี้';
comment on column public.reply_stats.is_unread is 'true = รอบล่าสุดของแชทที่ยังไม่มีใครเปิดอ่าน (สถานะปัจจุบัน)';

-- ======================================================================
-- FILE: supabase-migration-reply-stats-v2.sql
-- ======================================================================

-- สถิติการตอบแชท v2 — คำนวณจาก "บทสนทนาจริง" แทนการบันทึกเฉพาะตอนกดส่งในแอป
-- ปัญหาเดิม: บันทึกเฉพาะตอนแอดมินกดส่งผ่านเว็บแอป ถ้าพนักงานตอบจากกล่องข้อความเพจโดยตรง สถิติจะไม่ขึ้นเลย
-- แก้: มี job ไล่อ่าน transcript ใน chat_customers (ซึ่งมีทั้งข้อความลูกค้าและข้อความที่ตอบจากเพจผ่าน webhook echo)
--      แล้วสรุปเป็น "รอบการรอ" (ลูกค้าทัก → แอดมินตอบครั้งแรก) เก็บลงตารางนี้

-- 1) รอบที่ยัง "ไม่มีใครตอบ" ต้องเก็บได้ด้วย (ใช้นับจำนวนการแจ้งเตือนที่ค้าง)
alter table public.reply_stats alter column replied_at drop not null;

-- 2) คีย์กันซ้ำ — รันสรุปกี่รอบก็ไม่เกิดแถวซ้ำ (1 รอบการรอ = 1 แถว)
alter table public.reply_stats add column if not exists round_key text;
alter table public.reply_stats add column if not exists source text;        -- app | page | unanswered
alter table public.reply_stats add column if not exists replied_by text;    -- อีเมลคนตอบ (ถ้าตอบผ่านแอป) — ตอบจากเพจจะว่าง

-- เติมคีย์ให้แถวเดิมที่บันทึกไว้ตอนกดส่งในแอป (กันซ้ำกับรอบที่ job จะสรุปมาทีหลัง)
update public.reply_stats
set round_key = conversation_id || '|' || (extract(epoch from msg_at) * 1000)::bigint::text,
    source = coalesce(source, 'app'),
    replied_by = coalesce(replied_by, email)
where round_key is null and conversation_id is not null and msg_at is not null;

-- unique index ต้อง "ไม่มีเงื่อนไข where" — ไม่งั้น upsert (ON CONFLICT (round_key)) ใช้ไม่ได้
-- Postgres จะบอกว่า "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- (ค่า null ซ้ำกันได้อยู่แล้วใน unique index ปกติ แถวเก่าที่ยังไม่มี round_key จึงไม่มีปัญหา)
drop index if exists reply_stats_round_uk;
create unique index if not exists reply_stats_round_uk on public.reply_stats (round_key);
create index if not exists reply_stats_page_day_idx on public.reply_stats (page_id, msg_at desc);

comment on column public.reply_stats.round_key is 'conversation_id|epoch_ms ของข้อความลูกค้าที่เริ่มรอ — กันบันทึกซ้ำเมื่อรัน job สรุปหลายรอบ';
comment on column public.reply_stats.source is 'app = ตอบผ่านเว็บแอป, page = ตอบจากกล่องข้อความเพจ, unanswered = ยังไม่มีใครตอบ';

-- ลงทะเบียนงานอัตโนมัติ: สรุปสถิติจากบทสนทนาทุกชั่วโมง (ไม่เรียก Meta/AI จึงเบามาก)
-- เปิด/ปิดและปรับเวลาได้ที่ ตั้งค่า → งานอัตโนมัติ (ตั้งเวลา)
insert into public.scheduled_jobs (key, jobname, label, description, function_name, cron_expr, enabled)
values ('replystats', 'reply-stats-hourly', 'สรุปสถิติการตอบแชท',
        'อ่านบทสนทนาจริงแล้วสรุปเวลาตอบรายเพจ/รายวัน — ครอบคลุมทั้งที่ตอบผ่านแอปและที่ตอบจากกล่องข้อความเพจ',
        'rebuild-reply-stats', '5 * * * *', true)
on conflict (key) do nothing;

-- ======================================================================
-- FILE: supabase-migration-reply-stats.sql
-- ======================================================================

-- สถิติการตอบแชท: บันทึก 1 แถวต่อ "การตอบครั้งแรกของรอบรอ" (ลูกค้าทัก → แอดมินตอบ)
create table if not exists public.reply_stats (
  id bigint generated always as identity primary key,
  email text,                      -- แอดมินที่ตอบ (จากปุ่มส่งในแอป)
  page_id text,
  page_name text,
  conversation_id text,
  customer_name text,
  msg_at timestamptz,              -- เวลาข้อความลูกค้า (จุดเริ่มรอ)
  replied_at timestamptz not null, -- เวลาที่แอดมินตอบ
  response_ms bigint,              -- เวลารอจริงแบบดิบ (ms) — ตัวเลขตามเวลาทำการคำนวณตอนดูรายงาน
  created_at timestamptz not null default now()
);
create index if not exists reply_stats_time_idx on public.reply_stats (replied_at desc);
create index if not exists reply_stats_email_idx on public.reply_stats (email, page_id);

-- อ่าน/เขียนผ่าน edge function (service role) เท่านั้น
alter table public.reply_stats enable row level security;

-- ค่าเริ่มต้นเวลาทำการ (แก้ได้ในหน้า "สถิติการตอบแชท")
insert into public.settings (key, value)
values ('office_hours', '{"days":[1,2,3,4,5],"open":"09:00","close":"17:00","break_start":"12:00","break_end":"13:00","slow_min":5}'::jsonb)
on conflict (key) do nothing;

-- ======================================================================
-- FILE: supabase-migration-saved-replies.sql
-- ======================================================================

-- ข้อความบันทึกไว้ (canned replies) ที่ทำในแอปเราเอง — ใช้แทน Saved Replies ของ Meta ที่ปิด API แล้ว
create table if not exists public.saved_replies (
  id uuid primary key default gen_random_uuid(),
  page_id text,                          -- null = ใช้ได้ทุกเพจ
  title text,
  message text not null default '',
  image_url text,                        -- รูปแนบ (เก็บใน storage chat-media)
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.saved_replies enable row level security;
drop policy if exists "rw saved_replies" on public.saved_replies;
create policy "rw saved_replies" on public.saved_replies for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ======================================================================
-- FILE: supabase-migration-scheduled-jobs.sql
-- ======================================================================

-- จัดการงานอัตโนมัติ (cron) ผ่านแอปได้
-- ต้องเปิด extension pg_cron + pg_net ก่อน (ปกติเปิดไว้แล้วถ้าใช้ cron อยู่)

-- ตารางเก็บ "งาน" พร้อมชื่อ/คำอธิบายอ่านง่าย + ความถี่ + เปิด/ปิด
create table if not exists public.scheduled_jobs (
  key text primary key,          -- รหัสภายใน
  jobname text not null,          -- ชื่อ job ใน pg_cron
  label text not null,            -- ชื่อไทยอ่านง่าย
  description text,               -- อธิบายว่าใช้ทำอะไร
  function_name text not null,    -- edge function ที่จะเรียก
  cron_expr text not null default '0 */2 * * *',
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.scheduled_jobs enable row level security; -- อ่าน/เขียนผ่าน edge function (service role) เท่านั้น

insert into public.scheduled_jobs (key, jobname, label, description, function_name, cron_expr, enabled) values
  ('monitor',  'ai-ads-monitor-every-15min', 'ตรวจโฆษณาอัตโนมัติ', 'เช็คผลโฆษณาเป็นรอบ แล้ว auto-pause แอดที่ผลแย่/แชทผี ตามเกณฑ์ในหน้าตั้งค่า', 'monitor-ads', '*/30 * * * *', true),
  ('chatsync', 'chat-sync-every-30min',      'ดึงแชทลูกค้า',        'ดึงแชท Messenger เข้ามาอัปเดต + ติดสถานะลูกค้าอัตโนมัติ',                 'sync-conversations', '0 */2 * * *', true)
on conflict (key) do nothing;

-- ตั้ง/ยกเลิก cron job (SECURITY DEFINER เพื่อเข้าถึง schema cron ได้)
create or replace function public.app_set_cron(p_jobname text, p_schedule text, p_command text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public, cron as $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = p_jobname; -- ลบของเดิมกันซ้ำ
  if p_enabled then
    perform cron.schedule(p_jobname, p_schedule, p_command);
  end if;
end; $$;

-- อ่านสถานะจริงจาก pg_cron + การรันล่าสุด
create or replace function public.app_list_cron()
returns table(jobname text, schedule text, active boolean, last_status text, last_run timestamptz)
language sql security definer set search_path = public, cron as $$
  select j.jobname, j.schedule, j.active,
    (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1),
    (select d.start_time from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1)
  from cron.job j;
$$;

grant execute on function public.app_set_cron(text, text, text, boolean) to service_role;
grant execute on function public.app_list_cron() to service_role;

-- ======================================================================
-- FILE: supabase-migration-split-copy-image.sql
-- ======================================================================

-- ============================================================
-- Migration: แยก copy กับรูปออกจากกัน + รองรับเลือกหลายคู่ตอนลอนช์
-- รันหลังจาก supabase-schema.sql แล้วเท่านั้น (ต้องมีตาราง ad_content เดิมอยู่ก่อน)
-- ไปที่ Supabase Dashboard → SQL Editor → New query → วางทั้งไฟล์ → Run
-- ============================================================

-- ---------- ad_copies (ข้อความโฆษณาแต่ละเวอร์ชัน — แยกจากรูปแล้ว) ----------
create table if not exists public.ad_copies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  product text,
  headline text,
  primary_text text,
  description text,
  cta text,
  status text not null default 'pending_approval',
  -- pending_approval | used | rejected  (used = ถูกจับคู่ไปลอนช์แล้วอย่างน้อย 1 ครั้ง ยังใช้ซ้ำได้)
  ai_score numeric,
  ai_rationale text,
  scored_at timestamptz,
  generated_by_model text -- 'claude' | 'openai'
);

alter table public.ad_copies enable row level security;

create policy "ad_copies: authenticated full access"
  on public.ad_copies for all
  to authenticated using (true) with check (true);

create index if not exists idx_ad_copies_status on public.ad_copies(status);

-- ---------- ad_images (รูปโฆษณาแต่ละเวอร์ชัน — แยกจาก copy แล้ว) ----------
create table if not exists public.ad_images (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  image_prompt text,
  image_url text,
  status text not null default 'pending_approval',
  -- pending_approval | used | rejected
  ai_score numeric,
  ai_rationale text,
  scored_at timestamptz,
  generated_by_model text -- 'gpt-image-1' | 'gpt-image-2'
);

alter table public.ad_images enable row level security;

create policy "ad_images: authenticated full access"
  on public.ad_images for all
  to authenticated using (true) with check (true);

create index if not exists idx_ad_images_status on public.ad_images(status);

-- ---------- ad_content: เปลี่ยนบทบาทจาก "1 copy+1 รูปที่รออนุมัติ" เป็น "แคมเปญที่ถูกลอนช์จริงแล้ว" ----------
-- แถวใหม่ในตารางนี้จะถูกสร้างตอนกด "ยืนยันลอนช์" เท่านั้น (หลังจับคู่ copy+image เสร็จ)
-- คอลัมน์เดิม headline/primary_text/description/cta/image_url ยังคงอยู่ไว้เป็น "สำเนา ณ ตอนลอนช์"
-- (กัน AI ไปแก้/ลบ copy หรือ image ต้นทางทีหลังแล้วกระทบแคมเปญที่ยิงไปแล้ว)
alter table public.ad_content
  add column if not exists copy_id uuid references public.ad_copies(id),
  add column if not exists image_id uuid references public.ad_images(id),
  add column if not exists launch_group_id uuid,
  -- launch_group_id: กลุ่มของการกดลอนช์ครั้งเดียวกัน (แอดมินเลือกหลายคู่พร้อมกันได้)
  -- ใช้แยกว่าแถวไหนมาจากการกดปุ่มเดียวกัน เผื่อดูย้อนหลังหรือยกเลิกทั้งกลุ่ม
  add column if not exists launch_mode text;
  -- 'separate_campaigns' | 'single_campaign_multi_ad'

create index if not exists idx_ad_content_launch_group on public.ad_content(launch_group_id);

-- ---------- ai_pairing_suggestions (เก็บคำแนะนำการจับคู่ + โหมดแคมเปญจาก AI ไว้ตรวจสอบย้อนหลัง) ----------
create table if not exists public.ai_pairing_suggestions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  requested_by uuid references auth.users(id),
  input_copy_ids uuid[],
  input_image_ids uuid[],
  suggested_pairs jsonb, -- [{copy_id, image_id, reason}]
  suggested_mode text, -- 'separate_campaigns' | 'single_campaign_multi_ad'
  mode_rationale text,
  model_used text
);

alter table public.ai_pairing_suggestions enable row level security;

create policy "ai_pairing_suggestions: authenticated full access"
  on public.ai_pairing_suggestions for all
  to authenticated using (true) with check (true);

-- ---------- หมายเหตุการย้ายข้อมูลเดิม ----------
-- ถ้ามีแถวเก่าใน ad_content ที่ยังเป็น pending_approval (สร้างจากระบบเวอร์ชันก่อนแก้ครั้งนี้)
-- แถวเหล่านั้นจะไม่ถูกย้ายเข้า ad_copies/ad_images อัตโนมัติ เพราะโครงสร้างข้อมูลเปลี่ยนความหมายไปแล้ว
-- แนะนำให้ปฏิเสธ (reject) หรือจัดการแถว pending เดิมให้เสร็จก่อนอัปเดตเว็บแอปเป็นเวอร์ชันใหม่
-- แถวที่เคย active/paused_auto/paused_manual ไปแล้ว ไม่กระทบ ยังอยู่ครบและแสดงในแท็บ "แคมเปญ" ตามปกติ

-- ======================================================================
-- FILE: supabase-migration-trade-id-cache.sql
-- ======================================================================

-- cache ผลเช็คไอดีเทรด — ลดการยิง external (api.trdapi.com / ai.traderider.com) ซ้ำ
-- ผล "ผ่าน" เก็บถาวร (ไอดีที่ผ่านแล้วผ่านตลอด) · ผล "ไม่ผ่าน" ฝั่ง edge จะใช้ TTL สั้น (เผื่อลูกค้าเพิ่งสมัคร)
-- อ่าน/เขียนผ่าน edge function (service role) เท่านั้น
create table if not exists public.trade_id_cache (
  trade_id   text primary key,
  pass       boolean not null,
  via        text,
  platform   text,
  insertdate text,
  checked_at timestamptz not null default now()
);
alter table public.trade_id_cache enable row level security;

-- เช็ค: select * from public.trade_id_cache order by checked_at desc limit 20;

-- ======================================================================
-- FILE: supabase-migration-tv-brands.sql
-- ======================================================================

-- ============================================================
-- Multi-brand TradingView: หลายแบรนด์ = คุกกี้คนละตัว + pub (สคริปต์) คนละชุด
-- แบรนด์เก็บ metadata ที่นี่ · คุกกี้ (sessionid/sign) เก็บใน app_secrets (service role เท่านั้น)
-- รันใน Supabase SQL Editor (ต้องรัน tv-members + security-hardening มาก่อน)
-- ============================================================

create table if not exists public.tv_brands (
  id bigint generated always as identity primary key,
  name text not null,
  tv_base text,                                   -- ว่าง = https://www.tradingview.com
  pages jsonb not null default '[]'::jsonb,       -- page_id ของแชทที่โชว์ฟอร์มเพิ่ม TV ของแบรนด์นี้ (ว่าง = ไม่ผูกเพจ)
  show_in_manager boolean not null default true,  -- โชว์ในหน้าจัดการสมาชิก TV ไหม
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tv_scripts add column if not exists brand_id bigint references public.tv_brands(id) on delete set null;
alter table public.tv_access  add column if not exists brand_id bigint;   -- โยงแบรนด์ (denormalized เพื่อ query/นับเร็ว)
create index if not exists tv_scripts_brand_idx on public.tv_scripts (brand_id);
create index if not exists tv_access_brand_idx  on public.tv_access (brand_id);

-- RLS: อ่านได้ถ้ามีสิทธิ์แท็บ tv_members ; เขียนทำผ่าน edge function (service role) เท่านั้น
alter table public.tv_brands enable row level security;
drop policy if exists "tv_brands read" on public.tv_brands;
create policy "tv_brands read" on public.tv_brands for select to authenticated using (public.app_has_tab('tv_members'));

-- Realtime (ให้ UI เห็นแบรนด์ที่เพิ่ม/แก้แบบสด)
alter table public.tv_brands replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='tv_brands') then
    alter publication supabase_realtime add table public.tv_brands;
  end if;
end $$;

-- ---- ยกของเดิมเป็น "แบรนด์เริ่มต้น" ----
-- สร้างแบรนด์เริ่มต้นถ้ายังไม่มีแบรนด์ใดเลย แล้ว backfill สคริปต์/สมาชิกเดิมเข้าไป
do $$
declare def_id bigint;
begin
  if not exists (select 1 from public.tv_brands) then
    insert into public.tv_brands (name, show_in_manager) values ('BeSight', true) returning id into def_id;
    update public.tv_scripts set brand_id = def_id where brand_id is null;
    update public.tv_access a set brand_id = def_id where brand_id is null;
  end if;
end $$;

-- เช็ค: select * from public.tv_brands;  select pine_id, name, brand_id from public.tv_scripts;

-- ======================================================================
-- FILE: supabase-migration-tv-editby.sql
-- ======================================================================

-- เก็บ "ใครแก้ไขล่าสุด + เมื่อไหร่" แยกจากคนเพิ่มเดิม (granted_by/granted_at ไม่โดนทับตอนแก้วัน)
-- รันใน Supabase SQL Editor
alter table public.tv_access add column if not exists edited_by text;        -- ชื่อเล่นคนแก้ไขล่าสุด
alter table public.tv_access add column if not exists edited_at timestamptz;  -- เวลาที่แก้ไขล่าสุด

-- เช็ค: select username, granted_by, granted_at, edited_by, edited_at from public.tv_access limit 5;

-- ======================================================================
-- FILE: supabase-migration-tv-email.sql
-- ======================================================================

-- เก็บอีเมลลูกค้าในตาราง tv_access (โชว์ในหน้าจัดการสมาชิก TV + ส่งมาจากหน้าตอบแชท)
-- รันใน Supabase SQL Editor
alter table public.tv_access add column if not exists email text;   -- อีเมลลูกค้า (ถ้ามี)

-- เช็ค: select username, email from public.tv_access limit 5;

-- ======================================================================
-- FILE: supabase-migration-tv-expire-cron.sql
-- ======================================================================

-- ตั้ง cron ถอนสิทธิ์ TradingView ที่หมดอายุอัตโนมัติ — วันละครั้ง เวลา 05:00 น. ไทย (= 22:00 UTC เพราะ pg_cron ใช้ UTC)
-- ทำงาน: เช็ค tv_access ที่ status=active + expiration เลยเวลาปัจจุบัน → สั่ง n8n ถอนสิทธิ์ TV → มาร์ค expired
-- ต้องเปิด pg_cron + pg_net และตั้ง Vault (project_url, service_role_key) + deploy edge "tradingview" + ตั้ง n8n webhook ในแอปก่อน

-- ลบ job เก่าทุกชื่อ กันซ้ำ
select cron.unschedule(jobid) from cron.job where jobname in ('tv-expire-daily','tv-expire-hourly','tv-expire-0500th');

select cron.schedule('tv-expire-0500th', '0 22 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/tradingview',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := '{"action":"expire"}'::jsonb
  );
$$);

-- เช็ค: select jobname, schedule from cron.job where jobname = 'tv-expire-0500th';   (schedule ควรเป็น 0 22 * * * = 05:00 ไทย)

-- ======================================================================
-- FILE: supabase-migration-tv-grantedby.sql
-- ======================================================================

-- เก็บ "ใครเป็นคนเพิ่มสิทธิ์ + เมื่อไหร่" ในตาราง tv_access
alter table public.tv_access add column if not exists granted_by text;   -- ชื่อเล่นแอดมินที่กดเพิ่ม (fallback = อีเมล)
alter table public.tv_access add column if not exists granted_at timestamptz;  -- เวลาที่กดเพิ่ม/ต่อสิทธิ์ล่าสุด

-- ======================================================================
-- FILE: supabase-migration-tv-ingest-token.sql
-- ======================================================================

-- token สำหรับรับคุกกี้อัตโนมัติจาก Chrome extension (ต่อแบรนด์)
-- extension ยิง POST { token, sessionid, sessionid_sign } มาที่ edge function → เก็บคุกกี้ให้แบรนด์นั้น
-- รันใน Supabase SQL Editor (ต้องรัน tv-brands มาก่อน)
create extension if not exists pgcrypto;
alter table public.tv_brands add column if not exists ingest_token text;

-- สร้าง token ให้แบรนด์ที่ยังไม่มี (สุ่มไม่ซ้ำ)
update public.tv_brands
set ingest_token = replace(gen_random_uuid()::text, '-', '')
where ingest_token is null;

-- กันซ้ำ
create unique index if not exists tv_brands_ingest_token_uk on public.tv_brands (ingest_token);

-- เช็ค: select id, name, ingest_token from public.tv_brands;

-- ======================================================================
-- FILE: supabase-migration-tv-members.sql
-- ======================================================================

-- ================================================================
-- ระบบจัดการสมาชิก TradingView (ให้สิทธิ์เข้า pine script + วันหมดอายุ)
-- รันใน Supabase SQL Editor  (ต้องรัน security-hardening ก่อนแล้ว เพราะใช้ app_has_tab/app_is_admin)
-- ================================================================

-- สคริปต์ (pine) ที่เราให้สิทธิ์ได้
create table if not exists public.tv_scripts (
  pine_id text primary key,               -- รูปแบบ TradingView เช่น PUB;75ee20d5bee6431c9bdef0282d58fdd3
  name text not null,                     -- ชื่อที่โชว์ เช่น BeSight ONE.STR Model Execution
  script_key text,                        -- ชื่อย่อภายใน เช่น script_a
  created_at timestamptz not null default now()
);

-- สิทธิ์การเข้าถึงต่อ (สมาชิก × สคริปต์)
create table if not exists public.tv_access (
  id bigint generated always as identity primary key,
  username text not null,                 -- TradingView username
  pine_id text not null references public.tv_scripts(pine_id) on delete cascade,
  display_name text,                      -- ชื่อเล่น/ชื่อจริง (ถ้ามี)
  expiration timestamptz,                 -- null = ตลอดชีพ
  lot text,                               -- ข้อมูลเสริม (เช่น lot ที่เทรด)
  trade_id text,                          -- เลข trade id (โยงกับลูกค้า)
  status text not null default 'active',  -- active | expired | error
  last_synced_at timestamptz,             -- ครั้งล่าสุดที่ sync/ยืนยันกับ TradingView
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (username, pine_id)
);
create index if not exists tv_access_username_idx on public.tv_access (username);
create index if not exists tv_access_expiration_idx on public.tv_access (expiration) where status = 'active';

-- RLS: อ่านได้ถ้ามีสิทธิ์แท็บ tv_members ; เขียนทำผ่าน edge function (service role) เท่านั้น
alter table public.tv_scripts enable row level security;
alter table public.tv_access  enable row level security;
drop policy if exists "tv_scripts read" on public.tv_scripts;
create policy "tv_scripts read" on public.tv_scripts for select to authenticated using (public.app_has_tab('tv_members'));
drop policy if exists "tv_access read" on public.tv_access;
create policy "tv_access read" on public.tv_access for select to authenticated using (public.app_has_tab('tv_members'));

-- เปิด Realtime ให้ tv_access (ฟีดสมาชิกสดในหน้า) — ต้องมี replica identity full ให้ RLS เช็คคอลัมน์ได้
alter table public.tv_access replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='tv_access') then
    alter publication supabase_realtime add table public.tv_access;
  end if;
end $$;

-- (ตัวอย่าง) ใส่สคริปต์แรกไว้เลย — แก้ pine_id/ชื่อให้ตรงของจริง หรือเพิ่มผ่านหน้าเว็บทีหลัง
insert into public.tv_scripts (pine_id, name, script_key)
values ('PUB;75ee20d5bee6431c9bdef0282d58fdd3', 'BeSight ONE.STR Model Execution', 'script_a')
on conflict (pine_id) do nothing;

-- ======================================================================
-- FILE: supabase-migration-tv-sync-cron.sql
-- ======================================================================

-- ซิงก์สิทธิ์ TradingView แบบ batch วันละครั้งเวลา 00:05 น. ตามเวลาไทย
-- 00:05 ไทย = 17:05 UTC ของวันก่อนหน้า (pg_cron ใช้ UTC)
-- ต้องรันหลังจากมีตาราง tv_access/tv_scripts และตั้ง Vault: project_url, service_role_key

select cron.unschedule(jobid)
from cron.job
where jobname in ('tv-sync-midnight-th', 'tv-sync-daily', 'tv-access-sync-midnight');

select cron.schedule('tv-sync-midnight-th', '5 17 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/tradingview',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{"action":"sync"}'::jsonb
  );
$$);

-- ตรวจสอบงาน: select jobname, schedule, active from cron.job where jobname = 'tv-sync-midnight-th';

-- ======================================================================
-- FILE: supabase-migration-user-permissions.sql
-- ======================================================================

-- สิทธิ์การใช้งานต่อผู้ใช้ (role-based access)
--   role = 'admin'         -> เห็นทุกเมนู ทุกบัญชีโฆษณา (ต้องมีแถว explicit เท่านั้น)
--   role = 'analyze_only'  -> เห็นแค่หน้า "วิเคราะห์" และเห็นเฉพาะบัญชีใน allowed_ad_accounts
-- allowed_ad_accounts = อาเรย์ของ account_id (เฉพาะตัวเลข เช่น "759642435880672") ที่อนุญาตให้เห็น

create table if not exists public.user_permissions (
  email text primary key,
  role text not null default 'analyze_only' check (role in ('admin', 'analyze_only')),
  allowed_ad_accounts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_permissions enable row level security;

-- ผู้ใช้อ่านสิทธิ์ของตัวเองได้ (ใช้ทั้งฝั่งเว็บและ edge function ที่รันในนามผู้ใช้)
drop policy if exists "read own permission" on public.user_permissions;
create policy "read own permission" on public.user_permissions
  for select to authenticated
  using (lower(auth.jwt() ->> 'email') = lower(email));

-- ตั้งเจ้าของระบบเป็น admin (ผู้ใช้อื่นที่ไม่มีแถวจะถูกปฏิเสธโดย security-hardening migration)
insert into public.user_permissions (email, role, allowed_ad_accounts)
values ('aphiwat@traderidermedia.com', 'admin', '[]'::jsonb)
on conflict (email) do update set role = 'admin', updated_at = now();

-- ตัวอย่างวิธีเพิ่มผู้ใช้แบบ "เห็นแค่หน้าวิเคราะห์ + เฉพาะบางบัญชี":
-- insert into public.user_permissions (email, role, allowed_ad_accounts)
-- values ('staff@example.com', 'analyze_only', '["759642435880672","609435807268597"]'::jsonb)
-- on conflict (email) do update set role = excluded.role, allowed_ad_accounts = excluded.allowed_ad_accounts, updated_at = now();

-- ======================================================================
-- FILE: supabase-migration-security-hardening.sql
-- ======================================================================

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
