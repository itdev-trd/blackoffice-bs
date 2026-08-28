-- ตั้ง cron ให้ prefetch-insights ดึงรีพอร์ต ads ล่วงหน้ามา cache
-- ต้องเปิด pg_cron + pg_net และตั้ง Vault (project_url, service_role_key) ก่อน — เหมือน cron อื่นในระบบ
-- แก้ URL/KEY ให้ตรงโปรเจกต์ถ้าไม่ได้ใช้ Vault (ดูตัวอย่างใน supabase-migration-cron.sql)

-- 1) SEED ทุกวันตี 1 (เวลาไทย = 18:00 UTC ของวันก่อนหน้า) — สร้างคิวงานใหม่จากที่เลือกไว้
select cron.unschedule(jobid) from cron.job where jobname = 'insights-prefetch-seed';
select cron.schedule('insights-prefetch-seed', '0 18 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/prefetch-insights',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := '{"seed":true}'::jsonb
  );
$$);

-- 2) DRAIN ทุก 15 นาที — ทยอยดึงจากคิวทีละก้อน (เช็ค rate guard เอง ใกล้เต็มก็พัก)
select cron.unschedule(jobid) from cron.job where jobname = 'insights-prefetch-drain';
select cron.schedule('insights-prefetch-drain', '*/15 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/prefetch-insights',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := '{}'::jsonb
  );
$$);

-- เช็ค: select jobname, schedule from cron.job;
-- ปิดชั่วคราว: select cron.unschedule('insights-prefetch-seed'); select cron.unschedule('insights-prefetch-drain');
