-- เลือกได้ว่าเพจไหนจะซิงก์ (default ซิงก์)
alter table public.page_lead_config add column if not exists sync_enabled boolean not null default true;

-- ค่าตั้งค่าการซิงก์ (จำนวนคิว/จำนวนข้อความ/คีย์เวิร์ด converted/ความเข้มการจับไอดีเทรด)
-- เก็บใน settings เดิม key = 'chat_sync_config' (ไม่ต้องสร้างตารางใหม่)
insert into public.settings (key, value)
values ('chat_sync_config', '{"per_page":200,"messages":30,"strict_trade_id":true,"keywords":["เปิดบัญชีแล้ว","เปิดบัญชีเรียบร้อย","สมัครแล้ว","สมัครเรียบร้อย","เทรดแล้ว","โอนแล้ว","ฝากแล้ว","ยืนยันแล้ว","จ่ายแล้ว","ชำระแล้ว"]}'::jsonb)
on conflict (key) do nothing;
