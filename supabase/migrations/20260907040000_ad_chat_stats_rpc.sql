-- รวมยอด "แอดไหนได้ลูกค้า" ให้ฝั่งฐานข้อมูล
--
-- ทำเป็น RPC เพราะ PostgREST คืนได้สูงสุด 1,000 แถวต่อคำขอ ถ้าให้หน้าเว็บดึงแถวมานับเอง
-- ยอดจะเพี้ยนทันทีที่ข้อมูลเกินพัน (ตอนนี้คอมเมนต์ที่ map แอดได้มี ~1.5 พันแถว)
--
-- security invoker = ใช้สิทธิ์ของคนที่เรียก → RLS ของ chat_customers ยังคุมอยู่เหมือนเดิม
-- ห้องหนึ่งนับให้แอดตัวเดียว (DM ใช้ entry_ad_id ก่อน ไม่มีจึงใช้ comment_ad_ids ตัวแรก)
-- ไม่งั้นคอมเมนต์ที่ map ได้หลายแอดจะทำให้ยอดรวมเกินจริง
create or replace function public.app_ad_chat_stats(p_days integer default 30)
returns table (
  ad_id text,
  ad_name text,
  chats bigint,
  dm bigint,
  comments bigint,
  opened bigint,
  waiting bigint,
  last_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      case when c.entry_ad_id is not null then c.entry_ad_id
           else nullif(c.comment_ad_ids->>0, '') end as ad_id,
      case when c.entry_ad_id is not null then c.entry_ad_name
           else nullif(c.comment_ad_names->>0, '') end as ad_name,
      (c.entry_ad_id is not null) as is_dm,
      (c.stage = 'account_opened') as is_opened,
      (c.awaiting_reply is not false) as is_waiting,
      c.last_message_at
    from public.chat_customers c
    where c.blocked_at is null
      and (p_days is null or c.created_at >= now() - make_interval(days => p_days))
  )
  select
    b.ad_id,
    max(b.ad_name) as ad_name,
    count(*) as chats,
    count(*) filter (where b.is_dm) as dm,
    count(*) filter (where not b.is_dm) as comments,
    count(*) filter (where b.is_opened) as opened,
    count(*) filter (where b.is_waiting) as waiting,
    max(b.last_message_at) as last_at
  from base b
  where b.ad_id is not null
  group by b.ad_id
  order by count(*) desc, count(*) filter (where b.is_opened) desc;
$$;

revoke all on function public.app_ad_chat_stats(integer) from public;
grant execute on function public.app_ad_chat_stats(integer) to authenticated;

-- ยอดรวมของช่วงเวลา (ทั้งหมด / รู้ที่มา / เปิดบัญชี) — คำนวณคู่กันในคำขอเดียว
create or replace function public.app_ad_chat_totals(p_days integer default 30)
returns table (total bigint, with_ad bigint, opened bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) as total,
    count(*) filter (where c.entry_ad_id is not null or nullif(c.comment_ad_ids->>0, '') is not null) as with_ad,
    count(*) filter (where c.stage = 'account_opened') as opened
  from public.chat_customers c
  where c.blocked_at is null
    and (p_days is null or c.created_at >= now() - make_interval(days => p_days));
$$;

revoke all on function public.app_ad_chat_totals(integer) from public;
grant execute on function public.app_ad_chat_totals(integer) to authenticated;
