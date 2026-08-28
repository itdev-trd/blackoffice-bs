-- ============================================================
-- Migration: เพิ่ม storage bucket สำหรับโลโก้/ป้ายริบบิ้นแบรนด์
-- รันหลังจาก supabase-schema.sql และ supabase-migration-split-copy-image.sql แล้ว
-- ไปที่ Supabase Dashboard → SQL Editor → New query → วางทั้งไฟล์ → Run
-- ============================================================

-- ---------- Storage bucket สำหรับโลโก้/ริบบิ้นที่แอดมินอัปโหลดเอง ----------
insert into storage.buckets (id, name, public)
values ('brand-assets', 'brand-assets', true)
on conflict (id) do nothing;

create policy "brand-assets: public read"
  on storage.objects for select
  using (bucket_id = 'brand-assets');

create policy "brand-assets: authenticated upload"
  on storage.objects for insert
  to authenticated with check (bucket_id = 'brand-assets');

create policy "brand-assets: authenticated update"
  on storage.objects for update
  to authenticated using (bucket_id = 'brand-assets');

create policy "brand-assets: authenticated delete"
  on storage.objects for delete
  to authenticated using (bucket_id = 'brand-assets');

create policy "brand-assets: service role full access"
  on storage.objects for all
  to service_role using (bucket_id = 'brand-assets');

-- ---------- settings: เพิ่มคีย์ brand_assets (โลโก้/ริบบิ้น + ตำแหน่งที่จะวาง) ----------
insert into public.settings (key, value) values
  ('brand_assets', jsonb_build_object(
    'logo_url', '',
    'logo_position', 'bottom-right',
    -- 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'bottom-center' | 'top-center'
    'logo_scale_pct', 15,
    -- ขนาดโลโก้เทียบกับความกว้างภาพ (%)
    'ribbon_url', '',
    'ribbon_position', 'top-left',
    'ribbon_scale_pct', 25,
    'placement_notes', ''
    -- คำอธิบายเพิ่มเติมเป็นข้อความอิสระ เช่น "อยากให้โลโก้อยู่มุมขวาล่างเสมอ ห่างขอบนิดหน่อย"
  ))
on conflict (key) do nothing;
