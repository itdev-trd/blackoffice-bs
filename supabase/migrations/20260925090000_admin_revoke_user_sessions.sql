-- ใช้ตอน owner รีเซ็ตรหัสผ่านให้ผู้ใช้คนอื่น (manage-permissions reset_password)
-- เปลี่ยนรหัสอย่างเดียวไม่เตะเครื่องที่ล็อกอินค้างไว้ — ถ้ารีเซ็ตเพราะรหัสรั่ว คนที่ถือ session เดิมยังใช้ต่อได้
-- ลบ session ทั้งหมดของผู้ใช้ = refresh token ใช้ไม่ได้ (refresh_tokens ผูก session แบบ cascade)
-- access token ที่ออกไปแล้วยังใช้ได้จนหมดอายุ (ค่าเริ่มต้น 1 ชม.)
create or replace function public.admin_revoke_user_sessions(target uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  delete from auth.sessions where user_id = target;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.admin_revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_user_sessions(uuid) to service_role;
