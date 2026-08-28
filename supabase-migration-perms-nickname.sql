-- เพิ่มชื่อเล่น/ชื่อจำง่ายให้แต่ละผู้ใช้ (ไว้กันสับสนว่าเมลไหนของใคร)
alter table public.user_permissions add column if not exists nickname text;
