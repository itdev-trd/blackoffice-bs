-- ตรวจ Lot + ต่อ Indicator อัตโนมัติ (ย้ายจาก besight-dashboard-main แต่ใช้ tv_access ของระบบนี้)
--   tv_lot_checks   = ประวัติการตรวจทุกครั้ง (ยกเว้น dry-run) — แท็บ "ประวัติการตรวจ"
--   tv_lot_renewals = การต่ออายุอัตโนมัติต่อ 1 อินดิเคเตอร์ต่อ 1 รอบ — UNIQUE กันต่อซ้ำในรอบเดียวกัน
-- เขียนผ่าน edge function (service role) เท่านั้น · อ่านได้ถ้ามีแท็บ tv_members

create table if not exists public.tv_lot_checks (
  id bigint generated always as identity primary key,
  trade_id text not null,
  username text,                       -- สมาชิก (username TradingView) ที่ผูกกับ trade_id นี้ · null = ไม่พบในระบบ
  period text not null,                -- cycle | entitlement | month | custom
  date_from date not null,
  date_to date not null,
  trade_ids text[] not null default '{}',   -- ทุกบัญชีของสมาชิกที่นับรวม
  total_lots numeric not null default 0,
  excluded_lots numeric not null default 0,
  quota numeric,                       -- เกณฑ์ที่ใช้ตัดสิน (โควตาเฉพาะราย หรือของแบรนด์)
  qualified boolean,                   -- null = ไม่มีเกณฑ์ / ไม่พบสมาชิก
  auto_renew boolean not null default false,
  renewed int not null default 0,
  skipped text,                        -- เหตุผลที่ไม่ได้ต่ออายุ
  checked_by text,
  created_at timestamptz not null default now()
);
create index if not exists tv_lot_checks_trade_idx on public.tv_lot_checks (trade_id, created_at desc);
create index if not exists tv_lot_checks_created_idx on public.tv_lot_checks (created_at desc);

create table if not exists public.tv_lot_renewals (
  id bigint generated always as identity primary key,
  lot_check_id bigint references public.tv_lot_checks(id) on delete set null,
  username text not null,
  pine_id text not null,
  period_start date not null,
  period_end date not null,
  qualified_lots numeric not null,
  quota numeric not null,
  old_expiration timestamptz,
  new_expiration timestamptz,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  error text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (username, pine_id, period_start, period_end)
);

alter table public.tv_lot_checks enable row level security;
alter table public.tv_lot_renewals enable row level security;
create policy "tv_lot_checks read" on public.tv_lot_checks for select to authenticated using (public.app_has_tab('tv_members'));
create policy "tv_lot_renewals read" on public.tv_lot_renewals for select to authenticated using (public.app_has_tab('tv_members'));
