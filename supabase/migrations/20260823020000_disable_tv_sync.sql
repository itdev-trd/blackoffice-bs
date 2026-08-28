-- ยกเลิกการซิงก์รายชื่อสมาชิก TradingView อัตโนมัติ
-- คง snapshot และประวัติสมาชิกเดิมไว้ แต่หยุด cron และซ่อนงานนี้จากหน้าตั้งค่า

select public.app_set_cron(
  'tv-sync-midnight-th',
  '5 17 * * *',
  'select 1;',
  false
);

update public.scheduled_jobs
set enabled = false,
    updated_at = now()
where key = 'tv_sync';

