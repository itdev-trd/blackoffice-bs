-- หน้า "ตอบแชท" (Inbox สไตล์ Messenger + แปลอัตโนมัติ)
alter table public.chat_customers add column if not exists awaiting_reply boolean not null default false; -- ข้อความล่าสุดมาจากลูกค้า (เรายังไม่ได้ตอบ)
alter table public.chat_customers add column if not exists cust_lang text;    -- ภาษาลูกค้าที่ตรวจได้ (เช่น Vietnamese, Bahasa Indonesia, Tagalog)
alter table public.chat_customers add column if not exists country text;      -- ประเทศที่คาดว่าลูกค้าอยู่ (เดาจากภาษา/บริบท)

-- index: ลิสต์ "ยังไม่ได้ตอบ" เรียงตามเวลาล่าสุด
create index if not exists chat_customers_awaiting_idx on public.chat_customers (last_message_at desc) where awaiting_reply;
