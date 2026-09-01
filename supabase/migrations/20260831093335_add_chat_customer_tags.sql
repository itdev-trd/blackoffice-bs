-- แท็กที่แอดมินกำหนดเอง แยกจาก stage ซึ่งเป็นสถานะระบบ
alter table public.chat_customers
  add column if not exists tags text[] not null default '{}';

create index if not exists chat_customers_tags_gin_idx
  on public.chat_customers using gin (tags);

-- อนุญาตให้ผู้ใช้ที่ล็อกอินแก้เฉพาะแท็กได้ (ยังไม่เปิดสิทธิ์คอลัมน์อื่นเพิ่ม)
grant update (tags) on public.chat_customers to authenticated;
