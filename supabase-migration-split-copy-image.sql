-- ============================================================
-- Migration: แยก copy กับรูปออกจากกัน + รองรับเลือกหลายคู่ตอนลอนช์
-- รันหลังจาก supabase-schema.sql แล้วเท่านั้น (ต้องมีตาราง ad_content เดิมอยู่ก่อน)
-- ไปที่ Supabase Dashboard → SQL Editor → New query → วางทั้งไฟล์ → Run
-- ============================================================

-- ---------- ad_copies (ข้อความโฆษณาแต่ละเวอร์ชัน — แยกจากรูปแล้ว) ----------
create table if not exists public.ad_copies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  product text,
  headline text,
  primary_text text,
  description text,
  cta text,
  status text not null default 'pending_approval',
  -- pending_approval | used | rejected  (used = ถูกจับคู่ไปลอนช์แล้วอย่างน้อย 1 ครั้ง ยังใช้ซ้ำได้)
  ai_score numeric,
  ai_rationale text,
  scored_at timestamptz,
  generated_by_model text -- 'claude' | 'openai'
);

alter table public.ad_copies enable row level security;

create policy "ad_copies: authenticated full access"
  on public.ad_copies for all
  to authenticated using (true) with check (true);

create index if not exists idx_ad_copies_status on public.ad_copies(status);

-- ---------- ad_images (รูปโฆษณาแต่ละเวอร์ชัน — แยกจาก copy แล้ว) ----------
create table if not exists public.ad_images (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  image_prompt text,
  image_url text,
  status text not null default 'pending_approval',
  -- pending_approval | used | rejected
  ai_score numeric,
  ai_rationale text,
  scored_at timestamptz,
  generated_by_model text -- 'gpt-image-1' | 'gpt-image-2'
);

alter table public.ad_images enable row level security;

create policy "ad_images: authenticated full access"
  on public.ad_images for all
  to authenticated using (true) with check (true);

create index if not exists idx_ad_images_status on public.ad_images(status);

-- ---------- ad_content: เปลี่ยนบทบาทจาก "1 copy+1 รูปที่รออนุมัติ" เป็น "แคมเปญที่ถูกลอนช์จริงแล้ว" ----------
-- แถวใหม่ในตารางนี้จะถูกสร้างตอนกด "ยืนยันลอนช์" เท่านั้น (หลังจับคู่ copy+image เสร็จ)
-- คอลัมน์เดิม headline/primary_text/description/cta/image_url ยังคงอยู่ไว้เป็น "สำเนา ณ ตอนลอนช์"
-- (กัน AI ไปแก้/ลบ copy หรือ image ต้นทางทีหลังแล้วกระทบแคมเปญที่ยิงไปแล้ว)
alter table public.ad_content
  add column if not exists copy_id uuid references public.ad_copies(id),
  add column if not exists image_id uuid references public.ad_images(id),
  add column if not exists launch_group_id uuid,
  -- launch_group_id: กลุ่มของการกดลอนช์ครั้งเดียวกัน (แอดมินเลือกหลายคู่พร้อมกันได้)
  -- ใช้แยกว่าแถวไหนมาจากการกดปุ่มเดียวกัน เผื่อดูย้อนหลังหรือยกเลิกทั้งกลุ่ม
  add column if not exists launch_mode text;
  -- 'separate_campaigns' | 'single_campaign_multi_ad'

create index if not exists idx_ad_content_launch_group on public.ad_content(launch_group_id);

-- ---------- ai_pairing_suggestions (เก็บคำแนะนำการจับคู่ + โหมดแคมเปญจาก AI ไว้ตรวจสอบย้อนหลัง) ----------
create table if not exists public.ai_pairing_suggestions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  requested_by uuid references auth.users(id),
  input_copy_ids uuid[],
  input_image_ids uuid[],
  suggested_pairs jsonb, -- [{copy_id, image_id, reason}]
  suggested_mode text, -- 'separate_campaigns' | 'single_campaign_multi_ad'
  mode_rationale text,
  model_used text
);

alter table public.ai_pairing_suggestions enable row level security;

create policy "ai_pairing_suggestions: authenticated full access"
  on public.ai_pairing_suggestions for all
  to authenticated using (true) with check (true);

-- ---------- หมายเหตุการย้ายข้อมูลเดิม ----------
-- ถ้ามีแถวเก่าใน ad_content ที่ยังเป็น pending_approval (สร้างจากระบบเวอร์ชันก่อนแก้ครั้งนี้)
-- แถวเหล่านั้นจะไม่ถูกย้ายเข้า ad_copies/ad_images อัตโนมัติ เพราะโครงสร้างข้อมูลเปลี่ยนความหมายไปแล้ว
-- แนะนำให้ปฏิเสธ (reject) หรือจัดการแถว pending เดิมให้เสร็จก่อนอัปเดตเว็บแอปเป็นเวอร์ชันใหม่
-- แถวที่เคย active/paused_auto/paused_manual ไปแล้ว ไม่กระทบ ยังอยู่ครบและแสดงในแท็บ "แคมเปญ" ตามปกติ
