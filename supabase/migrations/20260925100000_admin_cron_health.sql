-- สรุปสถานะงานตั้งเวลา (pg_cron) ให้ system-health อ่าน — schema cron เรียกผ่าน PostgREST ตรงไม่ได้
-- หมายเหตุ: net.http_post ใน cron ถือว่า "สำเร็จ" ทันทีที่เข้าคิว ถ้า function ปลายทางตอบ error
-- จะไม่นับเป็น failed ที่นี่ — ข้อนี้จับได้แค่ SQL ของงานเองพัง (เช่น cron ถูกปิด/คำสั่งผิดรูป)
create or replace function public.admin_cron_health()
returns table (jobname text, schedule text, active boolean, last_status text, last_run timestamptz, failed_24h integer)
language sql
security definer
set search_path = ''
as $$
  select j.jobname::text, j.schedule::text, j.active,
         (select d.status::text from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1),
         (select max(d.start_time) from cron.job_run_details d where d.jobid = j.jobid),
         (select count(*)::int from cron.job_run_details d where d.jobid = j.jobid and d.status = 'failed' and d.start_time > now() - interval '24 hours')
  from cron.job j
  order by j.jobname;
$$;
revoke all on function public.admin_cron_health() from public, anon, authenticated;
grant execute on function public.admin_cron_health() to service_role;
