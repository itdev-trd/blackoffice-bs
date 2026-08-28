-- ================================================================
-- วินิจฉัยว่า cron ส่งแจ้งเตือน (push-overdue-2min) รันจริงและสำเร็จไหม
-- รันใน Supabase SQL Editor แล้วส่งผลทั้ง 3 บล็อกมาให้ดู
-- ================================================================

-- (1) cron push ถูกตั้งใน pg_cron ไหม + ตารางเวลา + เปิดอยู่ไหม
select jobid, jobname, schedule, active
from cron.job
where jobname ilike '%push%' or jobname ilike '%overdue%';

-- (2) ผลรัน 20 ครั้งล่าสุดของ cron push — ดูว่า succeeded/failed + ข้อความ error
select j.jobname, r.status, r.start_time, r.end_time,
       left(coalesce(r.return_message, ''), 200) as message
from cron.job_run_details r
join cron.job j on j.jobid = r.jobid
where j.jobname ilike '%push%' or j.jobname ilike '%overdue%'
order by r.start_time desc
limit 20;

-- (3) Vault มีค่าที่ cron ต้องใช้ยิงเข้า edge function ไหม (ถ้าไม่มี = cron ยิงไม่ออก เงียบ)
select name, (decrypted_secret is not null) as has_value
from vault.decrypted_secrets
where name in ('project_url', 'service_role_key');

-- (4) แถม: subscription ของคุณยัง active ไหม (last_ok_at = ครั้งล่าสุดที่ push ส่งสำเร็จ)
select email, left(endpoint, 30) as endpoint, device_id, pages,
       to_char(updated_at, 'MM-DD HH24:MI') as updated, to_char(last_ok_at, 'MM-DD HH24:MI') as last_ok
from public.push_subscriptions
where email = 'aphiwat@traderidermedia.com'
order by updated_at desc;
