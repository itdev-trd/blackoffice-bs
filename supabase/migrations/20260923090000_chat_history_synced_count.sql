-- จำว่าห้องไหนดึงประวัติย้อนหลังครบแล้ว (เท่ากับ message_count ณ ตอนนั้น)
-- ใช้โดย sync-conversations job backfill_history / backfill_transcript — มีข้อความใหม่ค่อยตรวจห้องนั้นใหม่
alter table public.chat_customers add column if not exists history_synced_count integer;
