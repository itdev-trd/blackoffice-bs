-- cron ต่อ Indicator อัตโนมัติเมื่อ Lot ถึงเกณฑ์ — ทุกคืน 03:00 ไทย (= 20:00 UTC)
-- ตั้งให้รันก่อน 05:00 ไทย (เวลาของงานถอนสิทธิ์ tv-expire-0500th ถ้าเปิดใช้) คนที่ผ่านเกณฑ์จะได้ต่อก่อนโดนถอน
-- หมายเหตุ 14 ต.ค. 69: งาน tv-expire-0500th ไม่มีอยู่ใน pg_cron จริง
-- เรียก edge function tradingview {"action":"lot_renew_cron"} ด้วย service role (ผลรอบล่าสุดเก็บใน settings.lot_renew_cron_last)
-- ลงทะเบียนใน scheduled_jobs ด้วย ให้เปิด/ปิด/เปลี่ยนเวลาได้จากหน้าตั้งค่า (manage-cron อ่าน body_json)

insert into public.scheduled_jobs (key, jobname, label, description, function_name, cron_expr, enabled, body_json)
values (
  'tv_lot_renew', 'tv-lot-renew-0300th', 'ต่อ Indicator ตาม Lot',
  'ทุกคืน: ตรวจ Lot รอบเดือนของสมาชิกที่ Indicator ใกล้หมด/เพิ่งหมด ผ่านเกณฑ์ = ต่ออายุ +1 เดือนบน TradingView (ต้องรันก่อนงานถอนสิทธิ์ 05:00)',
  'tradingview', '0 20 * * *', true, '{"action":"lot_renew_cron"}'
)
on conflict (key) do update set
  jobname = excluded.jobname, label = excluded.label, description = excluded.description,
  function_name = excluded.function_name, body_json = excluded.body_json, updated_at = now();

-- ตัว cron จริงสร้างผ่าน edge function manage-cron (action "save" key "tv_lot_renew") เหมือนงานอื่นทุกตัว
-- manage-cron ใส่ service key ให้เองฝั่งเซิร์ฟเวอร์ — โปรเจกต์นี้ไม่มี vault secret project_url/service_role_key
