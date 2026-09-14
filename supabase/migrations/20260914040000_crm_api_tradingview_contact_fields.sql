-- เพิ่ม phone/country/telegram/แหล่งที่มา (member_type) ให้ CRM API /tradingview
-- คอลัมน์เหล่านี้เพิ่งเพิ่มใน tv_access (migration tv_indicator_members) แต่ยังไม่เคยปล่อยออก API
-- ต้อง drop ก่อน create เพราะเปลี่ยน RETURNS TABLE (เพิ่มคอลัมน์) ไม่ใช่แค่เปลี่ยน body

drop function if exists public.crm_tradingview_page(timestamptz, timestamptz, bigint, int, text, text, text, bigint, text, bigint);

create or replace function public.crm_tradingview_page(
  p_since timestamptz default null,
  p_after_at timestamptz default null,
  p_after_id bigint default null,
  p_limit int default 200,
  p_username text default null,
  p_trade_id text default null,
  p_pine_id text default null,
  p_brand_id bigint default null,
  p_status text default null,
  p_id bigint default null
)
returns table (
  id bigint,
  username text,
  display_name text,
  email text,
  phone text,
  country text,
  telegram text,
  trade_id text,
  pine_id text,
  indicator_name text,
  script_key text,
  brand_id bigint,
  brand_name text,
  lot text,
  status text,
  membership_type text,
  member_type text,
  channel text,
  contact_channel text,
  granted_at timestamptz,
  last_granted_at timestamptz,
  tv_granted_at timestamptz,
  expiration timestamptz,
  tv_expiration timestamptz,
  tv_access_verified boolean,
  tv_verified_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    a.id, a.username, a.display_name, a.email, a.phone, a.country, a.telegram, a.trade_id, a.pine_id,
    s.name, s.script_key, a.brand_id, b.name,
    a.lot, a.status, a.membership_type, a.member_type, a.channel, a.contact_channel,
    a.granted_at, a.last_granted_at, a.tv_granted_at,
    a.expiration, a.tv_expiration, a.tv_access_verified, a.tv_verified_at,
    a.created_at, a.updated_at
  from public.tv_access a
  left join public.tv_scripts s on s.pine_id = a.pine_id
  left join public.tv_brands b on b.id = a.brand_id
  where
    case
      when p_id is not null then a.id = p_id
      else
        (p_since is null or a.updated_at >= p_since)
        and (p_after_at is null or (a.updated_at, a.id) > (p_after_at, p_after_id))
        and (p_username is null or lower(a.username) = lower(p_username))
        and (p_trade_id is null or a.trade_id = p_trade_id)
        and (p_pine_id is null or a.pine_id = p_pine_id)
        and (p_brand_id is null or a.brand_id = p_brand_id)
        and (p_status is null or a.status = p_status)
    end
  order by a.updated_at asc, a.id asc
  limit case when p_id is not null then 1 else greatest(1, least(coalesce(p_limit, 200), 1000)) + 1 end;
$$;

revoke all on function public.crm_tradingview_page(timestamptz, timestamptz, bigint, int, text, text, text, bigint, text, bigint) from public;
grant execute on function public.crm_tradingview_page(timestamptz, timestamptz, bigint, int, text, text, text, bigint, text, bigint) to service_role;
