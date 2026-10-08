-- ตาข่ายกันพลาดของหน้าแชท: ถาม "มีห้องไหนเปลี่ยนตั้งแต่ changed_at ล่าสุด" จาก chat_live (แทนโหลดลิสต์ทั้งชุด)
create index if not exists chat_live_changed_at on public.chat_live (changed_at);

-- หน้าเว็บเลิกเรียก sync-conversations (recent) เองแล้ว → เหลือ cron ที่เดียว กลับไปถามทุกนาทีได้โดยภาระไม่คูณตามจำนวนเครื่อง
select cron.alter_job(job_id := 7, schedule := '* * * * *');
