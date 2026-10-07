-- ดัชนีค้นหาข้อความแชท: 1 แถวต่อ 1 ข้อความ (แทนการไล่ transcript ทั้งก้อน)
--
-- ทำไม: ค้นใน chat_customers.transcript ต้องแตก jsonb ของทุกห้อง (~2.4 ms/ห้อง) → ผ่าน API 13 วิจน timeout
-- ส่วน index trigram บน transcript::text ทำให้ทุกการอัปเดตแชทคำนวณใหม่ทั้งห้อง เว็บช้าทั้งระบบ (ถอดไปแล้ว)
-- ตารางนี้เขียนเฉพาะข้อความใหม่ (สั้น) ตอน transcript เปลี่ยน → ค่าเขียนเล็ก ค้นเร็ว
-- และเก็บข้อความที่หลุดจาก transcript (เพดาน 1000 ข้อความ/ห้อง) ไว้ให้ค้นได้ต่อ

create table if not exists public.chat_message_index (
  chat_id text not null references public.chat_customers(id) on delete cascade,
  k text not null,             -- mid ของข้อความ (หรือ w|at ถ้าไม่มี) กันซ้ำ
  at text,                     -- เวลาตามที่อยู่ใน transcript (ใช้เลื่อนไปไฮไลต์ data-msg-at ตรงตัว)
  w text,                      -- u = ลูกค้า · p = เพจ/แอดมิน
  t text not null,
  primary key (chat_id, k)
);
-- index trigram บนข้อความเดี่ยว (สั้น) — ข้อความใหม่หนึ่งข้อความ = คำนวณแค่ข้อความนั้น ไม่ใช่ทั้งห้อง
create index if not exists chat_message_index_t_trgm on public.chat_message_index using gin (t extensions.gin_trgm_ops);
create index if not exists chat_message_index_chat on public.chat_message_index (chat_id);
alter table public.chat_message_index enable row level security;
drop policy if exists "read chat_message_index" on public.chat_message_index;
create policy "read chat_message_index" on public.chat_message_index for select
  using ((select app_is_admin()) or (select app_has_any_tab(array['inbox','chat','customerdb','feed','ad_chats'])));

-- เติมจากข้อความท้าย transcript 40 ตัว (ข้อความใหม่ต่อท้ายเสมอ) — ไม่ต้องอ่าน OLD มาเทียบ
create or replace function public.chat_message_index_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if jsonb_typeof(new.transcript) is distinct from 'array' then return null; end if;
  n := jsonb_array_length(new.transcript);
  insert into public.chat_message_index (chat_id, k, at, w, t)
  select new.id, coalesce(nullif(m->>'mid', ''), (m->>'w') || '|' || coalesce(m->>'at', '')), m->>'at', m->>'w', m->>'t'
  from jsonb_array_elements(new.transcript) with ordinality as e(m, i)
  where i > n - 40
    and coalesce(m->>'t', '') <> ''
    and (m->>'t') !~ '^\[(รูปภาพ|สติกเกอร์|วิดีโอ|เสียง)\]$'
  on conflict (chat_id, k) do nothing;
  return null;
end $$;

drop trigger if exists chat_message_index_ins on public.chat_customers;
create trigger chat_message_index_ins after insert on public.chat_customers
  for each row execute function public.chat_message_index_sync();
drop trigger if exists chat_message_index_upd on public.chat_customers;
create trigger chat_message_index_upd after update of transcript on public.chat_customers
  for each row when (old.transcript is distinct from new.transcript)
  execute function public.chat_message_index_sync();

-- เติมของเดิมทั้งหมดครั้งเดียว
insert into public.chat_message_index (chat_id, k, at, w, t)
select c.id, coalesce(nullif(m->>'mid', ''), (m->>'w') || '|' || coalesce(m->>'at', '')), m->>'at', m->>'w', m->>'t'
from public.chat_customers c
cross join lateral jsonb_array_elements(case when jsonb_typeof(c.transcript) = 'array' then c.transcript else '[]'::jsonb end) m
where coalesce(m->>'t', '') <> '' and (m->>'t') !~ '^\[(รูปภาพ|สติกเกอร์|วิดีโอ|เสียง)\]$'
on conflict (chat_id, k) do nothing;

-- ค้นจากตารางนี้แทน transcript · security invoker = RLS ของผู้เรียก
create or replace function public.search_chat_messages(p_q text, p_pages text[] default null, p_limit int default 50)
returns table (
  id text, customer_name text, page_id text, page_name text, source text, profile_pic text,
  last_message_at timestamptz, match_count int, match_text text, match_at text, match_who text
)
language sql stable security invoker set search_path = public
as $$
  with pat as (
    select '%' || replace(replace(replace(btrim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as p
  ), hits as (
    select i.chat_id, i.t, i.at, i.w
    from pat, chat_message_index i
    where length(btrim(coalesce(p_q, ''))) >= 2 and i.t ilike pat.p
  ), per_chat as (
    select chat_id, count(*)::int as n,
           (array_agg(t order by at desc))[1] as t, (array_agg(at order by at desc))[1] as at, (array_agg(w order by at desc))[1] as w
    from hits group by chat_id
  )
  select c.id, c.customer_name, c.page_id, c.page_name, c.source, c.profile_pic, c.last_message_at, p.n, p.t, p.at, p.w
  from per_chat p join chat_customers c on c.id = p.chat_id
  where (p_pages is null or c.page_id = any(p_pages))
  order by c.last_message_at desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;
grant execute on function public.search_chat_messages(text, text[], int) to authenticated;
