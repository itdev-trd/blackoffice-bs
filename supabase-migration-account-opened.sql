-- ป้าย "ลูกค้าเปิดบัญชีใหม่" — ประทับเวลาเมื่อแอดมินกดส่งป้ายนี้ไป Meta สำเร็จ
-- ใช้ตอนสร้างตาราง "สรุปรายวัน" ใน PDF แดชบอร์ดรายแอด (นับจำนวนเปิดบัญชีต่อวันต่อแอด)
alter table public.chat_customers
  add column if not exists account_opened_at timestamptz;

-- ช่วยให้ query "นับเปิดบัญชีต่อแอดต่อวัน" เร็ว (กรอง entry_ad_id + ไม่ว่าง)
create index if not exists chat_customers_account_opened_idx
  on public.chat_customers (entry_ad_id, account_opened_at)
  where account_opened_at is not null;
