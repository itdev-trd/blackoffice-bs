-- สมุดแต้มโบนัส (append-only) — แทนการคิดแต้มสดจาก reply_stats ทุกครั้งที่เปิดหน้า
--
-- ทำไม: แต้มผูกกับโบนัสรายเดือนจริง แต่ระบบเดิม (1) เอาชื่อคนตอบจากเบราว์เซอร์ (2) นับรอบเดียวซ้ำได้
-- (3) แก้เวลาทำการ/วันหยุดแล้วแต้มย้อนหลังเปลี่ยน (4) ไม่มีหลักฐานต่อแต้ม
-- ตอนนี้แต้มทุกแต้มถูกบันทึกครั้งเดียวตอนทำงานจริง พร้อมหลักฐานและเวอร์ชันกติกา แก้/ลบไม่ได้
--
-- ไม่แตะ chat_customers เลย (ไม่มี trigger/index บน transcript — ดู docs/RUNBOOK-ฐานข้อมูลล่ม.md)
-- trigger ทั้งหมดอยู่บนตารางเล็กชุดนี้ และไม่เปิด Realtime

create table if not exists public.point_rules (
  version int primary key,
  rules jsonb not null,
  note text,
  created_at timestamptz not null default now(),
  created_by text
);

insert into public.point_rules (version, rules, note, created_by)
values (1, '{
  "off_table": {
    "workday": [[12,13,1,0.5],[17,20,2,1],[20,24,4,2],[0,5,8,6],[5,9,4,2]],
    "holiday": [[9,17,2,1],[17,20,4,2],[20,24,8,4],[0,5,16,12],[5,9,8,4]]
  },
  "office": [0.5, 0.25],
  "tv": {"grant": 3, "renew": 2, "revoke_void_days": 7},
  "caps": {"office_per_conv_day": 3, "off_per_conv_day": 5},
  "dispute_days": 3
}'::jsonb, 'กติกาเริ่มต้น: ตารางนอกเวลาเดิม + ในเวลา 0.5/0.25 + TV ใหม่ 3 / ต่ออายุ 2', 'system')
on conflict (version) do nothing;

create table if not exists public.point_periods (
  period text primary key check (period ~ '^\d{4}-\d{2}$'),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_by text,
  close_note text,
  snapshot jsonb,
  snapshot_hash text,
  last_event_id bigint
);

create table if not exists public.point_events (
  id bigserial primary key,
  staff_email text not null,
  kind text not null check (kind in ('reply_offhours', 'reply_office', 'tv_grant', 'tv_renew', 'adjustment', 'reversal')),
  points numeric(8, 2) not null,
  occurred_at timestamptz not null,
  period text not null default '',
  idem_key text not null unique,
  rule_version int,
  conversation_id text,
  page_id text,
  tv_access_id bigint,
  reverses_event_id bigint unique references public.point_events(id),
  dispute_id bigint,
  evidence jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  created_by text
);
create index if not exists point_events_period_staff_idx on public.point_events (period, staff_email);
create index if not exists point_events_conv_idx on public.point_events (conversation_id, occurred_at) where conversation_id is not null;
create index if not exists point_events_tv_idx on public.point_events (tv_access_id) where tv_access_id is not null;

create table if not exists public.point_disputes (
  id bigserial primary key,
  event_id bigint references public.point_events(id),
  period text not null,
  staff_email text not null,
  reason text not null,
  requested_points numeric(8, 2),
  status text not null default 'open' check (status in ('open', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_by text,
  resolved_at timestamptz,
  resolution_note text,
  adjustment_event_id bigint references public.point_events(id)
);
create index if not exists point_disputes_period_idx on public.point_disputes (period, status);

-- สมุดแต้มแก้/ลบไม่ได้ แม้แต่ service_role — จะหักแต้มต้องเพิ่มรายการ reversal ติดลบเท่านั้น
create or replace function public.point_events_block_change()
returns trigger language plpgsql as $$
begin
  raise exception 'point_events แก้ไข/ลบไม่ได้ — หักหรือปรับแต้มด้วยการเพิ่มรายการใหม่ (reversal/adjustment)';
end $$;
drop trigger if exists point_events_no_update on public.point_events;
create trigger point_events_no_update before update or delete on public.point_events
  for each row execute function public.point_events_block_change();
drop trigger if exists point_events_no_truncate on public.point_events;
create trigger point_events_no_truncate before truncate on public.point_events
  for each statement execute function public.point_events_block_change();

-- เดือนของแต้มคิดตามเวลาไทย · ถ้าเดือนนั้นปิดยอดไปแล้ว ย้ายไปลงเดือนที่เปิดอยู่ พร้อมบันทึกว่ามาช้า
create or replace function public.point_events_set_period()
returns trigger language plpgsql as $$
declare
  p text := to_char(new.occurred_at at time zone 'Asia/Bangkok', 'YYYY-MM');
  cur text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
begin
  if exists (select 1 from public.point_periods where period = p and status = 'closed') then
    if exists (select 1 from public.point_periods where period = cur and status = 'closed') then
      raise exception 'เดือน % ปิดยอดแล้ว บันทึกแต้มเพิ่มไม่ได้', cur;
    end if;
    new.evidence := coalesce(new.evidence, '{}'::jsonb) || jsonb_build_object('late_for', p);
    p := cur;
  end if;
  new.period := p;
  return new;
end $$;
drop trigger if exists point_events_period on public.point_events;
create trigger point_events_period before insert on public.point_events
  for each row execute function public.point_events_set_period();

-- เดือนที่ปิดแล้วเปิดกลับ/แก้ snapshot ไม่ได้
create or replace function public.point_periods_lock()
returns trigger language plpgsql as $$
begin
  if old.status = 'closed' then
    raise exception 'เดือน % ปิดยอดแล้ว แก้ไขไม่ได้', old.period;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists point_periods_lock on public.point_periods;
create trigger point_periods_lock before update or delete on public.point_periods
  for each row execute function public.point_periods_lock();

-- อ่าน/เขียนผ่าน edge function (service role) เท่านั้น
alter table public.point_rules enable row level security;
alter table public.point_periods enable row level security;
alter table public.point_events enable row level security;
alter table public.point_disputes enable row level security;
revoke all on public.point_rules, public.point_periods, public.point_events, public.point_disputes from anon, authenticated;

-- คนกดให้สิทธิ์ TV เก็บเป็นอีเมล (granted_by เดิมเป็นชื่อเล่น ซ้ำ/เปลี่ยนได้ ใช้ผูกแต้มไม่ได้)
alter table public.tv_access add column if not exists granted_by_email text;
alter table public.tv_access add column if not exists edited_by_email text;
