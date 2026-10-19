-- งานตั้งเวลา: หาแหล่งแอดของแชท Jr 1Shot ทุก 3 ชม. (เพจนี้ไม่มี referral จาก webhook)
-- ตัว cron จริงสร้างผ่าน manage-cron (action save key jr1shot_ad_attribution) เหมือนงานอื่น
insert into public.scheduled_jobs (key, jobname, label, description, function_name, cron_expr, enabled, body_json)
values (
  'jr1shot_ad_attribution', 'jr1shot-ad-attribution-3h', 'หาแหล่งแอดแชท Jr 1Shot',
  'ทุก 3 ชม.: แชท Jr 1Shot ที่ขึ้นต้น "ตอบกลับโฆษณา" จับคู่ข้อความทักทายกับแอด (ไม่ได้ = ระบุกลุ่มข้อความโฆษณา) เพราะเพจนี้ไม่มีข้อมูล referral จาก webhook',
  'chat-ad-attribution', '15 */3 * * *', true, '{"page_id":"1272538665947061","apply":true}'
)
on conflict (key) do update set jobname = excluded.jobname, label = excluded.label, description = excluded.description,
  function_name = excluded.function_name, cron_expr = excluded.cron_expr, body_json = excluded.body_json, updated_at = now();
