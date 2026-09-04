-- เพิ่มตัวนับ "สิทธิ์ TradingView ใกล้หมดใน 3 วัน" ในหน้าภาพรวม
-- ของเดิมมีแค่ 7 วัน ซึ่งกว้างเกินกว่าจะใช้ตัดสินใจว่าต้องรีบติดต่อใครวันนี้
-- หมายเหตุ: คนที่เหลือ <= 3 วัน จะถูกนับใน tvSoon (7 วัน) ด้วย — เป็นช่วงซ้อนกันโดยตั้งใจ
--           ตัวเลข 3 วันคือ "กลุ่มเร่งด่วน" ที่เป็นส่วนหนึ่งของ 7 วัน ไม่ใช่คนละกลุ่ม
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
                    where expiration >= now() and expiration <= now() + interval '7 days'),
    'tvSoon3',    (select count(*) from tv_external_members
                    where expiration >= now() and expiration <= now() + interval '3 days'),
    'tvExpired',  (select count(*) from tv_external_members where expiration < now())
  );
$function$;

-- เช็ค: select public.overview_counts();
