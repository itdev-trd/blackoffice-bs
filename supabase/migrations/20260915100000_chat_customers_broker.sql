-- เพิ่มป้ายกำกับ broker ให้ลูกค้าแต่ละคน (XM เป็นค่าเริ่มต้น/หลัก, Exness เป็นตัวเลือกรอง)
-- แค่ป้ายกำกับที่แอดมินเลือกเองในหน้าตอบแชท ไม่ได้เช็คจริงกับฝั่ง broker (ระบบเช็คไอดีเทรดตอนนี้
-- ผูกกับ XM เท่านั้น — ยังไม่มี endpoint เช็คของ Exness)
alter table public.chat_customers
  add column if not exists broker text not null default 'XM';

alter table public.chat_customers
  drop constraint if exists chat_customers_broker_check;
alter table public.chat_customers
  add constraint chat_customers_broker_check check (broker in ('XM', 'Exness'));

comment on column public.chat_customers.broker is 'broker ที่แอดมินระบุเอง (XM หลัก / Exness รอง) — ป้ายกำกับเท่านั้น ไม่ได้เช็คจริง';
