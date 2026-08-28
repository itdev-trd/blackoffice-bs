-- ตั้งค่าแจ้งเตือน "แชทค้างอ่าน" แบบรายผู้ใช้ — แอดมินคุมทั้งหมด ผู้ใช้ปรับเองไม่ได้
-- เดิม: เกณฑ์นาที + เพจที่เตือน เก็บใน localStorage ของแต่ละเครื่อง (ผู้ใช้เปลี่ยน/ปิดเองได้ และหายเมื่อล้างแคช)
-- ใหม่: เก็บใน user_permissions ให้แอดมินกำหนดรายคน เพราะแต่ละคนดูแลคนละเพจ
alter table public.user_permissions add column if not exists alert_minutes int not null default 3;         -- ค้างอ่านเกินกี่นาทีถึงเตือน
alter table public.user_permissions add column if not exists alert_pages jsonb not null default '[]'::jsonb; -- page_id ที่ให้เตือน (ว่าง = ทุกเพจที่ผู้ใช้เข้าถึงได้)
alter table public.user_permissions add column if not exists alert_sound boolean not null default true;     -- เสียงเตือน

comment on column public.user_permissions.alert_minutes is 'แจ้งเตือนเมื่อแชทค้างอ่านเกินกี่นาที (แอดมินตั้งให้)';
comment on column public.user_permissions.alert_pages is 'เพจที่ผู้ใช้คนนี้จะได้รับแจ้งเตือน — ว่าง = ทุกเพจที่เข้าถึงได้';
