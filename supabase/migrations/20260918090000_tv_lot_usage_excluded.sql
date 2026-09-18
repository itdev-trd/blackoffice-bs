-- lot ที่ broker ไม่นับให้ (สัญลักษณ์ไม่เข้าเงื่อนไข rebate) — ดึงจาก webhook check-lot-symbol-not-in-list
-- เก็บไว้เพื่ออธิบายส่วนต่าง: ยอดในแอป BeSight/MT5 ของลูกค้า = lots + excluded_lots
-- ส่วน lots คือก้อนที่ใช้นับโควตา (check-lot หักก้อนที่ไม่นับออกให้แล้ว)
alter table public.tv_lot_usage add column if not exists excluded_lots numeric not null default 0;
comment on column public.tv_lot_usage.excluded_lots is 'lot ที่ไม่ถูกนับเพราะสัญลักษณ์ไม่เข้าเงื่อนไข (check-lot-symbol-not-in-list)';
