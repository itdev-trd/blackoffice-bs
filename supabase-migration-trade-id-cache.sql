-- cache ผลเช็คไอดีเทรด — ลดการยิง external (api.trdapi.com / ai.traderider.com) ซ้ำ
-- ผล "ผ่าน" เก็บถาวร (ไอดีที่ผ่านแล้วผ่านตลอด) · ผล "ไม่ผ่าน" ฝั่ง edge จะใช้ TTL สั้น (เผื่อลูกค้าเพิ่งสมัคร)
-- อ่าน/เขียนผ่าน edge function (service role) เท่านั้น
create table if not exists public.trade_id_cache (
  trade_id   text primary key,
  pass       boolean not null,
  via        text,
  platform   text,
  insertdate text,
  checked_at timestamptz not null default now()
);
alter table public.trade_id_cache enable row level security;

-- เช็ค: select * from public.trade_id_cache order by checked_at desc limit 20;
