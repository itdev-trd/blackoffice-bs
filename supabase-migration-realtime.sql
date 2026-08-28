-- เปิด Realtime ให้ตาราง chat_customers → หน้า "ตอบแชท" เด้งทันทีเมื่อมีข้อความใหม่ (ไม่ต้อง poll)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_customers'
  ) then
    alter publication supabase_realtime add table public.chat_customers;
  end if;
end $$;
