-- ให้การซิงก์สมาชิก TradingView แสดงและตั้งเวลาได้จากหน้า งานอัตโนมัติ
insert into public.scheduled_jobs
  (key, jobname, label, description, function_name, cron_expr, enabled)
values
  ('tv_sync', 'tv-sync-midnight-th', 'ซิงก์สมาชิก TradingView',
   'ดึงรายชื่อสมาชิกจาก TradingView มาเทียบกับฐานข้อมูลและอัปเดตสถานะ/วันหมดอายุ',
   'tradingview', '5 17 * * *', true)
on conflict (key) do update set
  jobname = excluded.jobname,
  label = excluded.label,
  description = excluded.description,
  function_name = excluded.function_name,
  updated_at = now();

-- ยืนยันค่าเริ่มต้นหลัง migration โดยไม่ลบตารางหรือข้อมูลสมาชิก
select public.app_set_cron(
  'tv-sync-midnight-th',
  '5 17 * * *',
  $$select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/tradingview',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := '{"action":"sync"}'::jsonb
  );$$,
  true
);
