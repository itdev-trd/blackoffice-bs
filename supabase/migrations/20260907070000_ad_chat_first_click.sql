-- เก็บ "เวลากดแอดครั้งแรก" ไว้ให้ได้ — ตัวตัดสินลูกค้าเก่า/ใหม่ต้องใช้ค่านี้
--
-- ปัญหา: chat_referrals ถูก upsert ด้วยคีย์ (page_id, psid, ad_id) และเขียน received_at ทับทุกครั้ง
-- ลูกค้าที่กดแอดเดิมซ้ำอีกรอบ จะทำให้เวลากดแอด "ขยับไปข้างหน้า" เรื่อย ๆ
-- แล้วลูกค้าใหม่คนนั้นจะถูกจัดเป็น "ลูกค้าเก่า" เพราะดูเหมือนคุยกับเพจก่อนกดแอดหลายชั่วโมง
-- (เจอกับ Nitima Phuangthong: กดแอด 00:46 พร้อมทักครั้งแรก แล้วกดซ้ำ 03:17 → กลายเป็นเก่า)
--
-- แก้ที่ต้นเหตุ: เพิ่มคอลัมน์เวลาครั้งแรกกับตัวนับจำนวนครั้ง แล้วให้ trigger ปกป้องไว้
-- ทำเป็น trigger ไม่ใช่แก้ในฟังก์ชัน edge เพราะ PostgREST upsert เขียนทับทุกคอลัมน์ที่ส่งมา
-- และจะได้คุ้มครองไม่ว่าใครเขียนเข้ามาทางไหน
alter table public.chat_referrals
  add column if not exists first_received_at timestamptz,
  add column if not exists click_count integer not null default 1;

update public.chat_referrals set first_received_at = received_at where first_received_at is null;

create or replace function public.chat_referrals_keep_first_click()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.first_received_at := coalesce(new.first_received_at, new.received_at, now());
    new.click_count := coalesce(new.click_count, 1);
  else
    -- ห้ามให้การกดซ้ำเขียนทับเวลาครั้งแรก — แต่ถ้ามีคน "ส่งค่าใหม่มาตรง ๆ" ให้เคารพค่านั้น
    -- (upsert จาก webhook ไม่ได้ส่งคอลัมน์นี้มา ค่าที่เข้ามาจึงเท่ากับค่าเดิมเสมอ → เข้าทาง else)
    -- ถ้าล็อกตายจะซ่อมข้อมูลที่เพี้ยนไปแล้วไม่ได้เลย
    new.first_received_at := case
      when new.first_received_at is not null
           and new.first_received_at is distinct from old.first_received_at then new.first_received_at
      else coalesce(old.first_received_at, old.received_at, new.received_at)
    end;
    -- นับเพิ่มเฉพาะตอนที่เวลาขยับจริง (= กดแอดใหม่) ไม่ใช่ตอนแก้ ads_context เฉย ๆ
    new.click_count := case
      when new.click_count is distinct from old.click_count then new.click_count
      else coalesce(old.click_count, 1)
        + case when new.received_at > coalesce(old.received_at, new.received_at) then 1 else 0 end
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists chat_referrals_keep_first_click on public.chat_referrals;
create trigger chat_referrals_keep_first_click
  before insert or update on public.chat_referrals
  for each row execute function public.chat_referrals_keep_first_click();

-- ให้ตัวจัดประเภทใช้เวลากดแอด "ครั้งแรก" และบอกจำนวนครั้งที่กดด้วย
-- (ต้อง drop ก่อน เพราะเพิ่มคอลัมน์ clicks ในผลลัพธ์ = เปลี่ยน return type)
drop function if exists public.app_ad_chat_rooms(integer, integer);
create function public.app_ad_chat_rooms(
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
  clicks integer,
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
      -- เวลากดแอด = การกดครั้งแรกของแอดที่ห้องนี้ถูกนับให้ (ห้ามใช้ received_at เพราะการกดซ้ำเขียนทับ)
      (select min(coalesce(r.first_received_at, r.received_at)) from public.chat_referrals r
        where r.page_id = c.page_id and r.psid = c.psid and r.ad_id = c.entry_ad_id) as click_at,
      (select max(r.click_count) from public.chat_referrals r
        where r.page_id = c.page_id and r.psid = c.psid and r.ad_id = c.entry_ad_id) as clicks
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
    j.first_contact, j.click_at, coalesce(j.clicks, 1) as clicks, j.msgs, j.user_msgs, j.trade_id, j.username,
    j.last_message_at, j.created_at
  from judged j
  where j.ad_id is not null;
$$;

revoke all on function public.app_ad_chat_rooms(integer, integer) from public;
grant execute on function public.app_ad_chat_rooms(integer, integer) to authenticated;

-- รายชื่อคนที่ทักมาจากแอดหนึ่ง ๆ — เพิ่มจำนวนครั้งที่กดแอด
drop function if exists public.app_ad_chat_people(text, integer, integer);
create function public.app_ad_chat_people(
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
  clicks integer,
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
    r.first_contact, r.click_at, r.clicks, r.msgs, r.user_msgs, r.trade_id, r.username, r.last_message_at
  from public.app_ad_chat_rooms(p_days, p_gap_minutes) r
  where r.ad_id = p_ad_id
  order by r.last_message_at desc nulls last;
$$;

revoke all on function public.app_ad_chat_people(text, integer, integer) from public;
grant execute on function public.app_ad_chat_people(text, integer, integer) to authenticated;
