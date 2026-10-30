-- รวบคู่ถาม-ตอบที่ซ้ำแพทเทิร์นเดิม (28 ต.ค. 69) — AI อ่านแพทเทิร์นไม่กี่ร้อยแถวแทนคู่ดิบหลายหมื่นแถว
--   a_key/q_key = กุญแจที่ normalize แล้ว (ตัดชื่อลูกค้า/เว้นวรรค/อีโมจิ) คำนวณใน _shared/chat-qa.ts
--   chat_qa_patterns = 1 แถวต่อ "คำตอบแบบเดียวกัน" + จำนวนครั้ง + ตัวอย่างคำถามที่ไม่ซ้ำกัน
--   สร้างใหม่ด้วย rebuild_chat_qa_patterns() หลัง chat-qa-extract เติมคู่ใหม่ (อ่านแค่ chat_qa_pairs ไม่แตะ transcript)
alter table public.chat_qa_pairs add column if not exists q_key text, add column if not exists a_key text;
create index if not exists chat_qa_pairs_a_key on public.chat_qa_pairs (a_key);

create table if not exists public.chat_qa_patterns (
  a_key text primary key,
  a_text text not null,
  a_images int not null default 0,
  uses int not null,
  chats int not null,
  q_samples text[] not null default '{}',
  q_variants int not null default 0,
  first_at timestamptz,
  last_at timestamptz,
  rebuilt_at timestamptz not null default now(),
  small_talk boolean not null default false
);
alter table public.chat_qa_patterns enable row level security;
drop policy if exists chat_qa_patterns_admin_read on public.chat_qa_patterns;
create policy chat_qa_patterns_admin_read on public.chat_qa_patterns for select to authenticated using ((select public.app_is_admin()));

create or replace function public.rebuild_chat_qa_patterns() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- where true: คำขอผ่าน PostgREST เปิด safeupdate ไว้ DELETE ไม่มี WHERE จะถูกปฏิเสธ
  delete from public.chat_qa_patterns where true;
  insert into public.chat_qa_patterns (a_key, a_text, a_images, uses, chats, q_samples, q_variants, first_at, last_at, rebuilt_at, small_talk)
  select p.a_key,
         (array_agg(p.a_text order by p.a_at desc))[1],
         max(p.a_images),
         count(*),
         count(distinct p.chat_id),
         (select coalesce(array_agg(x.q), '{}') from (
            select distinct on (q.q_key) coalesce(q.q_th, q.q_text) q
            from public.chat_qa_pairs q where q.a_key = p.a_key
            order by q.q_key, q.a_at desc limit 8) x),
         count(distinct p.q_key),
         min(p.a_at), max(p.a_at), now(),
         -- คำตอบสั้น ๆ ไม่มีเนื้อหา (สวัสดีค่ะ / ขอบคุณค่ะ / 🙏 / [สติกเกอร์]) — AI ไม่ต้องใช้เป็นตัวอย่าง
         length(regexp_replace((array_agg(p.a_text order by p.a_at desc))[1], '\[[^\]]*\]|[^[:alnum:]ก-๙]', '', 'g')) < 12
  from public.chat_qa_pairs p
  where p.a_key is not null
  group by p.a_key;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.rebuild_chat_qa_patterns() from public, anon, authenticated;
