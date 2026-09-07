-- แยก "ลูกค้าเก่า / ลูกค้าใหม่" ในหน้า "แอดไหนได้ลูกค้า" + เปิดให้กดดูรายชื่อคนที่ทักมาได้
--
-- ปัญหาที่แก้: บางแอด (เช่น "โฆษณา ทุนเทรด 1") คนที่ทักเข้ามาคือลูกค้าที่คุยกับเพจอยู่แล้ว
-- แต่ระบบนับรวมเป็นผลงานของแอดนั้นเหมือนลูกค้าใหม่ ทำให้อ่านยอดผิดว่าแอดหาคนใหม่ได้เท่าไร
--
-- เกณฑ์ตัดสิน (เรียงตามลำดับ ข้อไหนเข้าก่อนใช้ข้อนั้น) — จงใจให้ "เวลา" เป็นตัวตัดสิน
-- ไม่ใช่เนื้อความ เพราะเวลาตรวจย้อนหลังได้และไม่ต้องเรียก AI:
--   1. แท็กที่แอดมินกดเอง (🔁 ลูกค้าเก่า / 🆕 ลูกค้าใหม่) — ชนะทุกข้อ คนที่คุยเองรู้ดีที่สุด
--   2. เปิดบัญชีไปก่อนจะกดแอดนี้ (account_opened_at < เวลากดแอด) = ลูกค้าเก่าแน่นอน
--   3. เคยคุยกับเพจมาก่อนกดแอดนานกว่า p_gap_minutes = ลูกค้าเก่า
--   4. นอกนั้น = ลูกค้าใหม่ (ทักครั้งแรกพร้อมกับการกดแอด)
--
-- ทำไมต้องมีช่วงผ่อนผัน (p_gap_minutes เริ่มต้น 30 นาที): event referral จาก Meta
-- มาช้ากว่าข้อความแรกได้จริง เคยวัดได้ถึง 19 นาที ถ้าไม่ผ่อนผันลูกค้าใหม่จะถูกนับเป็นเก่า
--
-- แถวที่มาจากคอมเมนต์ไม่มีเวลากดแอด (Meta ไม่ได้ส่งมา) จึงตอบว่า "ไม่ทราบ" (null)
-- ไม่เดาให้เป็นใหม่ เพราะยอดที่เดาแล้วดูเนียนอันตรายกว่ายอดที่บอกว่าไม่รู้

