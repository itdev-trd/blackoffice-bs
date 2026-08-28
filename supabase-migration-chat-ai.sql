-- ฟิลด์สำหรับการจัดสถานะด้วย AI (ไฮบริด: กฎ + AI เฉพาะเคสก้ำกึ่ง)
alter table public.chat_customers add column if not exists ai_hash text;        -- hash เนื้อแชทที่ AI จัดล่าสุด (กันยิงซ้ำ)
alter table public.chat_customers add column if not exists ai_reason text;      -- เหตุผลสั้นๆ จาก AI
alter table public.chat_customers add column if not exists classified_by text;  -- 'rule' | 'ai'

-- เลือกได้ว่าเพจไหนใช้ AI (เมื่อเปิด AI แบบ global แล้ว)
alter table public.page_lead_config add column if not exists use_ai boolean not null default true;

-- ค่า AI ใน settings.chat_sync_config (เพิ่ม key ย่อย): ai_enabled, ai_model, ai_mode, ai_max_per_run
-- ตัวอย่าง (ไม่บังคับรัน):
-- update public.settings set value = value || '{"ai_enabled":false,"ai_model":"gpt-4o-mini","ai_mode":"ambiguous","ai_max_per_run":150}'::jsonb where key='chat_sync_config';
