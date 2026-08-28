-- วันที่ TradingView ระบุว่าเพิ่มสิทธิ์ให้ผู้ใช้ (ถ้าปลายทางส่งฟิลด์ created มา)
-- แยกจากวันที่แอดมินติดต่อ/บันทึกสมาชิกในแอป เพื่อไม่ทำให้ประวัติ tv_access เปลี่ยนความหมาย
alter table public.tv_external_members
  add column if not exists tv_granted_at timestamptz;

alter table public.tv_access
  add column if not exists tv_granted_at timestamptz;

create index if not exists idx_tv_access_tv_granted_at
  on public.tv_access (tv_granted_at desc);

create index if not exists idx_tv_external_members_tv_granted_at
  on public.tv_external_members (tv_granted_at desc);
