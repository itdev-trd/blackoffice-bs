-- สถิติ "การอ่าน" เพิ่มจากสถิติ "การตอบ"
-- อ่านช้า = ลูกค้าทักแล้วกว่าจะมีคนเปิดอ่านใช้เวลานาน (คนละเรื่องกับตอบช้า — อ่านแล้วอาจยังไม่ตอบ)
-- ยังไม่อ่าน = ยังไม่มีใครเปิดดูเลย
alter table public.reply_stats add column if not exists read_at timestamptz;      -- เวลาที่เปิดอ่านรอบนี้ (null = ยังไม่อ่าน/ไม่ทราบ)
alter table public.reply_stats add column if not exists is_unread boolean not null default false;  -- รอบล่าสุดที่ยังไม่ถูกอ่าน

comment on column public.reply_stats.read_at is 'เวลาที่เปิดอ่านข้อความรอบนี้ — จับคู่จาก chat_customers.read_at ที่ตกอยู่ในช่วงของรอบนี้';
comment on column public.reply_stats.is_unread is 'true = รอบล่าสุดของแชทที่ยังไม่มีใครเปิดอ่าน (สถานะปัจจุบัน)';
