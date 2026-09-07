-- ซ่อม reply_stats ให้ rebuild-reply-stats บันทึกได้จริง
--
-- อาการ: เรียกฟังก์ชันแล้วได้
--   "บันทึก reply_stats ไม่สำเร็จ: there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- (ไม่ใช่บั๊กที่เพิ่งเกิด — เจอตอนไล่ยิงทดสอบ edge function ทุกตัวหลัง redeploy)
--
-- สาเหตุ: ตารางในโปรเจกต์นี้เพี้ยนไปจากที่ supabase/legacy/01-consolidated-legacy.sql กำหนดไว้ 2 จุด
--   1) unique index ของ round_key ในฐานข้อมูลจริงเป็น partial index (... where round_key is not null)
--      Postgres ไม่ใช้ partial index มาอนุมาน ON CONFLICT (round_key) นอกจากคำสั่ง insert
--      จะเขียน where เดิมซ้ำมาด้วย ซึ่ง upsert ของ PostgREST/supabase-js เขียนไม่ได้ → พังทุกครั้ง
--   2) replied_at ยังเป็น not null ทั้งที่ฟังก์ชันต้องบันทึกรอบที่ "ยังไม่มีใครตอบ" (replied_at = null)
--      ถ้าแก้แต่ index จะไปพังต่อที่ not-null violation ทันที
--
-- เลือกแก้ที่ฐานข้อมูล ไม่ใช่เลี่ยง ON CONFLICT ในฟังก์ชัน เพราะ unique index ปกติคือตัวกัน
-- "1 รอบการรอ = 1 แถว" ตัวจริง ถ้าเปลี่ยนไปใช้ delete-then-insert จะยังเปิดช่องให้แถวซ้ำ
-- เวลามีสองคำขอทำงานพร้อมกัน และเสียการอัปเดตทับแบบ atomic ไปเปล่า ๆ
-- (unique index ปกติยอมให้ค่า null ซ้ำกันได้อยู่แล้ว แถวที่ไม่มี round_key จึงไม่ต้องกลัว)

alter table public.reply_stats alter column replied_at drop not null;

-- เติมคีย์ให้แถวเดิมที่ messenger-reply บันทึกไว้ตอนกดส่งในแอป (โปรเจกต์นี้ round_key ว่างทั้งตาราง)
-- ต้องเติมด้วยสูตรเดียวกับที่ rebuild-reply-stats คิด (conversation_id|epoch_ms ของข้อความที่เริ่มรอบ)
-- ไม่งั้น job จะสรุปรอบเดิมออกมาเป็นแถวใหม่ แล้วรีพอร์ตนับซ้ำ — และแถวคีย์ว่างจะค้างตลอด
-- เพราะตัวลบ "ซากรอบเก่า" ในฟังก์ชันข้ามแถวที่ไม่มี round_key
update public.reply_stats
set round_key = conversation_id || '|' || (extract(epoch from msg_at) * 1000)::bigint::text,
    source = coalesce(source, 'app'),
    replied_by = coalesce(replied_by, email)
where round_key is null and conversation_id is not null and msg_at is not null;

-- กันเหนียว: ถ้าการเติมคีย์ทำให้เกิดคีย์ซ้ำ (แถวเดิมบันทึกรอบเดียวกันไว้สองครั้ง)
-- ให้เหลือแถวใหม่สุดของคีย์นั้นไว้แถวเดียว ไม่งั้น create unique index จะล้มทั้ง migration
delete from public.reply_stats r
where r.round_key is not null
  and exists (
    select 1 from public.reply_stats k
    where k.round_key = r.round_key
      and (k.created_at, k.id) > (r.created_at, r.id)
  );

drop index if exists public.reply_stats_round_key_uidx;
create unique index if not exists reply_stats_round_uk on public.reply_stats (round_key);

-- index ที่ legacy กำหนดไว้แต่โปรเจกต์นี้ไม่มี — หน้ารีพอร์ตกรองด้วย (page_id, msg_at) เสมอ
create index if not exists reply_stats_page_day_idx on public.reply_stats (page_id, msg_at desc);

comment on column public.reply_stats.round_key is 'conversation_id|epoch_ms ของข้อความลูกค้าที่เริ่มรอ — กันบันทึกซ้ำเมื่อรัน job สรุปหลายรอบ';
comment on column public.reply_stats.source is 'app = ตอบผ่านเว็บแอป, page = ตอบจากกล่องข้อความเพจ, unanswered = ยังไม่มีใครตอบ, missed = ทักซ้ำหลังเงียบนาน, closed = ลูกค้าปิดบทสนทนาเอง';
