-- ตั้งเวลาให้ sync-conversations ดึงแชทเข้ามาอัตโนมัติทุก 30 นาที
-- ทำหลัง deploy edge function "sync-conversations" และเปิด pg_cron + pg_net แล้ว
select cron.unschedule(jobid) from cron.job where jobname = 'chat-sync-every-30min';

select cron.schedule(
  'chat-sync-every-30min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sync-conversations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ถ้า project ยังไม่ได้ตั้ง Vault ให้ใช้แบบระบุค่าตรงแทน (แก้ 2 ค่าให้ตรงโปรเจกต์):
-- select cron.schedule('chat-sync-every-30min','*/30 * * * *', $$
--   select net.http_post(
--     url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/sync-conversations',
--     headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer YOUR-SERVICE-ROLE-KEY'),
--     body := '{}'::jsonb);
-- $$);
