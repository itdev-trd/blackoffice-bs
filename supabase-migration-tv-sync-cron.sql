-- ซิงก์สิทธิ์ TradingView แบบ batch วันละครั้งเวลา 00:05 น. ตามเวลาไทย
-- 00:05 ไทย = 17:05 UTC ของวันก่อนหน้า (pg_cron ใช้ UTC)
-- ต้องรันหลังจากมีตาราง tv_access/tv_scripts และตั้ง Vault: project_url, service_role_key

select cron.unschedule(jobid)
from cron.job
where jobname in ('tv-sync-midnight-th', 'tv-sync-daily', 'tv-access-sync-midnight');

select cron.schedule('tv-sync-midnight-th', '5 17 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/tradingview',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{"action":"sync"}'::jsonb
  );
$$);

-- ตรวจสอบงาน: select jobname, schedule, active from cron.job where jobname = 'tv-sync-midnight-th';
