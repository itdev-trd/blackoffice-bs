-- broker ของบัญชีเทรด (XM หลัก / Exness รอง) — ป้ายกำกับที่แอดมินเลือกเอง เหมือน chat_customers.broker
-- ค่าเก่าทั้งหมด (ก่อนมีคอลัมน์นี้) ถือว่าเป็น XM เพราะระบบผูกกับ XM มาตลอด
alter table public.tv_access
  add column if not exists broker text not null default 'XM';

alter table public.tv_access
  drop constraint if exists tv_access_broker_check;
alter table public.tv_access
  add constraint tv_access_broker_check check (broker in ('XM', 'Exness'));

comment on column public.tv_access.broker is 'broker ที่แอดมินระบุเอง (XM หลัก / Exness รอง) — ป้ายกำกับเท่านั้น ไม่ได้เช็คจริง';
