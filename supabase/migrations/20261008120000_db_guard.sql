-- กันฐานข้อมูล (compute MICRO, max_connections 60) ล่มจาก connection ค้างพอกพูน
-- เหตุ 7→8 ต.ค. 69: งานค้างทับกันจน connection เต็มทั้งคืน ต้อง Restart project (ดู docs/RUNBOOK-ฐานข้อมูลล่ม.md)
-- ผู้ใช้อนุมัติ 8 ต.ค. 69 · คำสั่งแอปที่ช้าสุดตอนตั้งค่านี้ ~4 วิ เพดานด้านล่างจึงเผื่อไว้มาก

-- 1) เพดานเวลา: ฟังก์ชันหลังบ้าน (service_role) เดิมใช้ค่ากลาง 120 วิ → 30 วิ
--    ธุรกรรมที่เปิดค้างเฉย ๆ (idle in transaction) ปิดเองเมื่อเกิน 60 วิ
alter role service_role set statement_timeout = '30s';
alter role service_role set idle_in_transaction_session_timeout = '60s';
alter role authenticator set idle_in_transaction_session_timeout = '60s';
alter role authenticated set idle_in_transaction_session_timeout = '60s';

-- 2) ยามเฝ้าทุกนาที: ตัดงานของแอปที่ค้างเกิน 60 วิ แล้วจดไว้ (settings.db_guard_last)
--    แตะเฉพาะ role ของแอป ไม่ยุ่งกับ Realtime / replication / ระบบของ Supabase
--    จดเฉพาะตอนตัดจริง หรือ connection เกิน 45/60 (สัญญาณเตือนก่อนเต็ม)
create or replace function public.db_guard_sweep()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  killed jsonb := '[]'::jsonb;
  total int; active int;
begin
  -- เลือกเป้าก่อน แล้วค่อยตัดทีละตัว — ห้ามใส่ pg_terminate_backend ไว้ใน WHERE
  -- (Postgres อาจเรียกก่อนเงื่อนไขอื่น = ตัดโปรเซสที่ไม่ได้ค้าง) · ตัวไหนตัดไม่ได้ (superuser) ข้ามไป
  for r in
    select a.pid, a.usename, a.state,
           round(extract(epoch from now() - coalesce(a.query_start, a.xact_start)))::int as secs,
           left(regexp_replace(a.query, '\s+', ' ', 'g'), 120) as q
    from pg_stat_activity a
    join pg_roles ro on ro.oid = a.usesysid and not ro.rolsuper
    where a.backend_type = 'client backend'
      and a.pid <> pg_backend_pid()
      and a.usename in ('authenticator', 'authenticated', 'anon', 'service_role')
      and ((a.state = 'active' and now() - a.query_start > interval '60 seconds')
        or (a.state like 'idle in transaction%' and now() - a.state_change > interval '60 seconds'))
  loop
    begin
      if pg_terminate_backend(r.pid) then
        killed := killed || jsonb_build_object('pid', r.pid, 'role', r.usename, 'state', r.state, 'secs', r.secs, 'q', r.q);
      end if;
    exception when others then null;
    end;
  end loop;
  select count(*), count(*) filter (where state = 'active') into total, active from pg_stat_activity;
  if jsonb_array_length(killed) > 0 or total > 45 then
    insert into public.settings (key, value, updated_at)
    values ('db_guard_last', jsonb_build_object('at', now(), 'connections', total, 'active', active, 'killed', killed), now())
    on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
  end if;
  return jsonb_build_object('connections', total, 'active', active, 'killed', jsonb_array_length(killed));
end $$;
revoke all on function public.db_guard_sweep() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'db-guard-1min';
select cron.schedule('db-guard-1min', '* * * * *', $$select public.db_guard_sweep()$$);
