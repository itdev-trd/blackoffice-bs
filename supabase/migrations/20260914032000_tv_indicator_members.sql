-- หน้า "จัดการสมาชิก Indicator ของ <แบรนด์>" — ตารางสมาชิกแบบละเอียดต่อแบรนด์เดียว (เช่น BeSight)
-- เพิ่มคอลัมน์ที่หน้าจอนี้ต้องใช้แต่ tv_access ยังไม่มี + โควตา Lot ต่อเดือนของแบรนด์ + ตาราง cache ยอด Lot จริงจาก broker

alter table public.tv_access add column if not exists phone text;
alter table public.tv_access add column if not exists country text;
alter table public.tv_access add column if not exists telegram text;
comment on column public.tv_access.phone is 'เบอร์โทรลูกค้า — กรอกเองตอนเพิ่ม/แก้ไขสมาชิก (tv_access ไม่ได้ join กับ chat_customers)';
comment on column public.tv_access.country is 'ประเทศลูกค้า — กรอกเอง เหมือน phone';
comment on column public.tv_access.telegram is 'Telegram handle/ID ของลูกค้า — แยกจาก contact_channel ซึ่งเป็นแค่ช่องทางที่ติดต่อเข้ามา';

-- โควตา Lot ที่สมาชิกต้องเทรดให้ถึงต่อเดือน ตั้งค่าได้ต่อแบรนด์ (การ์ด "Lot ที่ต้องจ่าย/เดือน")
alter table public.tv_brands add column if not exists lot_quota_per_month numeric not null default 3;
comment on column public.tv_brands.lot_quota_per_month is 'โควตา lot ต่อเดือนที่สมาชิกต้องเทรดให้ถึง เพื่อ "ผ่านเกณฑ์" — แก้ได้จากหน้าจัดการสมาชิก';

-- แคชยอด lot จริงที่ดึงจาก broker (api.trdapi.com/webhook/check-lot) ต่อ trade_id ต่อช่วงเดือน
-- ไม่ดึงสดทุกครั้งที่เปิดหน้า เพราะ API คืนยอดของทุกบัญชีใต้ IB มาทีเดียว (พารามิเตอร์ tradeid ไม่กรอง)
-- แอดมินกด "ตรวจ Lot ทุกคน" เพื่อรีเฟรชค่าที่ตารางนี้แทน
create table if not exists public.tv_lot_usage (
  id bigint generated always as identity primary key,
  trade_id text not null,
  period_start date not null,
  period_end date not null,
  lots numeric not null default 0,
  campaign_name text,
  fetched_at timestamptz not null default now(),
  unique (trade_id, period_start, period_end)
);
comment on table public.tv_lot_usage is 'แคชยอด lot จริงต่อ trade_id ต่อช่วงเดือน ดึงจาก broker ผ่าน edge function tradingview action=refresh_lots';

alter table public.tv_lot_usage enable row level security;
drop policy if exists "tv_lot_usage read" on public.tv_lot_usage;
create policy "tv_lot_usage read" on public.tv_lot_usage for select to authenticated using (public.app_has_tab('tv_members'));
-- เขียนได้เฉพาะ service role (edge function เท่านั้น) — ไม่มี policy insert/update/delete ให้ authenticated

create index if not exists tv_lot_usage_period_idx on public.tv_lot_usage (period_start, period_end);
