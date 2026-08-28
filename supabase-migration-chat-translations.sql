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
