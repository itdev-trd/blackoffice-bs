-- เวลาที่แอดมิน "อ่านในแอป" ล่าสุด — ใช้กัน unread_count ของ Meta เขียนทับสถานะอ่านกลับ
-- กติกา: unread จะกลับมาเป็น true ได้ก็ต่อเมื่อมีข้อความใหม่กว่าเวลาที่อ่าน (last_message_at > read_at)
alter table public.chat_customers add column if not exists read_at timestamptz;
