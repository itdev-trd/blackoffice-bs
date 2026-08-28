-- Preserve the existing inbox authorization rules while evaluating the
-- current user's permission row once per statement instead of once per chat.

create or replace function public.app_allowed_pages()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce((
    select p.allowed_pages
    from public.user_permissions p
    where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and p.role = 'analyze_only'
    limit 1
  ), '[]'::jsonb)
$$;

revoke all on function public.app_allowed_pages() from public;
grant execute on function public.app_allowed_pages() to authenticated;

drop policy if exists "read chat_customers" on public.chat_customers;
create policy "read chat_customers" on public.chat_customers
  for select to authenticated
  using (
    (select public.app_is_admin())
    or (
      (select public.app_has_any_tab(array['inbox','chat','customerdb']))
      and (select public.app_allowed_pages()) ? page_id
    )
  );

drop policy if exists "update chat_customers" on public.chat_customers;
create policy "update chat_customers" on public.chat_customers
  for update to authenticated
  using (
    (select public.app_is_admin())
    or (
      (select public.app_has_any_tab(array['inbox','chat','customerdb']))
      and (select public.app_allowed_pages()) ? page_id
    )
  )
  with check (
    (select public.app_is_admin())
    or (
      (select public.app_has_any_tab(array['inbox','chat','customerdb']))
      and (select public.app_allowed_pages()) ? page_id
    )
  );
