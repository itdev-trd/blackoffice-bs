-- เก็บ Facebook user id ของผู้คอมเมนต์ (v.from.id จาก webhook) ไว้แท็ก @[user_id] ตอนตอบกลับ
-- ให้ข้อความที่ตอบผ่านเว็บมีชื่อผู้คอมเมนต์เป็น mention สีน้ำเงินเหมือนตอบผ่านเพจเองโดยตรง
alter table public.chat_customers
  add column if not exists comment_from_id text;
