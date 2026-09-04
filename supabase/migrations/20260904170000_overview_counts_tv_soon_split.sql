-- แยกช่วงไม่ให้ซ้ำกัน: tvSoon3 = เหลือ <= 3 วัน (เร่งด่วน) · tvSoon = เหลือ 4-7 วัน
-- ก่อนหน้านี้ tvSoon นับตั้งแต่ 0-7 วัน ทำให้คนกลุ่มเร่งด่วนถูกนับซ้ำในสองการ์ด
-- อ่านตัวเลขแล้วสับสนว่าตกลงต้องรีบติดต่อกี่คน
create or replace function public.overview_counts()
 returns json
 language sql
 stable
 set search_path to 'public'
as $function$
  select json_build_object(
    'customers',  (select count(*) from chat_customers where blocked_at is null),
    'unanswered', (select count(*) from chat_customers where blocked_at is null and awaiting_reply),
    'fresh7',     (select count(*) from chat_customers where first_customer_message_at >= now() - interval '7 days'),
    'tvAll',      (select count(*) from tv_external_members),
    'tvSoon',     (select count(*) from tv_external_members
                    where expiration > now() + interval '3 days'
                      and expiration <= now() + interval '7 days'),
    'tvSoon3',    (select count(*) from tv_external_members
                    where expiration >= now() and expiration <= now() + interval '3 days'),
    'tvExpired',  (select count(*) from tv_external_members where expiration < now())
  );
$function$;

-- เช็ค: select public.overview_counts();  -- tvSoon3 + tvSoon ต้องไม่มีคนซ้ำกันแล้ว
