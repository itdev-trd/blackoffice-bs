-- ============================================================
-- UTILITY / DIAGNOSTIC / MAINTENANCE SCRIPTS (run ad hoc, not part of the migration order)
-- ============================================================

-- ======================================================================
-- FILE: cron-control.sql
-- ======================================================================

-- ============================================================
-- แผงคุมงานอัตโนมัติ (cron) — เปิด/ปิด/ตั้งเวลา เอง
-- รันใน Supabase → SQL Editor
-- สำคัญ: เวลาของ cron เป็น UTC (ไทย = UTC+7) เช่น 8 โมงเช้าไทย = "0 1 * * *"
-- ============================================================

-- 1) ดูงานทั้งหมดที่ตั้งไว้ (ชื่อ / ตาราง / เปิดอยู่ไหม)
select jobid, jobname, schedule, active from cron.job order by jobname;

-- 2) ดูประวัติการรันล่าสุด (succeeded/failed)
select jobname, status, start_time from cron.job_run_details order by start_time desc limit 20;


-- ============================================================
-- งานที่ 1: "ตรวจโฆษณาอัตโนมัติ" (monitor-ads)
--   เช็คผลโฆษณา + auto-pause แอดที่ผลแย่/แชทผี ตามเกณฑ์ในหน้าตั้งค่า
-- ============================================================
-- เปลี่ยนความถี่ (แก้ schedule แล้วรัน)
select cron.alter_job(
  (select jobid from cron.job where jobname = 'ai-ads-monitor-every-15min'),
  schedule => '*/30 * * * *'   -- ทุก 30 นาที (เดิม */15 = ทุก 15 นาที)
);
-- ปิดงานนี้ชั่วคราว:  select cron.alter_job((select jobid from cron.job where jobname='ai-ads-monitor-every-15min'), active => false);
-- เปิดกลับ:          select cron.alter_job((select jobid from cron.job where jobname='ai-ads-monitor-every-15min'), active => true);


-- ============================================================
-- งานที่ 2: "ดึงแชทลูกค้า" (sync-conversations)
--   ดึงแชท Messenger เข้ามาอัปเดต + ติดสถานะลูกค้า
--   ** ถ้าโดน rate limit บ่อย ให้ลดความถี่งานนี้ **
-- ============================================================
select cron.alter_job(
  (select jobid from cron.job where jobname = 'chat-sync-every-30min'),
  schedule => '0 */2 * * *'    -- ทุก 2 ชม. (เดิม */30 = ทุก 30 นาที)
);
-- ปิดงานนี้ชั่วคราว:  select cron.alter_job((select jobid from cron.job where jobname='chat-sync-every-30min'), active => false);
-- เปิดกลับ:          select cron.alter_job((select jobid from cron.job where jobname='chat-sync-every-30min'), active => true);


-- ============================================================
-- โพยความถี่ (schedule) ที่ใช้บ่อย — เวลา UTC
--   */15 * * * *   ทุก 15 นาที
--   */30 * * * *   ทุก 30 นาที
--   0 * * * *      ทุก 1 ชั่วโมง
--   0 */2 * * *    ทุก 2 ชั่วโมง
--   0 */6 * * *    ทุก 6 ชั่วโมง
--   0 1 * * *      ทุกวัน 08:00 น. (ไทย)   ← 1 UTC = 8 โมงไทย
--   0 13 * * *     ทุกวัน 20:00 น. (ไทย)
-- ============================================================

-- ======================================================================
-- FILE: supabase-clear-chat-customers.sql
-- ======================================================================

-- ============================================================
-- ล้างข้อมูลลูกค้าจากแชท "ทั้งหมด" ในตาราง chat_customers
-- ใช้เมื่อ: ต้องการเริ่มใหม่ทั้งหมด แล้วกดซิงก์ดึงข้อมูลเข้ามาใหม่
--
-- วิธีรัน: Supabase Dashboard > SQL Editor > วางแล้วกด Run
--
-- ⚠️ ลำดับที่ถูกต้อง (ให้ได้ข้อมูลใหม่ครบทุกฟิลด์):
--    1) รัน migration:  supabase-migration-chat-detail.sql  (เพิ่มคอลัมน์ email, transcript)
--    2) deploy ฟังก์ชัน: supabase functions deploy sync-conversations
--    3) รันสคริปต์นี้เพื่อล้างของเก่า
--    4) กด "ซิงก์เพจนี้" ในแอป เพื่อดึง + วิเคราะห์ใหม่
-- ============================================================

