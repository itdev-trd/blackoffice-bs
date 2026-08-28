-- Dataset ID ของ Conversion Leads "แยกตามเพจ"
-- เอกสาร Meta ระบุชัดว่า 1 เพจผูกได้กับ 1 ชุดข้อมูลเท่านั้น (one dataset per page)
-- ของเดิมเก็บ dataset เดียวรวมทุกเพจใน settings.chat_sync_config.meta_dataset_id ซึ่งผิดโครงสร้าง
-- เมื่อมีหลายเพจ: ส่ง event ของเพจ A เข้า dataset ของเพจ B → Meta ปฏิเสธ หรือระบุที่มาผิด
--
-- ดึงค่านี้อัตโนมัติได้จากปุ่ม "ดึง Dataset ของทุกเพจ" ในหน้าตั้งค่า (เรียก POST /{page_id}/dataset)
alter table public.page_lead_config add column if not exists dataset_id text;

-- เก็บผลการส่งไว้ดูย้อนหลังได้ว่าเพจไหนตั้งค่าครบแล้ว
comment on column public.page_lead_config.dataset_id is 'Dataset ID ของ Conversion Leads สำหรับเพจนี้ (1 เพจ = 1 dataset ตามข้อกำหนด Meta)';
