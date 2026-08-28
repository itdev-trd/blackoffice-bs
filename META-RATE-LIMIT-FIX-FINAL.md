# Meta `/me/accounts` rate-limit fix (final)

## Changes
- Centralized all Page-token lookups through `supabase/functions/_shared/meta-pages.ts`.
- Database cache key: `meta_pages_cache`.
- Cache lifetime increased to 24 hours.
- Added warm-isolate memory cache and same-isolate request coalescing.
- Added stale-cache fallback when Meta is rate-limited/unavailable.
- `sync-conversations` now uses the shared cache helper instead of its own duplicate implementation.
- Frontend `read_status` polling reduced from every 45 seconds to every 5 minutes.

## Deploy these Edge Functions
```bash
supabase functions deploy sync-conversations
supabase functions deploy messenger-reply
supabase functions deploy page-labels
supabase functions deploy meta-push-labels
supabase functions deploy subscribe-webhook
```

## Expected result
After the first request, `app_secrets` will contain `meta_pages_cache`. Refreshing the website should no longer call Meta `/me/accounts` repeatedly. The cache row should normally update about once per 24 hours, unless a function explicitly forces refresh.
