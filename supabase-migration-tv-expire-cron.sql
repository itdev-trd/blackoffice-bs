-- ตั้ง cron ถอนสิทธิ์ TradingView ที่หมดอายุอัตโนมัติ — วันละครั้ง เวลา 05:00 น. ไทย (= 22:00 UTC เพราะ pg_cron ใช้ UTC)
-- ทำงาน: เช็ค tv_access ที่ status=active + expiration เลยเวลาปัจจุบัน → สั่ง n8n ถอนสิทธิ์ TV → มาร์ค expired
-- ต้องเปิด pg_cron + pg_net และตั้ง Vault (project_url, service_role_key) + deploy edge "tradingview" + ตั้ง n8n webhook ในแอปก่อน

-- ลบ job เก่าทุกชื่อ กันซ้ำ
select cron.unschedule(jobid) from cron.job where jobname in ('tv-expire-daily','tv-expire-hourly','tv-expire-0500th');

select cron.schedule('tv-expire-0500th', '0 22 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/tradingview',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := '{"action":"expire"}'::jsonb
  );
$$);

-- เช็ค: select jobname, schedule from cron.job where jobname = 'tv-expire-0500th';   (schedule ควรเป็น 0 22 * * * = 05:00 ไทย)
