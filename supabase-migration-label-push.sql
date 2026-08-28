-- จำว่าติดป้ายสถานะอะไรไปแล้วบ้างบน Meta — ใช้กับปุ่ม "ส่งสถานะไป Meta" (ติดป้ายทั้งหมด)
-- เดิมฟังก์ชันเลือกแถวแบบ limit เฉยๆ ไม่มีการจำ กดซ้ำ = ทำ 500 รายเดิมวนไปเรื่อยๆ ไม่มีวันครบ 4,000+ ราย
-- มีคอลัมน์นี้แล้ว: เลือกเฉพาะรายที่ "ป้ายบน Meta ยังไม่ตรงกับสถานะปัจจุบัน" → ทำต่อจากที่ค้างได้ และไม่ยิงซ้ำฟรี
alter table public.chat_customers add column if not exists label_push_stage text;        -- สถานะที่ติดป้ายไปล่าสุด
alter table public.chat_customers add column if not exists label_push_at timestamptz;    -- เวลาที่ติดป้ายล่าสุด
alter table public.chat_customers add column if not exists label_push_error text;        -- ข้อความ error ถ้าติดไม่สำเร็จ
-- ตัวนับความพยายาม — กันแถวที่ติดป้ายไม่สำเร็จซ้ำๆ วนกลับมาบล็อกคิวไม่จบ (รีเซ็ตเมื่อสำเร็จ)
alter table public.chat_customers add column if not exists label_push_attempts int not null default 0;

-- index บางส่วน: หาแถวที่ยังต้องติดป้ายได้เร็ว (ป้ายไม่ตรงสถานะ)
create index if not exists chat_customers_label_pending_idx
  on public.chat_customers (last_message_at desc)
  where psid is not null;
