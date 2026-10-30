-- คลังคู่ "ลูกค้าถาม → แอดมินตอบ" จากแชท BeSight (FB/IG/LINE) — ขั้นแรกของ AI ช่วยร่างคำตอบ (28 ต.ค. 69)
-- เติมโดย edge function chat-qa-extract ทีละไม่กี่ห้อง (ฐานข้อมูล micro — ห้ามสแกน transcript ทั้งก้อน)
-- ข้อความถูกปิดบังอีเมล/เบอร์/ตัวเลขยาวแล้วก่อนเก็บ
create table if not exists public.chat_qa_pairs (
  id bigserial primary key,
  chat_id text not null,
  page_id text not null,
  source text,
  q_text text not null,
  q_th text,
  a_text text not null default '',
  a_images int not null default 0,
  q_at timestamptz not null,
  a_at timestamptz not null,
  response_sec int,
  answered_by text,
  context text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chat_id, q_at)
);
create index if not exists chat_qa_pairs_a_at on public.chat_qa_pairs (a_at desc);

alter table public.chat_qa_pairs enable row level security;
drop policy if exists chat_qa_pairs_admin_read on public.chat_qa_pairs;
create policy chat_qa_pairs_admin_read on public.chat_qa_pairs for select to authenticated using ((select public.app_is_admin()));

insert into public.scheduled_jobs (key, jobname, label, description, function_name, cron_expr, enabled, body_json)
values (
  'chat_qa_extract', 'chat-qa-extract-10m', 'ดึงคู่ถาม-ตอบจากแชท (AI)',
  'ทุก 10 นาที: อ่านแชท BeSight ที่มีข้อความใหม่ทีละไม่กี่ห้อง แล้วเก็บคู่ลูกค้าถาม→แอดมินตอบลง chat_qa_pairs (ปิดบังข้อมูลส่วนตัว)',
  'chat-qa-extract', '*/10 * * * *', true, '{}'
)
on conflict (key) do update set
  jobname = excluded.jobname, label = excluded.label, description = excluded.description,
  function_name = excluded.function_name, body_json = excluded.body_json, updated_at = now();
-- ตัว cron จริงสร้างผ่าน manage-cron (action "save" key "chat_qa_extract")
