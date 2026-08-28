-- ซ่อนแอดออกจากรายการหน้า "แคมเปญ" และ "วิเคราะห์" โดยไม่ลบข้อมูล
-- ทำไมไม่ลบทิ้ง: metrics_log ผูกกับ ad_content แบบ on delete cascade
-- ถ้าลบแถวแอด ประวัติผลทั้งหมดของแอดนั้น (หลักร้อยรายการ) จะหายตามไปด้วยและกู้คืนไม่ได้
-- ใช้ธง archived_at แทน = หน้าเว็บไม่แสดง แต่ข้อมูล/ประวัติยังอยู่ครบ กดกู้คืนได้ตลอด
alter table public.ad_content add column if not exists archived_at timestamptz;

comment on column public.ad_content.archived_at is 'เวลาที่ถูกซ่อนออกจากรายการ (null = แสดงปกติ) — ข้อมูลและ metrics_log ยังอยู่ครบ';

-- index บางส่วน: ดึงเฉพาะรายการที่ยังไม่ถูกซ่อนได้เร็ว
create index if not exists ad_content_active_idx on public.ad_content (created_at desc) where archived_at is null;
