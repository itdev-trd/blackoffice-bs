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
