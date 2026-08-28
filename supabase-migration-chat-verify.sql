-- Two-stage AI: โมเดลใหญ่ตรวจซ้ำคอนเวอร์ชั่น แล้ว "แช่แข็ง" ไม่ส่ง AI อีกเพื่อประหยัดโทเคน
alter table public.chat_customers add column if not exists verify_hash text;                       -- hash เนื้อแชทตอนโมเดลใหญ่ตรวจล่าสุด
alter table public.chat_customers add column if not exists ai_verified boolean not null default false; -- true = โมเดลใหญ่ยืนยัน converted จริง → รอบถัดไปไม่ส่ง AI อีก
