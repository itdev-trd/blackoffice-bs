-- ปิด cron ตรวจโฆษณาอัตโนมัติ (monitor-ads) ทิ้งถาวร
-- เหตุผล: ตัวฟังก์ชัน monitor-ads ใส่ kill-switch no-op ไว้แล้ว (settings.monitor_ads_enabled)
--         แต่ cron ยังยิงทุก 15 นาทีตลอด 24 ชม. (96 ครั้ง/วัน) เข้าไปเจอ no-op แล้วออก = เปลือง edge invocation ฟรีๆ
-- ผลของสคริปต์นี้: ลบ job ออกจาก pg_cron + มาร์คปิดในตาราง scheduled_jobs (ถ้ามี)
-- เปิดกลับภายหลัง: รัน migration cron เดิมใหม่ (supabase-migration-cron.sql) แล้วตั้ง settings.monitor_ads_enabled=true

-- 1) ลบออกจาก pg_cron (กันชื่อซ้ำหลาย job)
select cron.unschedule(jobid) from cron.job where jobname = 'ai-ads-monitor-every-15min';

-- 2) มาร์คปิดในตารางคุมงาน (ไม่ให้ปุ่ม/หน้าตั้งค่าเผลอเปิดกลับ) — ข้ามเงียบถ้ายังไม่มีตารางนี้
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'scheduled_jobs') then
    update public.scheduled_jobs set enabled = false where jobname = 'ai-ads-monitor-every-15min';
  end if;
end $$;

-- ตรวจผล: ควรได้ 0 แถว = ไม่มี job นี้ใน cron แล้ว
select jobname, schedule, active from cron.job where jobname = 'ai-ads-monitor-every-15min';
