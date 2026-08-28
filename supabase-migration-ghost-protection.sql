-- ============================================================
-- Migration: ป้องกัน "แชทผี" (ghost chats / ลีดขยะ)
-- รันหลัง supabase-schema.sql แล้ว: Supabase Dashboard → SQL Editor → New query → วางทั้งไฟล์ → Run
-- ============================================================

-- ---------- ad_content: คอลัมน์เก็บสถานะ/สัญญาณแชทผี ----------
alter table public.ad_content
  add column if not exists ghost_flagged boolean not null default false,
  -- ghost_flagged = ระบบสงสัยว่าเป็นแชทผี/ลีดขยะ รอแอดมินตัดสิน (โหมด alert ไม่หยุดเอง)
  add column if not exists ghost_reason text,
  add column if not exists ghost_checked_at timestamptz,
  add column if not exists conversations numeric,   -- จำนวนแชทที่เริ่ม (messaging conversations started)
  add column if not exists replies numeric,          -- จำนวนแชทที่มีการตอบกลับจริง (first reply)
  add column if not exists reply_rate numeric;        -- replies / conversations (ตัวชี้วัดแชทผี)

create index if not exists idx_ad_content_ghost on public.ad_content(ghost_flagged);

-- ---------- ค่าเริ่มต้นของฟีเจอร์ป้องกันแชทผี ----------
-- enabled: เปิด/ปิดทั้งฟีเจอร์
-- exclude_audience_network: ตอนลอนช์ให้ตัด Audience Network ออก (แหล่งแชทผี/มิสคลิกอันดับ 1)
-- min_conversations: ต้องมีแชทเริ่มอย่างน้อยกี่ครั้งก่อนถึงจะตัดสิน (กันตัวอย่างน้อยเกินไป)
-- min_reply_rate: ถ้าอัตราการตอบกลับต่ำกว่านี้ = สงสัยแชทผี
-- action: "alert" = แจ้งเตือนรออนุมัติ (ไม่หยุดเอง) | "auto_pause" = หยุดอัตโนมัติ
insert into public.settings (key, value) values
  ('ghost_protection', jsonb_build_object(
    'enabled', true,
    'exclude_audience_network', true,
    'min_conversations', 10,
    'min_reply_rate', 0.4,
    'action', 'alert'
  ))
on conflict (key) do nothing;
