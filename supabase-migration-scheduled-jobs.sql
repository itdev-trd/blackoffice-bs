-- จัดการงานอัตโนมัติ (cron) ผ่านแอปได้
-- ต้องเปิด extension pg_cron + pg_net ก่อน (ปกติเปิดไว้แล้วถ้าใช้ cron อยู่)

-- ตารางเก็บ "งาน" พร้อมชื่อ/คำอธิบายอ่านง่าย + ความถี่ + เปิด/ปิด
create table if not exists public.scheduled_jobs (
  key text primary key,          -- รหัสภายใน
  jobname text not null,          -- ชื่อ job ใน pg_cron
  label text not null,            -- ชื่อไทยอ่านง่าย
  description text,               -- อธิบายว่าใช้ทำอะไร
  function_name text not null,    -- edge function ที่จะเรียก
  cron_expr text not null default '0 */2 * * *',
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.scheduled_jobs enable row level security; -- อ่าน/เขียนผ่าน edge function (service role) เท่านั้น

insert into public.scheduled_jobs (key, jobname, label, description, function_name, cron_expr, enabled) values
  ('monitor',  'ai-ads-monitor-every-15min', 'ตรวจโฆษณาอัตโนมัติ', 'เช็คผลโฆษณาเป็นรอบ แล้ว auto-pause แอดที่ผลแย่/แชทผี ตามเกณฑ์ในหน้าตั้งค่า', 'monitor-ads', '*/30 * * * *', true),
  ('chatsync', 'chat-sync-every-30min',      'ดึงแชทลูกค้า',        'ดึงแชท Messenger เข้ามาอัปเดต + ติดสถานะลูกค้าอัตโนมัติ',                 'sync-conversations', '0 */2 * * *', true)
on conflict (key) do nothing;

-- ตั้ง/ยกเลิก cron job (SECURITY DEFINER เพื่อเข้าถึง schema cron ได้)
create or replace function public.app_set_cron(p_jobname text, p_schedule text, p_command text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public, cron as $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = p_jobname; -- ลบของเดิมกันซ้ำ
  if p_enabled then
    perform cron.schedule(p_jobname, p_schedule, p_command);
  end if;
end; $$;

-- อ่านสถานะจริงจาก pg_cron + การรันล่าสุด
create or replace function public.app_list_cron()
returns table(jobname text, schedule text, active boolean, last_status text, last_run timestamptz)
language sql security definer set search_path = public, cron as $$
  select j.jobname, j.schedule, j.active,
    (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1),
    (select d.start_time from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1)
  from cron.job j;
$$;

grant execute on function public.app_set_cron(text, text, text, boolean) to service_role;
grant execute on function public.app_list_cron() to service_role;
