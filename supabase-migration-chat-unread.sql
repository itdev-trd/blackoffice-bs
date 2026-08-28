-- จุดแดง = "ยังไม่อ่าน" (มีข้อความใหม่ที่แอดมินยังไม่เปิดอ่าน) แทน "ยังไม่ตอบ"
alter table public.chat_customers add column if not exists unread boolean not null default false;
-- ตั้งค่าเริ่มต้น: ที่ยังไม่ได้ตอบอยู่ตอนนี้ ให้ถือว่ายังไม่อ่านไปก่อน
update public.chat_customers set unread = true where awaiting_reply = true and unread = false;
create index if not exists chat_customers_unread_idx on public.chat_customers (last_message_at desc) where unread;
