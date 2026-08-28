-- ให้เก็บ referral ได้ "หลายแอดต่อลูกค้า" (เดิม PK = page_id+psid เก็บได้อันเดียว)
alter table public.chat_referrals drop constraint if exists chat_referrals_pkey;
-- unique ต่อ (เพจ, ลูกค้า, แอด) — ลูกค้าที่ทักจากหลายแอดจะเก็บครบทุกตัว
create unique index if not exists chat_referrals_uniq on public.chat_referrals (page_id, psid, ad_id);
create index if not exists chat_referrals_lookup_idx on public.chat_referrals (page_id, psid);