truncate table public.chat_customers;

-- ------------------------------------------------------------
-- ทางเลือก: ถ้า truncate ติดสิทธิ์/นโยบาย ให้ใช้ delete แทน
-- (where true = ลบทุกแถว)
-- ------------------------------------------------------------
-- delete from public.chat_customers where true;

-- ------------------------------------------------------------
-- ทางเลือก: ล้างเฉพาะบางเพจ (ใส่ page_id ที่ต้องการ)
-- ------------------------------------------------------------
-- delete from public.chat_customers where page_id = 'ใส่_PAGE_ID_ที่นี่';

-- ======================================================================
-- FILE: supabase-diagnose-db-load.sql
-- ======================================================================

-- ================================================================
-- วินิจฉัยภาระฐานข้อมูล (memory / slow queries) — รันใน Supabase SQL Editor
-- รันทีละบล็อก (ไฮไลต์แล้วกด Run) แล้วส่งผลลัพธ์ให้ผมดู จะได้ชี้จุดแก้ได้ตรง ไม่ต้องเดา
-- ต้องเปิด extension pg_stat_statements ก่อน (Supabase เปิดให้โดยดีฟอลต์)
-- ================================================================

-- (0) เปิด pg_stat_statements ถ้ายังไม่เปิด
create extension if not exists pg_stat_statements;

-- ----------------------------------------------------------------
-- (1) TOP 20 query ที่กินเวลารวมมากสุด = ตัวการหลักของ CPU/memory
--     ดู total_time_min (เวลารวมทั้งหมด), calls (ถูกเรียกกี่ครั้ง), mean_ms (เฉลี่ยต่อครั้ง)
-- ----------------------------------------------------------------
select
  round(total_exec_time::numeric / 1000 / 60, 2) as total_time_min,
  calls,
  round(mean_exec_time::numeric, 1)              as mean_ms,
  round(max_exec_time::numeric, 1)               as max_ms,
  rows,
  left(regexp_replace(query, '\s+', ' ', 'g'), 160) as query
from pg_stat_statements
order by total_exec_time desc
limit 20;

-- ----------------------------------------------------------------
-- (2) TOP 20 query ที่ "ช้าต่อครั้ง" มากสุด (mean สูง) — ตัวที่ควรใส่ index/แก้
-- ----------------------------------------------------------------
select
  round(mean_exec_time::numeric, 1)  as mean_ms,
  calls,
  round(total_exec_time::numeric / 1000 / 60, 2) as total_time_min,
  rows,
  left(regexp_replace(query, '\s+', ' ', 'g'), 160) as query
from pg_stat_statements
where calls > 5
order by mean_exec_time desc
limit 20;

-- ----------------------------------------------------------------
-- (3) TOP 20 query ที่ "ถูกเรียกบ่อยสุด" — ตัวที่ควรลดความถี่/ทำ cache
-- ----------------------------------------------------------------
select
  calls,
  round(total_exec_time::numeric / 1000 / 60, 2) as total_time_min,
  round(mean_exec_time::numeric, 1) as mean_ms,
  left(regexp_replace(query, '\s+', ' ', 'g'), 160) as query
from pg_stat_statements
order by calls desc
limit 20;

-- ----------------------------------------------------------------
-- (4) อัตราการ hit cache ของ Postgres — ถ้าต่ำกว่า ~0.99 = อ่านดิสก์เยอะ/RAM ไม่พอ
-- ----------------------------------------------------------------
select
  sum(heap_blks_hit)  as cache_hit,
  sum(heap_blks_read) as disk_read,
  round(sum(heap_blks_hit)::numeric / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 4) as hit_ratio
from pg_statio_user_tables;

