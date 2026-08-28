# Security hardening checklist

The application now has a shared Edge Function guard in
`supabase/functions/_shared/permissions.ts` and
`supabase/functions/_shared/security.ts`.

## What is enforced in code

- Every function using `authorizeRequest` is fail-closed: a valid Supabase
  session **and** a row in `user_permissions` are required.
- A process-local rate limit protects authenticated and service-role requests.
  Defaults are 120 requests/minute per user/IP/function and 600 requests/minute
  for internal service calls. Invalid or missing bearer tokens are limited to
  60 requests/minute per IP before Supabase Auth is called. Configure
  `APP_RATE_LIMIT_PER_MINUTE`, `APP_UNAUTH_RATE_LIMIT_PER_MINUTE`,
  `APP_SERVICE_RATE_LIMIT_PER_MINUTE`, and `APP_RATE_LIMIT_WINDOW_SECONDS` as
  Supabase Edge Function secrets if a different limit is needed.
- JSON request bodies are capped on the high-risk endpoints. Oversized or invalid
  JSON is rejected before expensive Meta/AI/TradingView work starts.
- Every authenticated Edge Function also rejects a declared request body larger
  than 10 MB before session work. Set `APP_MAX_REQUEST_BYTES` (64 KB–16 MB)
  when an endpoint needs a different global ceiling.
- Security response headers are available from the shared response helper.
- Legacy admin-only endpoints now use the same central authorization and limiter.

## Required Supabase steps (run once)

1. Apply `supabase/migrations/20260825120000_security_hardening_v2.sql` in the
   Supabase migration pipeline. Also verify that the existing
   `supabase-migration-security-hardening.sql` has already been applied; the v2
   migration does not replace its scoped RLS policies.
2. Keep `SUPABASE_SERVICE_ROLE_KEY`, Meta tokens, and AI provider keys only in
   Edge Function secrets/Vault. Never put them in `VITE_*` variables or browser
   code. Rotate any key that has ever been committed or pasted into a public log.
3. Deploy ordinary functions with JWT verification enabled. Only the signed
   `meta-webhook` and `line-webhook` endpoints should be public, and they must
   keep their Meta/LINE signature checks enabled.
4. Add a WAF/API gateway rule in front of the public domain: challenge/block
   obvious floods, cap request bodies (8 MB is enough for this app), and limit
   concurrent connections. The Edge limiter is a second layer, not a substitute
   for a distributed WAF.

## Verification

Run the static regression test and the normal project checks before deploying:

```sh
node --test tests/security-regression.test.mjs
npm run check
```

After deployment, verify `meta-webhook` and `line-webhook` with their provider
test tools, then verify an authenticated inbox request and an unauthenticated
request (the latter must return 401/403).
