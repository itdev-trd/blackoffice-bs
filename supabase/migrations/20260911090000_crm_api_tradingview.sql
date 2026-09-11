-- เพิ่มช่องข้อมูล TradingView ให้ CRM API (supabase/functions/crm-customers)
--
-- ของเดิม (api_clients, crm_customers_page, crm_deleted_customers_page,
-- crm_rate_limit_hit, crm_deleted_customers, api_rate_limits) ถูก deploy ตรง
-- ไปที่ฐานข้อมูล/edge function โดยไม่มี migration ไฟล์อยู่ใน repo นี้มาก่อน
-- (เห็นตอนเช็ค `supabase migrations list` เทียบกับ git — migration ชื่อ
-- "crm_api" มีอยู่จริงในโปรเจกต์ แต่ไม่มีไฟล์ต้นทางในนี้เลย) ไฟล์นี้จึง "ต่อ" จาก
-- ของเดิมเท่านั้น ไม่แตะ/ไม่สร้างซ้ำของที่มีอยู่แล้ว — ใครดู diff ของไฟล์นี้แล้ว
-- งงว่า api_clients มาจากไหน ให้รู้ไว้ว่ามันมีอยู่ก่อนไฟล์นี้แล้ว
--
-- รูปแบบฟังก์ชัน/ทริกเกอร์ในไฟล์นี้ตั้งใจให้ตรงกับที่มีอยู่แล้ว
-- (ชื่อพารามิเตอร์ p_since/p_after_at/p_after_id/p_limit, ชื่อทริกเกอร์
-- <table>_touch_updated_at / <table>_log_delete) เพื่อให้อ่านคู่กันได้

-- ---------- 1. updated_at ขยับเองเสมอ ----------
-- incremental sync ของ CRM อิงคอลัมน์นี้ ถ้า write path ไหนลืมเซ็ต (เดิมเซ็ตมือ
-- กระจายอยู่หลายจุดในโค้ดแอป) แถวนั้นจะถูกข้ามถาวรและเงียบมาก จึงบังคับที่ trigger
create or replace function public.tv_access_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tv_access_touch_updated_at on public.tv_access;
create trigger tv_access_touch_updated_at
  before update on public.tv_access
  for each row execute function public.tv_access_touch_updated_at();

-- id ต่อท้ายเป็นตัวตัดสินตอน updated_at เท่ากัน (bulk update ในงาน sync แตะหลายแถว
-- ใน transaction เดียว ได้เวลาเดียวกันเป๊ะ)
create index if not exists tv_access_updated_at_idx
  on public.tv_access (updated_at, id);

-- ---------- 2. tombstone ของสิทธิ์ที่ถูกลบ ----------
-- ลบสคริปต์ใน tv_scripts จะ cascade ลบ tv_access ของสคริปต์นั้นทั้งหมด ถ้าไม่บันทึกไว้
-- CRM จะยังโชว์ว่าลูกค้ามีสิทธิ์อินดี้ตัวที่ไม่มีอยู่แล้ว (incremental sync เห็นแต่
-- "แถวที่เปลี่ยน" ไม่เห็น "แถวที่หายไป")
create table if not exists public.crm_deleted_tv_access (
  id bigint primary key,
  username text,
  pine_id text,
  deleted_at timestamptz not null default now()
);

create index if not exists crm_deleted_tv_access_at_idx
  on public.crm_deleted_tv_access (deleted_at, id);

alter table public.crm_deleted_tv_access enable row level security;
-- ไม่มี policy ให้ anon/authenticated — อ่านได้ทาง service role (edge function) เท่านั้น

create or replace function public.tv_access_log_delete()
returns trigger
language plpgsql
as $$
begin
  insert into public.crm_deleted_tv_access (id, username, pine_id, deleted_at)
  values (old.id, old.username, old.pine_id, now())
  on conflict (id) do update
    set deleted_at = now(), username = excluded.username, pine_id = excluded.pine_id;
  return old;
end;
$$;

drop trigger if exists tv_access_log_delete on public.tv_access;
create trigger tv_access_log_delete
  after delete on public.tv_access
  for each row execute function public.tv_access_log_delete();