-- ----------------------------------------------------------------
-- (5) ตารางใหญ่สุด + จำนวนแถว + ขนาด bloat (dead rows) — เผื่อ VACUUM ไม่ทัน
-- ----------------------------------------------------------------
select
  relname as table,
  n_live_tup as live_rows,
  n_dead_tup as dead_rows,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size,
  last_autovacuum
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc
limit 15;

-- ----------------------------------------------------------------
-- (6) index ที่ "ไม่เคยถูกใช้" (idx_scan = 0) — เปลืองพื้นที่/เขียนช้า ลบทิ้งได้
-- ----------------------------------------------------------------
select
  relname as table, indexrelname as index,
  idx_scan as times_used,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
from pg_stat_user_indexes
where idx_scan = 0
order by pg_relation_size(indexrelid) desc
limit 20;

-- ======================================================================
-- FILE: supabase-diagnose-leaderboard.sql
-- ======================================================================

-- ============================================================
-- ตรวจว่าทำไมกระดานแต้มมีข้อมูลแค่ ~3 วันล่าสุด
-- รันทีละบล็อกใน Supabase SQL Editor แล้วดูผล
-- ============================================================

-- 1) reply_stats ย้อนหลังแค่ไหน + มีกี่แถว
select min(msg_at) as เก่าสุด, max(msg_at) as ใหม่สุด, count(*) as จำนวนแถว
from public.reply_stats;

-- 2) จำนวนรอบต่อวัน (30 วันล่าสุด) — ดูว่ามีข้อมูลก่อน 3 วันไหม และมาจากไหน (app/page/unanswered)
select (msg_at at time zone 'Asia/Bangkok')::date as วันที่,
       source, count(*) as จำนวน
from public.reply_stats
where msg_at >= now() - interval '30 days'
group by 1, 2
order by 1 desc, 2;

-- 3) cron 'rebuild-reply-stats' ถูก schedule จริงไหม + รันล่าสุดเมื่อไหร่/สำเร็จไหม
--    ถ้าไม่เห็นแถว 'reply-stats-hourly' = ยังไม่ถูกตั้งใน pg_cron (ต้นเหตุ)
select * from public.app_list_cron();

-- 4) สถานะการลงทะเบียนงานในแอป (ควร enabled = true)
select key, jobname, function_name, cron_expr, enabled
from public.scheduled_jobs where key = 'replystats';

-- 5) transcript ในแชทย้อนหลังได้แค่ไหน (แหล่งดิบของแต้ม)
--    ดูข้อความ "เก่าสุด" ที่ยังเก็บอยู่จริงในแต่ละแชท แล้วเอาค่าที่เก่าสุดรวม
select min((m->>'at')::timestamptz) as ข้อความเก่าสุดที่ยังเก็บอยู่,
       count(*) as จำนวนแชทที่มี_transcript
from public.chat_customers c
cross join lateral jsonb_array_elements(coalesce(c.transcript, '[]'::jsonb)) as m
where (m->>'at') is not null;

-- 6) แชทที่ยัง active ก่อน 3 วัน มีกี่ราย (ถ้ามีเยอะ แปลว่าข้อมูลดิบมี แต่ยังไม่ถูกสรุปเข้า reply_stats)
select
  count(*) filter (where last_message_at < now() - interval '3 days')  as แชทเก่ากว่า3วัน,
  count(*) filter (where last_message_at < now() - interval '7 days')  as แชทเก่ากว่า7วัน,
  count(*) as แชททั้งหมด
from public.chat_customers;

-- ======================================================================
-- FILE: supabase-diagnose-push-cron.sql
-- ======================================================================

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

-- ======================================================================
-- FILE: supabase-diagnose-staff-realtime.sql
-- ======================================================================

-- ================================================================
-- ทำไมพนักงาน (analyze_only) ไม่เห็นเรียลไทม์ แต่ admin เห็น
-- รันทีละบล็อกใน Supabase SQL Editor แล้วส่งผลมาให้ดู
-- ================================================================

