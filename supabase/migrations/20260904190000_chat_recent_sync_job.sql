-- ดึงแชทล่าสุดถี่ ๆ แยกจาก "ซิงก์แชทรายวัน"
--
-- Meta ส่ง webhook ข้อความของลูกค้าทั่วไปเข้ามาไม่ได้จนกว่าแอปจะได้ Advanced Access ของ pages_messaging
-- (settings.meta_webhook_last_event ค้างเป็นวัน ทั้งที่เพจ subscribe ครบ) แชทใหม่จึงเข้าระบบได้ทางเดียว
-- คือ "ดึงเอง" — ถ้ามีแต่ cron ทุก 15 นาที กล่องตอบแชทจะช้ากว่ากล่องข้อความเพจหลายนาที
-- และการแจ้งเตือน "แชทค้างอ่านเกิน 3 นาที" ก็เตือนจากข้อมูลที่ล้าสมัย
--
-- job "recent" = 1 คำขอ/เพจ (25 ห้องที่ขยับล่าสุด) และเขียนเฉพาะห้องที่มีข้อความใหม่จริง
-- ต่างจากซิงก์เต็มที่กวาดได้ถึง 300 ห้องและเขียนทุกแถวที่กวาดเจอ
alter table public.scheduled_jobs add column if not exists body_json text not null default '{}';

-- งานที่ต้องส่ง body เฉพาะทางต้องเก็บ body ไว้กับงาน ไม่ใช่ hardcode ใน manage-cron
-- (เดิม manage-cron เขียน body '{}' ให้ทุกงานยกเว้น tv_sync ถ้าแอดมินแก้ความถี่งานนี้จาก UI
--  งานจะกลายเป็นซิงก์เต็มทุก 2 นาทีทันที)
update public.scheduled_jobs set body_json = '{"action":"sync"}' where key = 'tv_sync' and body_json = '{}';

insert into public.scheduled_jobs (key, jobname, label, description, function_name, cron_expr, enabled, body_json)
values (
  'chat_recent', 'chat-recent-2min', 'ดึงแชทล่าสุด (ทุก 2 นาที)',
  'ดึงเฉพาะห้องแชทที่ขยับล่าสุดของแต่ละเพจ (คำขอเดียว/เพจ) ให้แชทใหม่เข้าระบบไม่เกิน ~2 นาที แม้ไม่มีใครเปิดแอป · หน้าตอบแชทเรียกงานเดียวกันนี้ทุก ~30 วิ ตอนมีคนใช้งาน',
  'sync-conversations', '*/2 * * * *', true, '{"job":"recent"}'
)
on conflict (key) do nothing;
