-- TradingView access reconciliation: once daily at 00:05 Asia/Bangkok (17:05 UTC).
-- Requires pg_cron + pg_net and Vault secrets project_url/service_role_key.
select cron.unschedule(jobid)
from cron.job
where jobname in ('tv-sync-midnight-th', 'tv-sync-daily', 'tv-access-sync-midnight');

select cron.schedule('tv-sync-midnight-th', '5 17 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/tradingview',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{"action":"sync"}'::jsonb
  );
$$);