-- ฐานร่วมของทั้งสามฟังก์ชัน — จัดประเภทที่เดียว ไม่ให้ตัวเลขในตารางกับในรายชื่อไม่ตรงกัน
create or replace function public.app_ad_chat_rooms(
  p_days integer default 30,
  p_gap_minutes integer default 30
)
returns table (
  id text,
  ad_id text,
  ad_name text,
  is_dm boolean,
  customer_name text,
  page_name text,
  profile_pic text,
  source text,
  stage text,
  is_opened boolean,
  is_waiting boolean,
  is_returning boolean,
  why text,
  first_contact timestamptz,
  click_at timestamptz,
  msgs integer,
  user_msgs integer,
  trade_id text,
  username text,
  last_message_at timestamptz,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      c.id,
      case when c.entry_ad_id is not null then c.entry_ad_id
           else nullif(c.comment_ad_ids->>0, '') end as ad_id,
      case when c.entry_ad_id is not null then c.entry_ad_name
           else nullif(c.comment_ad_names->>0, '') end as ad_name,
      (c.entry_ad_id is not null) as is_dm,
      c.customer_name, c.page_name, c.profile_pic, c.source, c.stage,
      (c.stage = 'account_opened') as is_opened,
      (c.awaiting_reply is not false) as is_waiting,
      c.tags,
      c.account_opened_at,
      c.message_count as msgs,
      c.user_message_count as user_msgs,
      c.trade_id, c.username,
      c.last_message_at,
      c.created_at,
      -- "เคยคุยกันครั้งแรกเมื่อไร" — เอาเวลาที่เก่าสุดที่เรารู้ ทั้งจากคอลัมน์และจากบทสนทนา
      -- (created_at ก็นับ เพราะห้องถูกสร้างตอนที่ระบบเห็นบทสนทนานี้ครั้งแรก)
      least(
        coalesce(c.first_customer_message_at, c.created_at),
        c.created_at,
        coalesce((select min((m->>'at')::timestamptz)
                  from jsonb_array_elements(coalesce(c.transcript, '[]'::jsonb)) m
                  where m->>'w' = 'u'), c.created_at)
      ) as first_contact,
      -- เวลากดแอด = referral ครั้งแรกของแอดที่ห้องนี้ถูกนับให้
      (select min(r.received_at) from public.chat_referrals r
        where r.page_id = c.page_id and r.psid = c.psid and r.ad_id = c.entry_ad_id) as click_at
    from public.chat_customers c
    where c.blocked_at is null
      and (p_days is null or c.created_at >= now() - make_interval(days => p_days))
  ),
  judged as (
    select b.*,
      case
        when b.tags @> array['🔁 ลูกค้าเก่า'] then true
        when b.tags @> array['🆕 ลูกค้าใหม่'] then false
        when b.click_at is not null and b.account_opened_at is not null
             and b.account_opened_at < b.click_at then true
        when b.click_at is not null
             and b.first_contact < b.click_at - make_interval(mins => coalesce(p_gap_minutes, 30)) then true
        when b.click_at is not null then false
        when b.account_opened_at is not null then true
        else null
      end as is_returning
    from base b
  )
  select
    j.id, j.ad_id, j.ad_name, j.is_dm, j.customer_name, j.page_name, j.profile_pic, j.source, j.stage,
    j.is_opened, j.is_waiting, j.is_returning,
    case
      when j.tags @> array['🔁 ลูกค้าเก่า'] or j.tags @> array['🆕 ลูกค้าใหม่'] then 'แอดมินระบุเองด้วยแท็กในห้องแชท'
      when j.is_returning and j.click_at is not null and j.account_opened_at is not null
           and j.account_opened_at < j.click_at then 'เปิดบัญชีไปก่อนจะกดแอดนี้'
      when j.is_returning and j.click_at is not null then
        'เคยคุยกับเพจก่อนกดแอด ' ||
        case when extract(epoch from (j.click_at - j.first_contact)) >= 86400
             then round(extract(epoch from (j.click_at - j.first_contact)) / 86400) || ' วัน'
             when extract(epoch from (j.click_at - j.first_contact)) >= 3600
             then round(extract(epoch from (j.click_at - j.first_contact)) / 3600) || ' ชม.'
             else round(extract(epoch from (j.click_at - j.first_contact)) / 60) || ' นาที' end
      when j.is_returning then 'เปิดบัญชีไปแล้ว แต่ไม่รู้เวลากดแอด'
      when j.is_returning is false then 'ทักครั้งแรกพร้อมกับการกดแอดนี้'
      else 'มาจากคอมเมนต์ — Meta ไม่ส่งเวลากดแอดมา จึงบอกไม่ได้'
    end as why,
    j.first_contact, j.click_at, j.msgs, j.user_msgs, j.trade_id, j.username,
    j.last_message_at, j.created_at
  from judged j
  where j.ad_id is not null;
$$;

revoke all on function public.app_ad_chat_rooms(integer, integer) from public;
grant execute on function public.app_ad_chat_rooms(integer, integer) to authenticated;

