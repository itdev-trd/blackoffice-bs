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