-- (1) migration ปรับ RLS ให้เร็ว ถูก apply แล้วไหม? — ต้องเจอฟังก์ชัน app_allowed_pages
select proname
from pg_proc
where proname in ('app_allowed_pages', 'app_has_page', 'app_is_admin');

-- (2) policy อ่าน chat_customers ตอนนี้เป็นเวอร์ชันไหน (ควรมี app_allowed_pages = เวอร์ชันเร็ว)
select polname, pg_get_expr(polqual, polrelid) as using_expr
from pg_policy
where polrelid = 'public.chat_customers'::regclass and polcmd = 'r';

-- (3) chat_customers อยู่ใน publication ของ Realtime ไหม (ถ้าไม่มี = ไม่มีใครได้เรียลไทม์)
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'chat_customers';

-- (4) สิทธิ์ของพนักงานตั้งถูกไหม — allowed_tabs ต้องมี inbox/chat, allowed_pages ต้องมี page_id ที่เขาต้องเห็น
--     (role admin จะไม่ต้องมี allowed_pages เพราะลัดผ่าน)
select email, role,
       allowed_tabs,
       jsonb_array_length(coalesce(allowed_pages,'[]'::jsonb)) as page_count,
       allowed_pages
from public.user_permissions
where role <> 'admin'
order by email;

-- (5) เทียบ: page_id ที่มีแชทจริง (พนักงานต้องมี id พวกนี้ใน allowed_pages ถึงจะเห็น+เรียลไทม์)
select page_id, page_name, count(*) as chats
from public.chat_customers
group by page_id, page_name
order by chats desc
limit 20;

-- ======================================================================
-- FILE: supabase-maintenance-memory.sql
-- ======================================================================

-- ================================================================
-- ลดภาระ memory/CPU ของ Postgres — รันใน Supabase SQL Editor (รันทีละบล็อก)
-- อ้างอิงจากผล pg_stat_statements จริง: ตัวกินหลักคือ (1) Realtime ถอดรหัส WAL 2.46 ล้านครั้ง
--   จากการที่ chat_customers ถูก "อัปเดตซ้ำ" บ่อยมาก และ (2) list query ช้าเพราะตารางบวม (bloat)
-- ================================================================

-- ----------------------------------------------------------------
-- (1) คลาย bloat ของ chat_customers (อัปเดตวันละหลายหมื่นแถว → dead rows เยอะ → scan ช้า 0.2–4 วิ)
--     VACUUM ธรรมดา = ปลอดภัย ไม่ล็อกตาราง
-- ----------------------------------------------------------------
vacuum (analyze) public.chat_customers;

-- ----------------------------------------------------------------
-- (2) ตั้ง autovacuum ให้ "ไล่เก็บถี่ขึ้น" เฉพาะตารางที่อัปเดตหนัก — กัน bloat กลับมา
--     ค่าเดิม (scale_factor 0.2 = รอ dead ถึง 20% ของตารางก่อน vacuum) ช้าไปสำหรับตารางนี้
-- ----------------------------------------------------------------
alter table public.chat_customers set (
  autovacuum_vacuum_scale_factor = 0.05,   -- vacuum เมื่อ dead ~5% (ถี่ขึ้น)
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_vacuum_cost_delay = 2,
  fillfactor = 90                            -- เผื่อที่ให้ HOT update (ลดการสร้างแถวใหม่/บวม index)
);
-- fillfactor มีผลกับข้อมูลใหม่ทันที; ของเดิมจะค่อย ๆ ปรับเมื่อ vacuum/อัปเดต
-- ถ้าอยากบีบของเดิมทันที (ล็อกตารางสั้น ๆ ช่วง traffic น้อย): vacuum full public.chat_customers;

-- ----------------------------------------------------------------
-- (3) index ช่วย list query ฝั่งแชท (ตัวกรอง source แบบ OR ที่ทำให้ scan ช้า)
--     ครอบ "แชท Messenger ปกติ" (ไม่ใช่คอมเมนต์/ไลน์) เรียงตามข้อความล่าสุด
-- ----------------------------------------------------------------
-- ใช้ CONCURRENTLY = ไม่ล็อกการเขียนตอนสร้าง (แชทไม่สะดุดแม้แวบเดียว) — ต้องรันบรรทัดนี้เดี่ยว ๆ ไม่อยู่ใน transaction
create index concurrently if not exists chat_customers_inbox_msg_idx
  on public.chat_customers (last_message_at desc)
  where (source is null or (source <> 'comment' and source <> 'line')) and id not like 'fbc_%';

