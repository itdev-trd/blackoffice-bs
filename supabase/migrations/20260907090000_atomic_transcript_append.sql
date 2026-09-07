-- ต่อข้อความเข้า transcript แบบ atomic — แก้ปัญหาแอดมินส่งพร้อมกันแล้วข้อความหาย
--
-- อาการที่เจอ: แอดมินสองคนกดส่งพร้อมกัน ข้อความของคนหนึ่งหายจากห้อง แล้วโผล่กลับมา
-- ทีหลังโดยขึ้นว่า "ตอบจากเพจ" แทนชื่อคนตอบ
--
-- สาเหตุ: ทั้ง messenger-reply และ meta-webhook ทำ read-modify-write กับคอลัมน์ transcript
-- (อ่านอาร์เรย์ทั้งก้อน → ต่อรายการใหม่ในโค้ด → เขียนทับทั้งก้อน)
-- สองคำขอที่ทำพร้อมกันจึงอ่านสภาพเดียวกัน แล้วคนเขียนทีหลังทับรายการของคนแรกหายไป
-- (ยืนยันจากข้อมูลจริง: ข้อความ "Fhhh" ในห้อง Danaiwut Jantanee ไม่มีทั้ง by และ via
--  = ไม่ใช่รายการที่แอปเขียน แต่เป็น echo จาก Meta ที่มาแทนของที่หายไป)
-- ส่วนที่ขึ้นว่า "ตอบจากเพจ" เพราะ echo ของ Meta ไม่มีตัวตนแอดมินมาด้วย
--
-- วิธีแก้: ให้ฐานข้อมูลเป็นคนต่ออาร์เรย์ (transcript || p_items) ในคำสั่ง update เดียว
-- Postgres ล็อกแถวระหว่าง update อยู่แล้ว การต่อของสองคำขอจึงลงครบทั้งคู่
--
-- อีกจุดที่แก้พร้อมกัน: last_reply_by จะไม่ถูกลบทิ้งเมื่อผู้เรียกไม่รู้ว่าใครตอบ
-- (echo จาก Meta ส่ง p_reply_by ว่างมา เดิมเขียนทับชื่อคนตอบเป็นค่าว่าง)
create or replace function public.app_append_page_messages(
  p_id text,
  p_items jsonb,
  p_reply_text text default null,
  p_reply_by text default null,
  p_at timestamptz default now(),
  p_lang text default null
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  update public.chat_customers c
  set transcript = coalesce(c.transcript, '[]'::jsonb) || coalesce(p_items, '[]'::jsonb),
      awaiting_reply = false,
      unread = false,
      read_at = p_at,
      last_reply_text = coalesce(left(nullif(p_reply_text, ''), 300), c.last_reply_text),
      -- ผู้เรียกที่ไม่รู้ชื่อคนตอบ (echo) ต้องไม่ลบชื่อที่บันทึกไว้แล้ว
      last_reply_by = coalesce(nullif(p_reply_by, ''), c.last_reply_by),
      last_reply_at = p_at,
      last_message_at = greatest(coalesce(c.last_message_at, p_at), p_at),
      cust_lang = coalesce(nullif(p_lang, ''), c.cust_lang),
      updated_at = p_at
  where c.id = p_id
  returning jsonb_build_object(
    'ok', true,
    'len', jsonb_array_length(c.transcript),
    'last_reply_by', c.last_reply_by
  );
$$;

revoke all on function public.app_append_page_messages(text, jsonb, text, text, timestamptz, text) from public;
grant execute on function public.app_append_page_messages(text, jsonb, text, text, timestamptz, text) to authenticated, service_role;
