-- คลังคู่คำถาม/คำตอบที่ผ่านการคัดกรอง ไม่คัดลอกประวัติแชทดิบทั้งห้อง
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.knowledge_qa (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  page_id text not null,
  source text,
  source_chat_id text,
  question text not null,
  answer text not null,
  language text,
  tags text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'archived')),
  created_by text,
  reviewed_by text,
  reviewed_at timestamptz,
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists knowledge_qa_status_page_idx on public.knowledge_qa (status, page_id, updated_at desc);
create index if not exists knowledge_qa_question_trgm_idx on public.knowledge_qa using gin (question extensions.gin_trgm_ops);
create index if not exists knowledge_qa_answer_trgm_idx on public.knowledge_qa using gin (answer extensions.gin_trgm_ops);

alter table public.knowledge_qa enable row level security;
revoke all on public.knowledge_qa from anon, authenticated;

create or replace function public.increment_knowledge_use(target_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.knowledge_qa
  set use_count = use_count + 1, last_used_at = now(), updated_at = now()
  where id = target_id and status = 'approved';
$$;
revoke all on function public.increment_knowledge_use(uuid) from public, anon, authenticated;

