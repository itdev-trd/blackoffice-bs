-- ตัวนับความพยายามของ AI ต่อแชท — กันแชทที่โมเดลตอบไม่ได้ (JSON เพี้ยน/id หาย) ค้างหัวคิววนยิงซ้ำไม่จบ
-- job classify/verify จะข้ามแถวที่ลองเกิน 5 ครั้ง และตัวนับรีเซ็ตเป็น 0 อัตโนมัติเมื่อเนื้อหาแชทเปลี่ยน
-- ** ต้องรันไฟล์นี้ก่อน deploy sync-conversations / meta-webhook เวอร์ชันใหม่ **
alter table public.chat_customers add column if not exists ai_attempts int not null default 0;
alter table public.chat_customers add column if not exists verify_attempts int not null default 0;
