-- ถอด index trigram บน transcript::text (เพิ่มเมื่อเช้า 7 ต.ค. เพื่อค้นหาข้อความ)
-- ทุกครั้งที่แชทอัปเดต (ข้อความเข้า/ซิงก์/อ่านแล้ว) ต้องคำนวณ trigram ใหม่ของบทสนทนาทั้งห้อง
-- index ใหญ่ 51 MB บนฐานข้อมูล micro → เขียนช้า ทุกคำขอรอคิว เปิดแชทเกิน 12 วิจน timeout
-- ค้นหาข้อความยังใช้ได้ (search_chat_messages ไม่ได้ต้องการ index) แค่ช้ากว่าเดิมเล็กน้อย
drop index if exists public.chat_customers_transcript_trgm;
