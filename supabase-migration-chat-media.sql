-- ที่เก็บรูป/ไฟล์ที่แอดมินส่งในหน้า "ตอบแชท" (public เพื่อให้ Meta ดึงไปส่ง + แสดงในแชทได้)
insert into storage.buckets (id, name, public) values ('chat-media', 'chat-media', true)
  on conflict (id) do update set public = true;

-- อัปโหลดได้เฉพาะผู้ล็อกอิน, อ่าน (ดูรูป) ได้สาธารณะ
drop policy if exists "chat-media upload" on storage.objects;
create policy "chat-media upload" on storage.objects for insert to authenticated with check (bucket_id = 'chat-media');
drop policy if exists "chat-media read" on storage.objects;
create policy "chat-media read" on storage.objects for select using (bucket_id = 'chat-media');
