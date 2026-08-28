-- Security hardening v2
-- Apply after the existing permission/RLS hardening migration.
-- Only server-owned tables are changed here; browser-facing tables keep their
-- existing scoped policies so this migration does not cause a broad outage.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'app_secrets',
    'scheduled_jobs',
    'activity_log',
    'push_sent_log',
    'chat_translations',
    'ad_insights_cache',
    'trade_id_cache'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all on table public.%I from anon, authenticated', table_name);
    end if;
  end loop;
end $$;

