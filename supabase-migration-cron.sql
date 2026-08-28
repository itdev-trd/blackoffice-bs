-- ============================================================
-- ตั้งเวลาให้ monitor-ads ทำงานอัตโนมัติ (pg_cron + pg_net)
-- ทำหลังจาก deploy edge function "monitor-ads" เสร็จแล้วเท่านั้น
-- ไปที่ Database → Extensions → เปิดใช้งาน pg_cron และ pg_net ก่อน (ข้ามได้ถ้าเคยเปิดไว้แล้ว)
-- แล้วค่อยรันไฟล์นี้ใน SQL Editor
-- ============================================================

-- ยกเลิก cron job เดิมของฟังก์ชันนี้ก่อน (ถ้ามี) กันซ้ำซ้อนตอนรันไฟล์นี้ใหม่
select cron.unschedule(jobid)
from cron.job
where jobname = 'ai-ads-monitor-every-15min';

-- รันทุก 15 นาที — ตัวฟังก์ชัน monitor-ads เองจะเช็คเวลาที่เหมาะสมอีกที
-- (ปรับความถี่การ "ตัดสินใจ" จริงได้จากหน้าตั้งค่าในเว็บแอป โดยไม่ต้องมาแก้ cron นี้ซ้ำ
--  เพราะฟังก์ชันจะเทียบเวลาล่าสุดที่เช็คแต่ละแอดกับ monitor_interval_minutes เอง)
select cron.schedule(
  'ai-ads-monitor-every-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/monitor-ads',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- หมายเหตุ: วิธีข้างบนอ้างอิง Supabase Vault ซึ่งบางโปรเจกต์อาจยังไม่ได้ตั้งค่า
-- ถ้ารันแล้ว error เรื่อง vault.decrypted_secrets ไม่มีข้อมูล ให้ใช้วิธีง่ายกว่านี้แทน (แก้ 2 ค่าให้ตรงโปรเจกต์คุณ
-- แล้วรันแทนคำสั่ง cron.schedule ด้านบน):
--
-- select cron.schedule(
--   'ai-ads-monitor-every-15min',
--   '*/15 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/monitor-ads',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer YOUR-SERVICE-ROLE-KEY'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
--
-- เช็คว่าตั้งสำเร็จ:
-- select * from cron.job;
-- ดู log การรันย้อนหลัง:
-- select * from cron.job_run_details order by start_time desc limit 20;
