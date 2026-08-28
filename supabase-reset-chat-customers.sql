-- ============================================================
-- รีเซ็ตสถานะลูกค้าจากแชท "ทั้งหมด" ในตาราง chat_customers
-- ใช้เมื่อ: ต้องการล้างสถานะเดิมที่ติดผิด (เช่น false converted จากบั๊กสกัดเลข)
--          แล้วให้การซิงก์รอบถัดไปคำนวณใหม่ด้วยตรรกะที่แก้บั๊กแล้ว
--
-- วิธีรัน: Supabase Dashboard > SQL Editor > วางแล้วกด Run
--          (ตารางเปิด RLS แต่ SQL Editor รันด้วยสิทธิ์เจ้าของโปรเจกต์ ผ่านได้เลย)
--
-- ⚠️ ลำดับที่ถูกต้อง:
--    1) deploy edge function ที่แก้แล้วก่อน:  supabase functions deploy sync-conversations
--    2) รันสคริปต์นี้เพื่อล้างของเก่า
--    3) กด "ซิงก์เพจนี้" ในแอป ให้ระบบดึง + ประเมินสถานะใหม่
--    (ถ้ารีเซ็ตก่อน deploy ฟังก์ชันเก่าจะดึงข้อมูลผิดกลับมาอีก)
-- ============================================================

update public.chat_customers
set
  stage         = 'new',   -- สถานะที่ใช้จริง
  stage_auto    = 'new',   -- สถานะที่ระบบคำนวณ
  stage_manual  = null,    -- ⚠️ ล้างสถานะที่ "แอดมินตั้งเอง" ด้วย — อยากเก็บไว้ให้ลบบรรทัดนี้ทิ้ง
  phone         = null,    -- ล้างข้อมูลที่เคยจับได้ (ของปลอมจะหายไป, ของจริงจะถูกสกัดใหม่ตอนซิงก์)
  trade_id      = null,
  username      = null,
  province      = null,
  ai_hash       = null,    -- ล้าง hash เดิม บังคับให้ AI/กฎประเมินใหม่รอบหน้า
  ai_reason     = null,
  classified_by = null,
  updated_at    = now();

-- ------------------------------------------------------------
-- ทางเลือก: ถ้าไม่อยากรีเซ็ตทั้งหมด แต่ล้างเฉพาะที่ "ติด converted ผิด"
-- (auto-converted แต่ไม่มีเบอร์/ไอดี/username จริง) ให้ใช้อันนี้แทนด้านบน:
-- ------------------------------------------------------------
-- update public.chat_customers
-- set stage = 'new', stage_auto = 'new', ai_hash = null, ai_reason = null,
--     classified_by = null, updated_at = now()
-- where stage_auto = 'converted'
--   and coalesce(phone,'')    = ''
--   and coalesce(trade_id,'') = ''
--   and coalesce(username,'') = ''
--   and stage_manual is null;
