-- Realtime แบบเบา: ฟังตาราง chat_live (แถวละไม่กี่สิบไบต์) แทน chat_customers ทั้งแถว
--
-- ทำไม: คืน 7→8 ต.ค. 69 ฐานข้อมูล (compute micro) ล่มทั้งคืน connection เต็ม เว็บ 504/AbortError
-- Realtime (wal2json) ต้องถอด chat_customers ทั้งแถวรวม transcript (สูงสุด ~20 KB) ส่งทุกเครื่องทุกครั้งที่แชทเปลี่ยน
-- และ wal2json ไม่สน column list ของ publication จึงตัดคอลัมน์ไม่ได้ ต้องย้ายไปตารางเล็กแทน
-- หน้าเว็บได้สัญญาณจาก chat_live แล้วค่อยดึงแถวนั้นแถวเดียว

create table if not exists public.chat_live (
  id text primary key references public.chat_customers(id) on delete cascade,
  page_id text,
  source text,
  changed_at timestamptz not null default now()
);
alter table public.chat_live enable row level security;
drop policy if exists "read chat_live" on public.chat_live;
create policy "read chat_live" on public.chat_live for select
  using ((select app_is_admin()) or (select app_has_any_tab(array['inbox','chat','customerdb','feed','ad_chats'])));

create or replace function public.chat_live_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.chat_live (id, page_id, source, changed_at)
  values (new.id, new.page_id, new.source, now())
  on conflict (id) do update set page_id = excluded.page_id, source = excluded.source, changed_at = excluded.changed_at;
  return null;
end $$;

drop trigger if exists chat_live_ins on public.chat_customers;
create trigger chat_live_ins after insert on public.chat_customers
  for each row execute function public.chat_live_touch();

-- ส่งสัญญาณเฉพาะเมื่อสิ่งที่เห็นในหน้าแชทเปลี่ยน (ซิงก์ที่แตะแค่ synced_at ไม่ต้องปลุกทุกเครื่อง)
drop trigger if exists chat_live_upd on public.chat_customers;
create trigger chat_live_upd after update on public.chat_customers
  for each row when (
    (old.last_message_at, old.last_reply_at, old.last_user_text, old.last_reply_text, old.unread, old.awaiting_reply,
     old.cust_read_at, old.blocked_at, old.not_interested_at, old.stage, old.stage_manual, old.tags,
     old.customer_name, old.profile_pic, old.country, old.purge_at, old.page_id, old.source)
    is distinct from
    (new.last_message_at, new.last_reply_at, new.last_user_text, new.last_reply_text, new.unread, new.awaiting_reply,
     new.cust_read_at, new.blocked_at, new.not_interested_at, new.stage, new.stage_manual, new.tags,
     new.customer_name, new.profile_pic, new.country, new.purge_at, new.page_id, new.source)
  )
  execute function public.chat_live_touch();

insert into public.chat_live (id, page_id, source, changed_at)
select id, page_id, source, coalesce(updated_at, now()) from public.chat_customers
on conflict (id) do nothing;

do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_customers') then
    alter publication supabase_realtime drop table public.chat_customers;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_live') then
    alter publication supabase_realtime add table public.chat_live;
  end if;
end $$;

-- ลดความถี่ cron ที่ปลุก edge function: webhook Meta กลับมาส่งปกติแล้ว ไม่ต้องถามทุกนาที
-- (backfill_history ทำครบแล้ว รอบส่วนใหญ่แค่ "skipped: done")
select cron.alter_job(job_id := 7, schedule := '*/2 * * * *');    -- chat-recent: ทุก 1 → 2 นาที
select cron.alter_job(job_id := 11, schedule := '*/10 * * * *');  -- chat-history-backfill: ทุก 2 → 10 นาที
