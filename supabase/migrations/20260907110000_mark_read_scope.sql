-- ทำเครื่องหมาย "อ่านแล้ว" ทั้งขอบเขต ไม่ใช่แค่ห้องที่โหลดมาแล้ว
--
-- รอบก่อนผมทำปุ่มที่เคลียร์เฉพาะห้องใน list ที่หน้าเว็บโหลดไว้ ซึ่ง query จำกัด 200 ห้อง
-- ระบบมีลูกค้า 1,400+ คน ค้างอ่าน 145 ห้อง → กดแล้วจุดแดงบนแท็บไม่หาย เพราะตัวนับจุดแดง
-- นับจากฐานข้อมูลทั้งหมด ไม่ได้นับจาก list ที่โหลด (จึงดูเหมือนปุ่มใช้ไม่ได้)
--
-- ฟังก์ชันนี้อัปเดตทุกห้องที่เข้าเงื่อนไขจริงในฐานข้อมูล โดยขอบเขตต้องตรงกับตัวนับจุดแดง
-- security invoker = ยังอยู่ใต้ RLS/สิทธิ์คอลัมน์ของคนที่กดเหมือนการอัปเดตปกติ
create or replace function public.app_mark_read_scope(
  p_scope text default 'all',        -- all | messenger | line | instagram | comments
  p_page_ids text[] default null     -- null = ไม่จำกัดเพจ
)
returns integer
language sql
volatile
security invoker
set search_path = public
as $$
  with upd as (
    update public.chat_customers c
    set unread = false,
        read_at = now(),
        updated_at = now()
    where c.unread = true
      and c.blocked_at is null
      -- ห้อง LINE ไม่ได้ผูกกับเพจ Facebook จึงไม่ใช้ตัวกรองเพจกับมัน
      -- (ให้ตรงกับตัวนับจุดแดงของ LINE ที่ไม่กรองเพจเหมือนกัน ไม่งั้นกดแล้วอัปเดต 0 ห้อง)
      and (p_page_ids is null or cardinality(p_page_ids) = 0
           or c.source = 'line' or c.page_id = any(p_page_ids))
      and case p_scope
        when 'messenger' then c.id not like 'fbc_%'
          and (c.source is null or c.source not in ('comment', 'line', 'instagram'))
        when 'line' then c.source = 'line'
        when 'instagram' then c.source = 'instagram'
        when 'comments' then (c.source = 'comment' or c.id like 'fbc_%')
        else true
      end
    returning 1
  )
  select coalesce(count(*), 0)::int from upd;
$$;

revoke all on function public.app_mark_read_scope(text, text[]) from public;
grant execute on function public.app_mark_read_scope(text, text[]) to authenticated;
