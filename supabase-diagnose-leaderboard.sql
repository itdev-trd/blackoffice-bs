-- ============================================================
-- ตรวจว่าทำไมกระดานแต้มมีข้อมูลแค่ ~3 วันล่าสุด
-- รันทีละบล็อกใน Supabase SQL Editor แล้วดูผล
-- ============================================================

-- 1) reply_stats ย้อนหลังแค่ไหน + มีกี่แถว
select min(msg_at) as เก่าสุด, max(msg_at) as ใหม่สุด, count(*) as จำนวนแถว
from public.reply_stats;

-- 2) จำนวนรอบต่อวัน (30 วันล่าสุด) — ดูว่ามีข้อมูลก่อน 3 วันไหม และมาจากไหน (app/page/unanswered)
select (msg_at at time zone 'Asia/Bangkok')::date as วันที่,
       source, count(*) as จำนวน
from public.reply_stats
where msg_at >= now() - interval '30 days'
group by 1, 2
order by 1 desc, 2;

-- 3) cron 'rebuild-reply-stats' ถูก schedule จริงไหม + รันล่าสุดเมื่อไหร่/สำเร็จไหม
--    ถ้าไม่เห็นแถว 'reply-stats-hourly' = ยังไม่ถูกตั้งใน pg_cron (ต้นเหตุ)
select * from public.app_list_cron();

-- 4) สถานะการลงทะเบียนงานในแอป (ควร enabled = true)
select key, jobname, function_name, cron_expr, enabled
from public.scheduled_jobs where key = 'replystats';

-- 5) transcript ในแชทย้อนหลังได้แค่ไหน (แหล่งดิบของแต้ม)
--    ดูข้อความ "เก่าสุด" ที่ยังเก็บอยู่จริงในแต่ละแชท แล้วเอาค่าที่เก่าสุดรวม
select min((m->>'at')::timestamptz) as ข้อความเก่าสุดที่ยังเก็บอยู่,
       count(*) as จำนวนแชทที่มี_transcript
from public.chat_customers c
cross join lateral jsonb_array_elements(coalesce(c.transcript, '[]'::jsonb)) as m
where (m->>'at') is not null;

-- 6) แชทที่ยัง active ก่อน 3 วัน มีกี่ราย (ถ้ามีเยอะ แปลว่าข้อมูลดิบมี แต่ยังไม่ถูกสรุปเข้า reply_stats)
select
  count(*) filter (where last_message_at < now() - interval '3 days')  as แชทเก่ากว่า3วัน,
  count(*) filter (where last_message_at < now() - interval '7 days')  as แชทเก่ากว่า7วัน,
  count(*) as แชททั้งหมด
from public.chat_customers;