-- ตารางรวมยอดต่อแอด — เพิ่มคอลัมน์ เก่า/ใหม่/ไม่ทราบ และแยกยอดเปิดบัญชีของลูกค้าใหม่
drop function if exists public.app_ad_chat_stats(integer);
create or replace function public.app_ad_chat_stats(
  p_days integer default 30,
  p_gap_minutes integer default 30
)
returns table (
  ad_id text,
  ad_name text,
  chats bigint,
  dm bigint,
  comments bigint,
  new_cust bigint,
  old_cust bigint,
  unknown_cust bigint,
  opened bigint,
  opened_new bigint,
  waiting bigint,
  last_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    r.ad_id,
    max(r.ad_name) as ad_name,
    count(*) as chats,
    count(*) filter (where r.is_dm) as dm,
    count(*) filter (where not r.is_dm) as comments,
    count(*) filter (where r.is_returning is false) as new_cust,
    count(*) filter (where r.is_returning) as old_cust,
    count(*) filter (where r.is_returning is null) as unknown_cust,
    count(*) filter (where r.is_opened) as opened,
    count(*) filter (where r.is_opened and r.is_returning is false) as opened_new,
    count(*) filter (where r.is_waiting) as waiting,
    max(r.last_message_at) as last_at
  from public.app_ad_chat_rooms(p_days, p_gap_minutes) r
  group by r.ad_id
  order by count(*) desc, count(*) filter (where r.is_opened) desc;
$$;

revoke all on function public.app_ad_chat_stats(integer, integer) from public;
grant execute on function public.app_ad_chat_stats(integer, integer) to authenticated;

-- ยอดรวมของช่วงเวลา — เพิ่ม เก่า/ใหม่ ของฝั่งที่รู้ที่มาจากแอด
drop function if exists public.app_ad_chat_totals(integer);
create or replace function public.app_ad_chat_totals(
  p_days integer default 30,
  p_gap_minutes integer default 30
)
returns table (
  total bigint,
  with_ad bigint,
  opened bigint,
  ad_new bigint,
  ad_old bigint,
  ad_unknown bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  -- เรียก app_ad_chat_rooms ครั้งเดียวแล้วนับจากผลชุดเดียวกัน (มันสแกนบทสนทนาทุกห้อง เรียกซ้ำ = ช้าฟรี)
  with rooms as (
    select r.is_returning from public.app_ad_chat_rooms(p_days, p_gap_minutes) r
  ),
  everyone as (
    select
      count(*) as total,
      count(*) filter (where c.stage = 'account_opened') as opened
    from public.chat_customers c
    where c.blocked_at is null
      and (p_days is null or c.created_at >= now() - make_interval(days => p_days))
  )
  select
    e.total,
    (select count(*) from rooms) as with_ad,
    e.opened,
    (select count(*) from rooms where is_returning is false) as ad_new,
    (select count(*) from rooms where is_returning) as ad_old,
    (select count(*) from rooms where is_returning is null) as ad_unknown
  from everyone e;
$$;

revoke all on function public.app_ad_chat_totals(integer, integer) from public;
grant execute on function public.app_ad_chat_totals(integer, integer) to authenticated;

-- รายชื่อคนที่ทักมาจากแอดหนึ่ง ๆ (กดที่แถวในตารางแล้วเปิดดู)
create or replace function public.app_ad_chat_people(
  p_ad_id text,
  p_days integer default 30,
  p_gap_minutes integer default 30
)
returns table (
  id text,
  customer_name text,
  page_name text,
  profile_pic text,
  source text,
  is_dm boolean,
  stage text,
  is_opened boolean,
  is_waiting boolean,
  is_returning boolean,
  why text,
  first_contact timestamptz,
  click_at timestamptz,
  msgs integer,
  user_msgs integer,
  trade_id text,
  username text,
  last_message_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    r.id, r.customer_name, r.page_name, r.profile_pic, r.source, r.is_dm, r.stage,
    r.is_opened, r.is_waiting, r.is_returning, r.why,
    r.first_contact, r.click_at, r.msgs, r.user_msgs, r.trade_id, r.username, r.last_message_at
  from public.app_ad_chat_rooms(p_days, p_gap_minutes) r
  where r.ad_id = p_ad_id
  order by r.last_message_at desc nulls last;
$$;

revoke all on function public.app_ad_chat_people(text, integer, integer) from public;
grant execute on function public.app_ad_chat_people(text, integer, integer) to authenticated;
