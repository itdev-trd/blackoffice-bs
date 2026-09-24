-- ห้องแชทที่ถูกลบถาวรตามที่แอดมินตั้งวันไว้ (chat-retention action run)
-- ต้องจำไว้ ไม่งั้นงานซิงก์ Messenger จะเห็นว่า "ยังไม่มีในฐานข้อมูล" แล้วดึงห้องกลับมาใหม่ทั้งห้อง
-- ถ้าลูกค้าทักมาใหม่หลังลบ (updated_time > last_message_at) ซิงก์จะสร้างห้องใหม่ตามปกติ
create table if not exists public.chat_purged (
  id text primary key,
  page_id text,
  psid text,
  source text,
  last_message_at timestamptz,
  purged_at timestamptz not null default now()
);
alter table public.chat_purged enable row level security;
-- ไม่มี policy = อ่าน/เขียนได้เฉพาะ service role (edge functions)
