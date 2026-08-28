-- ============================================================
-- แผงคุมงานอัตโนมัติ (cron) — เปิด/ปิด/ตั้งเวลา เอง
-- รันใน Supabase → SQL Editor
-- สำคัญ: เวลาของ cron เป็น UTC (ไทย = UTC+7) เช่น 8 โมงเช้าไทย = "0 1 * * *"
-- ============================================================

-- 1) ดูงานทั้งหมดที่ตั้งไว้ (ชื่อ / ตาราง / เปิดอยู่ไหม)
select jobid, jobname, schedule, active from cron.job order by jobname;

-- 2) ดูประวัติการรันล่าสุด (succeeded/failed)
select jobname, status, start_time from cron.job_run_details order by start_time desc limit 20;


-- ============================================================
-- งานที่ 1: "ตรวจโฆษณาอัตโนมัติ" (monitor-ads)
--   เช็คผลโฆษณา + auto-pause แอดที่ผลแย่/แชทผี ตามเกณฑ์ในหน้าตั้งค่า
-- ============================================================
-- เปลี่ยนความถี่ (แก้ schedule แล้วรัน)
select cron.alter_job(
  (select jobid from cron.job where jobname = 'ai-ads-monitor-every-15min'),
  schedule => '*/30 * * * *'   -- ทุก 30 นาที (เดิม */15 = ทุก 15 นาที)
);
-- ปิดงานนี้ชั่วคราว:  select cron.alter_job((select jobid from cron.job where jobname='ai-ads-monitor-every-15min'), active => false);
-- เปิดกลับ:          select cron.alter_job((select jobid from cron.job where jobname='ai-ads-monitor-every-15min'), active => true);


-- ============================================================
-- งานที่ 2: "ดึงแชทลูกค้า" (sync-conversations)
--   ดึงแชท Messenger เข้ามาอัปเดต + ติดสถานะลูกค้า
--   ** ถ้าโดน rate limit บ่อย ให้ลดความถี่งานนี้ **
-- ============================================================
select cron.alter_job(
  (select jobid from cron.job where jobname = 'chat-sync-every-30min'),
  schedule => '0 */2 * * *'    -- ทุก 2 ชม. (เดิม */30 = ทุก 30 นาที)
);
-- ปิดงานนี้ชั่วคราว:  select cron.alter_job((select jobid from cron.job where jobname='chat-sync-every-30min'), active => false);
-- เปิดกลับ:          select cron.alter_job((select jobid from cron.job where jobname='chat-sync-every-30min'), active => true);


-- ============================================================
-- โพยความถี่ (schedule) ที่ใช้บ่อย — เวลา UTC
--   */15 * * * *   ทุก 15 นาที
--   */30 * * * *   ทุก 30 นาที
--   0 * * * *      ทุก 1 ชั่วโมง
--   0 */2 * * *    ทุก 2 ชั่วโมง
--   0 */6 * * *    ทุก 6 ชั่วโมง
--   0 1 * * *      ทุกวัน 08:00 น. (ไทย)   ← 1 UTC = 8 โมงไทย
--   0 13 * * *     ทุกวัน 20:00 น. (ไทย)
-- ============================================================
