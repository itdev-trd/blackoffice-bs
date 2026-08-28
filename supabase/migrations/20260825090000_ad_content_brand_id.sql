-- Keep approval assets separated by the CI brand that was selected when they were generated.
-- Existing rows remain valid and are shown as "ไม่ระบุแบรนด์" until manually classified.
alter table if exists public.ad_copies
  add column if not exists brand_id text;

alter table if exists public.ad_images
  add column if not exists brand_id text;

create index if not exists ad_copies_brand_id_idx on public.ad_copies (brand_id);
create index if not exists ad_images_brand_id_idx on public.ad_images (brand_id);
