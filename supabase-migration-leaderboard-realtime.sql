-- กระดานแต้ม (Leaderboard): ให้ reply_stats ส่ง realtime เพื่ออัปเดตอันดับสด
-- รันครั้งเดียวใน Supabase SQL editor
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reply_stats'
  ) then
    alter publication supabase_realtime add table public.reply_stats;
  end if;
end $$;

-- ค่าเริ่มต้นการตั้งค่า (เปิดให้ทุกคนเห็น, นับทุกเพจ) — แอดมินแก้ได้ที่หน้าตั้งค่า
insert into public.settings (key, value, updated_at)
values ('leaderboard', '{"enabled": true, "emails": [], "pages": []}'::jsonb, now())
on conflict (key) do nothing;
