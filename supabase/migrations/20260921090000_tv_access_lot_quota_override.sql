-- โควตา Lot เฉพาะราย — ปกติใช้ค่ากลางของแบรนด์ (tv_brands.lot_quota_per_month)
-- แต่บางคนตกลงกันไว้คนละเลข (ดีลพิเศษ/ลูกค้าเก่า) จึงตั้งทับเป็นรายคนได้
-- null = ใช้ค่ากลางของแบรนด์ตามเดิม
alter table public.tv_access add column if not exists lot_quota_override numeric;
comment on column public.tv_access.lot_quota_override is 'โควตา Lot เฉพาะสมาชิกคนนี้ (null = ใช้ค่ากลางของแบรนด์)';
