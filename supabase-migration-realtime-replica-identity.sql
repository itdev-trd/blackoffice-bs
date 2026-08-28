-- ================================================================
-- แก้: พนักงาน (analyze_only) ไม่ได้รับ event เรียลไทม์ตอน UPDATE แต่ admin ได้
-- สาเหตุ: RLS ของพนักงานต้องเช็ค page_id ของแถว แต่ REPLICA IDENTITY เป็น default (แค่ PK)
--   → ตอน UPDATE "แถวเก่า" ใน WAL ไม่มี page_id → Realtime เช็ค RLS ของพนักงานไม่ผ่าน → ไม่ส่ง event
--   admin ผ่านด้วย app_is_admin() (ไม่ต้องใช้ page_id) จึงยังได้เรียลไทม์ปกติ
-- วิธีแก้: ตั้ง REPLICA IDENTITY FULL ให้ WAL ใส่ทุกคอลัมน์ (รวม page_id) เวลาส่งการเปลี่ยนแปลง
-- ================================================================

alter table public.chat_customers replica identity full;

-- (ถ้าใช้เรียลไทม์กับตารางอื่นที่มี RLS อ้างอิงคอลัมน์ที่ไม่ใช่ PK ก็ควรตั้งเช่นกัน เช่น)
-- alter table public.reply_stats replica identity full;

-- ตรวจผล: relreplident ควรเป็น 'f' (full)  [d=default, f=full]
select relname, relreplident
from pg_class
where relname = 'chat_customers';
