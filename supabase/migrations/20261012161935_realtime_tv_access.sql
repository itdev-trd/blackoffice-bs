-- เปิด Realtime ให้ tv_access เพื่อให้หน้า "รายการสิทธิ์ TradingView" (TvMembersTab) และ
-- "สมาชิก Indicator" (BesightMembersTab) รีเฟรชอัตโนมัติเมื่อมีคนให้/ต่ออายุ/ถอนสิทธิ์จากเครื่องอื่น
--
-- ทำไม: โค้ดทั้งสองหน้า subscribe .channel(...).on("postgres_changes", { table: "tv_access" }, ...) ไว้แล้ว
-- แต่ tv_access ไม่เคยอยู่ใน publication supabase_realtime มาก่อน จึง subscribe เฉยๆ ไม่เคยทำงานจริง
-- (เจอจริง: ให้สิทธิ์สำเร็จในฐานข้อมูลแล้ว แต่อีกเครื่องที่เปิดหน้าค้างไว้ก่อนยังเห็น "0 สมาชิก" จนกว่าจะรีเฟรชเอง)
--
-- ต่างจากเคส chat_customers (7-8 ต.ค. 69 ฐานข้อมูลล่ม) ตรงที่ tv_access เป็นตารางเล็ก ไม่มีคอลัมน์
-- ข้อความยาวแบบ transcript และอัปเดตไม่บ่อย (เฉพาะตอนแอดมินให้/ถอน/ต่ออายุสิทธิ์) ความเสี่ยงต่ำกว่ามาก
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tv_access'
  ) then
    alter publication supabase_realtime add table public.tv_access;
  end if;
end $$;