-- หมายเหตุ: "ไม่" ลดความถี่ cron ดึงแชท และ "ไม่" ลด polling ฝั่งแอป
--   เพราะ priority อันดับ 1 คือแชทสด/แจ้งเตือนไว/เรียลไทม์ที่สุดเสมอ
--   การลด memory ในไฟล์นี้เป็นแบบ "ไม่แตะความไว" ทั้งหมด (ตัด write ขยะ + คลาย bloat + index)

-- ----------------------------------------------------------------
-- (4) ตรวจผลหลังทำ: ดู dead rows ลดลง + index ใหม่ถูกใช้
-- ----------------------------------------------------------------
select relname, n_live_tup as live, n_dead_tup as dead, last_autovacuum
from pg_stat_user_tables where relname = 'chat_customers';

-- ======================================================================
-- FILE: supabase-reset-chat-customers.sql
-- ======================================================================

-- ============================================================
-- รีเซ็ตสถานะลูกค้าจากแชท "ทั้งหมด" ในตาราง chat_customers
-- ใช้เมื่อ: ต้องการล้างสถานะเดิมที่ติดผิด (เช่น false converted จากบั๊กสกัดเลข)
--          แล้วให้การซิงก์รอบถัดไปคำนวณใหม่ด้วยตรรกะที่แก้บั๊กแล้ว
--
-- วิธีรัน: Supabase Dashboard > SQL Editor > วางแล้วกด Run
--          (ตารางเปิด RLS แต่ SQL Editor รันด้วยสิทธิ์เจ้าของโปรเจกต์ ผ่านได้เลย)
--
-- ⚠️ ลำดับที่ถูกต้อง:
--    1) deploy edge function ที่แก้แล้วก่อน:  supabase functions deploy sync-conversations
--    2) รันสคริปต์นี้เพื่อล้างของเก่า
--    3) กด "ซิงก์เพจนี้" ในแอป ให้ระบบดึง + ประเมินสถานะใหม่
--    (ถ้ารีเซ็ตก่อน deploy ฟังก์ชันเก่าจะดึงข้อมูลผิดกลับมาอีก)
-- ============================================================

update public.chat_customers
set
  stage         = 'new',   -- สถานะที่ใช้จริง
  stage_auto    = 'new',   -- สถานะที่ระบบคำนวณ
  stage_manual  = null,    -- ⚠️ ล้างสถานะที่ "แอดมินตั้งเอง" ด้วย — อยากเก็บไว้ให้ลบบรรทัดนี้ทิ้ง
  phone         = null,    -- ล้างข้อมูลที่เคยจับได้ (ของปลอมจะหายไป, ของจริงจะถูกสกัดใหม่ตอนซิงก์)
  trade_id      = null,
  username      = null,
  province      = null,
  ai_hash       = null,    -- ล้าง hash เดิม บังคับให้ AI/กฎประเมินใหม่รอบหน้า
  ai_reason     = null,
  classified_by = null,
  updated_at    = now();

-- ------------------------------------------------------------
-- ทางเลือก: ถ้าไม่อยากรีเซ็ตทั้งหมด แต่ล้างเฉพาะที่ "ติด converted ผิด"
-- (auto-converted แต่ไม่มีเบอร์/ไอดี/username จริง) ให้ใช้อันนี้แทนด้านบน:
-- ------------------------------------------------------------
-- update public.chat_customers
-- set stage = 'new', stage_auto = 'new', ai_hash = null, ai_reason = null,
--     classified_by = null, updated_at = now()
-- where stage_auto = 'converted'
--   and coalesce(phone,'')    = ''
--   and coalesce(trade_id,'') = ''
--   and coalesce(username,'') = ''
--   and stage_manual is null;

