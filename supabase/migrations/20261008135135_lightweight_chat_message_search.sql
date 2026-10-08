-- ค้นหาข้อความเก่าแบบ LINE โดยแยกข้อความเป็นแถวสั้น ๆ สำหรับค้นหา
--
-- เวอร์ชันก่อนหน้าถูกถอดเพราะ trigger แตก 40 ข้อความทุกครั้งที่ transcript เปลี่ยน
-- เวอร์ชันนี้เขียนเฉพาะส่วนที่ append ใหม่ (หรือท้ายสุดไม่เกิน 5 ข้อความเมื่อมีการ rewrite)
-- จึงไม่ต้องสแกน/ทำ trigram ใหม่ทั้งบทสนทนาในทุกข้อความเข้า

create table if not exists public.chat_message_search (
  chat_id text not null references public.chat_customers(id) on delete cascade,
  message_key text not null,
  sent_at text,
  sender text,
  body text not null,
  primary key (chat_id, message_key)
);

create index if not exists chat_message_search_body_trgm
  on public.chat_message_search using gin (body extensions.gin_trgm_ops);
create index if not exists chat_message_search_chat_id
  on public.chat_message_search (chat_id);

alter table public.chat_message_search enable row level security;
revoke all on public.chat_message_search from anon;
grant select on public.chat_message_search to authenticated;

drop policy if exists "read chat message search" on public.chat_message_search;
create policy "read chat message search"
  on public.chat_message_search for select to authenticated
  using ((select public.app_is_admin()) or (select public.app_has_any_tab(array['inbox','chat','customerdb','feed','ad_chats'])));

create or replace function public.sync_chat_message_search()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_count integer := 0;
  new_count integer := 0;
  first_new integer := 1;
begin
  if jsonb_typeof(new.transcript) is distinct from 'array' then
    return null;
  end if;

  new_count := jsonb_array_length(new.transcript);
  if tg_op = 'UPDATE' and jsonb_typeof(old.transcript) = 'array' then
    old_count := jsonb_array_length(old.transcript);
    -- append ปกติ: แตะเฉพาะข้อความที่เพิ่มมา · rewrite/capped transcript: เช็กเพียง 5 ข้อความท้าย
    first_new := case when new_count > old_count then old_count + 1 else greatest(1, new_count - 4) end;
  end if;

  insert into public.chat_message_search (chat_id, message_key, sent_at, sender, body)
  select new.id,
         coalesce(nullif(m->>'mid', ''), (m->>'w') || '|' || coalesce(m->>'at', '') || '|' || md5(coalesce(m->>'t', ''))),
         m->>'at', m->>'w', m->>'t'
  from jsonb_array_elements(new.transcript) with ordinality as item(m, position)
  where position >= first_new
    and coalesce(m->>'t', '') <> ''
    and (m->>'t') !~ '^\[(รูปภาพ|สติกเกอร์|วิดีโอ|เสียง)\]$'
  on conflict (chat_id, message_key) do update
    set sent_at = excluded.sent_at, sender = excluded.sender, body = excluded.body
    where public.chat_message_search.body is distinct from excluded.body;

  return null;
end;
$$;

revoke all on function public.sync_chat_message_search() from public, anon, authenticated;

drop trigger if exists chat_message_search_insert on public.chat_customers;
create trigger chat_message_search_insert
  after insert on public.chat_customers
  for each row execute function public.sync_chat_message_search();

drop trigger if exists chat_message_search_update on public.chat_customers;
create trigger chat_message_search_update
  after update of transcript on public.chat_customers
  for each row when (old.transcript is distinct from new.transcript)
  execute function public.sync_chat_message_search();

-- เติมประวัติเดิมครั้งเดียวตอน deploy; หลังจากนี้ trigger จะเติมเฉพาะ delta
insert into public.chat_message_search (chat_id, message_key, sent_at, sender, body)
select c.id,
       coalesce(nullif(m->>'mid', ''), (m->>'w') || '|' || coalesce(m->>'at', '') || '|' || md5(coalesce(m->>'t', ''))),
       m->>'at', m->>'w', m->>'t'
from public.chat_customers c
cross join lateral jsonb_array_elements(case when jsonb_typeof(c.transcript) = 'array' then c.transcript else '[]'::jsonb end) m
where coalesce(m->>'t', '') <> ''
  and (m->>'t') !~ '^\[(รูปภาพ|สติกเกอร์|วิดีโอ|เสียง)\]$'
on conflict (chat_id, message_key) do nothing;

create or replace function public.search_chat_messages(p_q text, p_pages text[] default null, p_limit integer default 50)
returns table (
  id text, customer_name text, page_id text, page_name text, source text, profile_pic text,
  last_message_at timestamptz, match_count integer, match_text text, match_at text, match_who text
)
language sql stable security invoker
set search_path = ''
set statement_timeout = '5s'
as $$
  with hits as (
    select i.chat_id, i.body, i.sent_at, i.sender
    from public.chat_message_search i
    where length(btrim(coalesce(p_q, ''))) >= 2
      and i.body ilike ('%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%') escape '\'
  ), per_chat as (
    select chat_id, count(*)::integer as n,
           (array_agg(body order by sent_at desc nulls last))[1] as body,
           (array_agg(sent_at order by sent_at desc nulls last))[1] as sent_at,
           (array_agg(sender order by sent_at desc nulls last))[1] as sender
    from hits group by chat_id
  )
  select c.id, c.customer_name, c.page_id, c.page_name, c.source, c.profile_pic,
         c.last_message_at, h.n, h.body, h.sent_at, h.sender
  from per_chat h
  join public.chat_customers c on c.id = h.chat_id
  where p_pages is null or c.page_id = any(p_pages) or c.page_id like 'line:%'
  order by c.last_message_at desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

revoke all on function public.search_chat_messages(text, text[], integer) from public, anon;
grant execute on function public.search_chat_messages(text, text[], integer) to authenticated;
