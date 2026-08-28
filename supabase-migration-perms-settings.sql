-- ขยายสิทธิ์เพิ่ม: เลือกหัวข้อย่อยในหน้า "ตั้งค่า" ที่เข้าถึงได้ต่อผู้ใช้
alter table public.user_permissions add column if not exists allowed_settings jsonb not null default '[]'::jsonb;  -- คีย์หัวข้อตั้งค่า เช่น ["chat","synccfg"] (ว่าง = ไม่มีหัวข้อ)
