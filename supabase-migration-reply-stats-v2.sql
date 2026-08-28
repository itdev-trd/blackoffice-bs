-- สถิติการตอบแชท v2 — คำนวณจาก "บทสนทนาจริง" แทนการบันทึกเฉพาะตอนกดส่งในแอป
-- ปัญหาเดิม: บันทึกเฉพาะตอนแอดมินกดส่งผ่านเว็บแอป ถ้าพนักงานตอบจากกล่องข้อความเพจโดยตรง สถิติจะไม่ขึ้นเลย
-- แก้: มี job ไล่อ่าน transcript ใน chat_customers (ซึ่งมีทั้งข้อความลูกค้าและข้อความที่ตอบจากเพจผ่าน webhook echo)
--      แล้วสรุปเป็น "รอบการรอ" (ลูกค้าทัก → แอดมินตอบครั้งแรก) เก็บลงตารางนี้

-- 1) รอบที่ยัง "ไม่มีใครตอบ" ต้องเก็บได้ด้วย (ใช้นับจำนวนการแจ้งเตือนที่ค้าง)
alter table public.reply_stats alter column replied_at drop not null;

-- 2) คีย์กันซ้ำ — รันสรุปกี่รอบก็ไม่เกิดแถวซ้ำ (1 รอบการรอ = 1 แถว)
alter table public.reply_stats add column if not exists round_key text;
alter table public.reply_stats add column if not exists source text;        -- app | page | unanswered
alter table public.reply_stats add column if not exists replied_by text;    -- อีเมลคนตอบ (ถ้าตอบผ่านแอป) — ตอบจากเพจจะว่าง

-- เติมคีย์ให้แถวเดิมที่บันทึกไว้ตอนกดส่งในแอป (กันซ้ำกับรอบที่ job จะสรุปมาทีหลัง)
update public.reply_stats
set round_key = conversation_id || '|' || (extract(epoch from msg_at) * 1000)::bigint::text,
    source = coalesce(source, 'app'),
    replied_by = coalesce(replied_by, email)
where round_key is null and conversation_id is not null and msg_at is not null;

-- unique index ต้อง "ไม่มีเงื่อนไข where" — ไม่งั้น upsert (ON CONFLICT (round_key)) ใช้ไม่ได้
-- Postgres จะบอกว่า "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- (ค่า null ซ้ำกันได้อยู่แล้วใน unique index ปกติ แถวเก่าที่ยังไม่มี round_key จึงไม่มีปัญหา)
drop index if exists reply_stats_round_uk;
create unique index if not exists reply_stats_round_uk on public.reply_stats (round_key);
create index if not exists reply_stats_page_day_idx on public.reply_stats (page_id, msg_at desc);

comment on column public.reply_stats.round_key is 'conversation_id|epoch_ms ของข้อความลูกค้าที่เริ่มรอ — กันบันทึกซ้ำเมื่อรัน job สรุปหลายรอบ';
comment on column public.reply_stats.source is 'app = ตอบผ่านเว็บแอป, page = ตอบจากกล่องข้อความเพจ, unanswered = ยังไม่มีใครตอบ';

-- ลงทะเบียนงานอัตโนมัติ: สรุปสถิติจากบทสนทนาทุกชั่วโมง (ไม่เรียก Meta/AI จึงเบามาก)
-- เปิด/ปิดและปรับเวลาได้ที่ ตั้งค่า → งานอัตโนมัติ (ตั้งเวลา)
insert into public.scheduled_jobs (key, jobname, label, description, function_name, cron_expr, enabled)
values ('replystats', 'reply-stats-hourly', 'สรุปสถิติการตอบแชท',
        'อ่านบทสนทนาจริงแล้วสรุปเวลาตอบรายเพจ/รายวัน — ครอบคลุมทั้งที่ตอบผ่านแอปและที่ตอบจากกล่องข้อความเพจ',
        'rebuild-reply-stats', '5 * * * *', true)
on conflict (key) do nothing;
