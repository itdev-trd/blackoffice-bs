-- ตั้งเวลาให้ดึงแชท Instagram เองทุก 10 นาที
--
-- เดิม sync-instagram-recent ถูกเรียกจากหน้าเว็บเท่านั้น (ทุก 10 นาทีตอนมีคนเปิดแท็บตอบแชท)
-- ไม่มีใครเปิดแอป = IG ไม่ถูกดึงเลย ต่างจาก Messenger ที่มี cron chat-recent-2min คอยดึงให้
-- ตอนนี้ฟังก์ชันรับคำขอจาก service role ได้แล้ว (allowService) และไม่เสียคำขอที่ Meta ปฏิเสธซ้ำ ๆ
-- (จำ heavy_blocked ต่อเพจ) จึงเอามาตั้ง cron ได้อย่างปลอดภัย · ตัวฟังก์ชันมี cooldown 10 นาทีของตัวเองอีกชั้น
insert into public.scheduled_jobs (key, jobname, label, description, function_name, cron_expr, enabled, body_json)
values (
  'ig_sync', 'ig-sync-10min', 'ดึงแชท Instagram (ทุก 10 นาที)',
  'ดึงห้องแชท Instagram ล่าสุดของทุกเพจที่ผูก IG ไว้ · ถ้า Meta ไม่ยอมให้ขอเป็นชุด (แอปยังไม่มี Advanced Access) จะไล่เก็บทีละห้องแทน',
  'sync-instagram-recent', '*/10 * * * *', true, '{}'
)
on conflict (key) do nothing;
