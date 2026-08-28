-- ข้อมูลเพิ่มสำหรับหน้าตอบแชท
-- 1) ข้อความ/ชื่อ/เวลา ของ "การตอบล่าสุดฝั่งเพจ" — ไว้โชว์บนป้ายชื่อทางซ้าย (เดิมโชว์แต่ข้อความลูกค้า)
alter table public.chat_customers add column if not exists last_reply_text text;   -- ข้อความล่าสุดที่แอดมินตอบ
alter table public.chat_customers add column if not exists last_reply_by text;     -- ชื่อแอดมินที่ตอบ (ถ้ารู้)
alter table public.chat_customers add column if not exists last_reply_at timestamptz;

-- 2) เวลาที่ "ลูกค้าเปิดอ่าน" ข้อความของเราล่าสุด — จาก webhook field message_reads
alter table public.chat_customers add column if not exists cust_read_at timestamptz;

comment on column public.chat_customers.last_reply_text is 'ข้อความล่าสุดฝั่งเพจ — โชว์บนป้ายชื่อซ้ายเมื่อแอดมินตอบทีหลังลูกค้า';
comment on column public.chat_customers.cust_read_at is 'เวลาที่ลูกค้าเปิดอ่านข้อความเราล่าสุด (message_reads watermark)';