-- ---------- 3. คิวรีของ API: สิทธิ์ TradingView ----------
-- หนึ่งแถว = ลูกค้าหนึ่งคนต่ออินดี้หนึ่งตัว คนหนึ่งมีได้หลายแถว
-- คอลัมน์ที่ปล่อยออกล็อกไว้ที่ RETURNS TABLE นี้ที่เดียว — เพิ่มคอลัมน์ใน tv_access
-- เฉย ๆ ไม่รั่วออก API ต้องมาแก้ที่ฟังก์ชันนี้อย่างตั้งใจ
--
-- ที่ตั้งใจ "ไม่" ปล่อยออก: granted_by/edited_by/edited_at (อีเมลพนักงานที่ให้สิทธิ์
-- เป็น PII ของทีมเรา ไม่ใช่ของลูกค้า), last_error/tv_verify_error (debug ภายใน),
-- previous_expiration/new_expiration (ค่าชั่วคราวตอนต่ออายุ), last_synced_at
create or replace function public.crm_tradingview_page(
  p_since timestamptz default null,
  p_after_at timestamptz default null,
  p_after_id bigint default null,
  p_limit int default 200,
  p_username text default null,
  p_trade_id text default null,
  p_pine_id text default null,
  p_brand_id bigint default null,
  p_status text default null,
  p_id bigint default null
)
returns table (
  id bigint,
  username text,
  display_name text,
  email text,
  trade_id text,
  pine_id text,
  indicator_name text,
  script_key text,
  brand_id bigint,
  brand_name text,
  lot text,
  status text,
  membership_type text,
  member_type text,
  channel text,
  contact_channel text,
  granted_at timestamptz,
  last_granted_at timestamptz,
  tv_granted_at timestamptz,
  expiration timestamptz,
  tv_expiration timestamptz,
  tv_access_verified boolean,
  tv_verified_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    a.id, a.username, a.display_name, a.email, a.trade_id, a.pine_id,
    s.name, s.script_key, a.brand_id, b.name,
    a.lot, a.status, a.membership_type, a.member_type, a.channel, a.contact_channel,
    a.granted_at, a.last_granted_at, a.tv_granted_at,
    a.expiration, a.tv_expiration, a.tv_access_verified, a.tv_verified_at,
    a.created_at, a.updated_at
  from public.tv_access a
  left join public.tv_scripts s on s.pine_id = a.pine_id
  left join public.tv_brands b on b.id = a.brand_id
  where
    case
      when p_id is not null then a.id = p_id
      else
        (p_since is null or a.updated_at >= p_since)
        and (p_after_at is null or (a.updated_at, a.id) > (p_after_at, p_after_id))
        and (p_username is null or lower(a.username) = lower(p_username))
        and (p_trade_id is null or a.trade_id = p_trade_id)
        and (p_pine_id is null or a.pine_id = p_pine_id)
        and (p_brand_id is null or a.brand_id = p_brand_id)
        and (p_status is null or a.status = p_status)
    end
  order by a.updated_at asc, a.id asc
  limit case when p_id is not null then 1 else greatest(1, least(coalesce(p_limit, 200), 1000)) + 1 end;
$$;

-- ---------- 4. คิวรีของ API: สิทธิ์ที่ถูกลบ ----------
create or replace function public.crm_deleted_tv_page(
  p_since timestamptz default null,
  p_after_at timestamptz default null,
  p_after_id bigint default null,
  p_limit int default 200
)
returns table (
  id bigint,
  username text,
  pine_id text,
  deleted_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select d.id, d.username, d.pine_id, d.deleted_at
  from public.crm_deleted_tv_access d
  where (p_since is null or d.deleted_at >= p_since)
    and (p_after_at is null or (d.deleted_at, d.id) > (p_after_at, p_after_id))
  order by d.deleted_at asc, d.id asc
  limit greatest(1, least(coalesce(p_limit, 200), 1000)) + 1;
$$;

-- เรียกได้เฉพาะ service role (edge function) ไม่ให้กลายเป็นช่องอ่านข้อมูลจาก browser
revoke all on function public.crm_tradingview_page(timestamptz, timestamptz, bigint, int, text, text, text, bigint, text, bigint) from public;
revoke all on function public.crm_deleted_tv_page(timestamptz, timestamptz, bigint, int) from public;
grant execute on function public.crm_tradingview_page(timestamptz, timestamptz, bigint, int, text, text, text, bigint, text, bigint) to service_role;
grant execute on function public.crm_deleted_tv_page(timestamptz, timestamptz, bigint, int) to service_role;
