-- เลิกฟีเจอร์ "ค้นหาข้อความในแชท" (7 ต.ค. 69) ตามที่ผู้ใช้สั่ง หลังฐานข้อมูล micro ล่มคืน 7→8 ต.ค.
-- trigger บน chat_customers ทำงานทุกครั้งที่ transcript เปลี่ยน (แตก jsonb + เขียนแถว + index trigram) = ภาระเพิ่มทุกข้อความ
drop trigger if exists chat_message_index_ins on public.chat_customers;
drop trigger if exists chat_message_index_upd on public.chat_customers;
drop function if exists public.chat_message_index_sync();
drop function if exists public.search_chat_messages(text, text[], int);
drop table if exists public.chat_message_index;
