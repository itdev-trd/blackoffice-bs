-- ค้นหา "ข้อความในแชท" แบบ LINE OA Manager — พิมพ์คำแล้วหาว่าห้องไหนมีข้อความนี้ (ไม่ใช่แค่ชื่อ/ข้อความล่าสุด)
-- ข้อความเก็บอยู่ใน chat_customers.transcript (jsonb array)
-- 1) กรองทั้งห้องด้วย transcript::text (index trigram ช่วยกับตัวเลข/อังกฤษ เช่นเลขบัญชี ~0.1 วิ)
-- 2) เอาแค่ห้องที่เคลื่อนไหวล่าสุด p_limit ห้อง แล้วค่อยแตกรายข้อความนับจำนวน (คำไทยที่เจอเป็นพันห้อง ~0.5 วิ)
-- security invoker = ใช้ RLS ของผู้เรียก (คนที่ไม่มีสิทธิ์แท็บแชทจะค้นไม่เจออะไร)
create index if not exists chat_customers_transcript_trgm on public.chat_customers using gin ((transcript::text) extensions.gin_trgm_ops);

create or replace function public.search_chat_messages(p_q text, p_pages text[] default null, p_limit int default 50)
returns table (
  id text, customer_name text, page_id text, page_name text, source text, profile_pic text,
  last_message_at timestamptz, match_count int, match_text text, match_at text, match_who text
)
language sql stable security invoker set search_path = public, extensions
as $$
  with pat as (
    select '%' || replace(replace(replace(btrim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as p
  ), cand as (
    select c.id, c.customer_name, c.page_id, c.page_name, c.source, c.profile_pic, c.last_message_at, c.transcript
    from pat, chat_customers c
    where length(btrim(coalesce(p_q, ''))) >= 2
      and (p_pages is null or c.page_id = any(p_pages))
      and c.transcript::text ilike pat.p
    order by c.last_message_at desc nulls last
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ), hits as (
    select c.id, c.customer_name, c.page_id, c.page_name, c.source, c.profile_pic, c.last_message_at,
           m->>'t' as t, m->>'at' as at, m->>'w' as w
    from pat, cand c
    cross join lateral jsonb_array_elements(case when jsonb_typeof(c.transcript) = 'array' then c.transcript else '[]'::jsonb end) m
    where (m->>'t') ilike pat.p
  )
  select id, max(customer_name), max(page_id), max(page_name), max(source), max(profile_pic), max(last_message_at),
         count(*)::int,
         (array_agg(t order by at desc))[1], (array_agg(at order by at desc))[1], (array_agg(w order by at desc))[1]
  from hits
  group by id
  order by max(last_message_at) desc nulls last
$$;

grant execute on function public.search_chat_messages(text, text[], int) to authenticated;
