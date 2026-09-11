// crm-customers — read-only, server-to-server CRM export API
// =====================================================================
// GET /crm-customers                -> changed/created chat_customers rows
// GET /crm-customers/deleted        -> tombstones for hard-deleted chat_customers rows
// GET /crm-customers/tradingview          -> TradingView indicator access rows (tv_access)
// GET /crm-customers/tradingview/deleted  -> tombstones for hard-deleted tv_access rows
//
// Auth: `Authorization: Bearer <api key>` only. There is no session/JWT
// path here — verify_jwt is set to false for this function (see
// supabase/config.toml) specifically so it is reachable without a user
// JWT, since the only intended callers are other backends.
//
// No CORS headers are ever set on any response, intentionally: a
// browser-originated request will be blocked by same-origin policy
// before it can even reach a real client key. If you need this from a
// browser, you're using it wrong — proxy it through your own backend.
//
// Every path below fails closed: anything unexpected (bad key lookup,
// DB error, malformed input) returns an error, never a partial or
// best-effort success.
//
// Scopes: every resource requires its own scope on top of a valid,
// non-revoked key — `customers`/`customers:read` for chat customer data
// (plus `customers:transcript` for `include=transcript`), and
// `tradingview`/`tradingview:read` for TradingView indicator access.
// A key minted for one can never read the other, so sharing a
// TradingView-only key never exposes chat/customer-contact data.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const RATE_LIMIT_PER_MINUTE = 120;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const CUSTOMERS_SCOPE = "customers:read";
const TRANSCRIPT_SCOPE = "customers:transcript";
const TRADINGVIEW_SCOPE = "tradingview:read";

type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "bad_request"
  | "rate_limited"
  | "unavailable";

function jsonResponse(body: unknown, status: number, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

function errorResponse(error: string, code: ErrorCode, status: number, extraHeaders?: Record<string, string>) {
  return jsonResponse({ ok: false, error, code }, status, extraHeaders);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type Cursor = { at: string; id: string };

function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed = JSON.parse(atob(raw));
    if (typeof parsed?.at !== "string" || typeof parsed?.id !== "string") return null;
    if (Number.isNaN(Date.parse(parsed.at))) return null;
    return { at: parsed.at, id: parsed.id };
  } catch {
    return null;
  }
}

function encodeCursor(cursor: Cursor): string {
  return btoa(JSON.stringify(cursor));
}

type ApiClient = {
  id: string;
  name: string;
  scopes: string[];
  revoked_at: string | null;
};

async function authenticate(
  admin: SupabaseClient,
  authHeader: string | null,
): Promise<{ client: ApiClient } | { error: Response }> {
  const key = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!key) {
    return { error: errorResponse("Missing or malformed Authorization header", "unauthorized", 401) };
  }

  const keyHash = await sha256Hex(key);
  const { data, error } = await admin
    .from("api_clients")
    .select("id, name, scopes, revoked_at")
    .eq("key_hash", keyHash)
    .maybeSingle();

  // Fail closed: if we can't confirm the key table is readable, refuse
  // rather than silently letting the request through.
  if (error) {
    console.error("crm-customers: api_clients lookup failed", error);
    return { error: errorResponse("Client registry unavailable", "unavailable", 503) };
  }
  if (!data || data.revoked_at) {
    return { error: errorResponse("Invalid or revoked API key", "unauthorized", 401) };
  }

  return { client: data as ApiClient };
}

async function enforceRateLimit(
  admin: SupabaseClient,
  clientId: string,
): Promise<Response | null> {
  const { data, error } = await admin
    .rpc("crm_rate_limit_hit", { p_client_id: clientId, p_limit: RATE_LIMIT_PER_MINUTE })
    .single();

  if (error) {
    console.error("crm-customers: rate limit check failed", error);
    return errorResponse("Rate limit check unavailable", "unavailable", 503);
  }
  const { allowed, retry_after } = data as { allowed: boolean; retry_after: number };
  if (!allowed) {
    return errorResponse("Too many requests", "rate_limited", 429, { "retry-after": String(retry_after) });
  }
  return null;
}

function parseLimit(raw: string | null): number {
  const n = raw ? Number(raw) : DEFAULT_LIMIT;
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(n)));
}

function parseCursor(raw: string | null): { cursor: Cursor | null } | { error: Response } {
  if (!raw) return { cursor: null };
  const cursor = decodeCursor(raw);
  if (!cursor) return { error: errorResponse("`cursor` is invalid or expired", "bad_request", 400) };
  return { cursor };
}

async function handleCustomers(admin: SupabaseClient, url: URL, client: ApiClient): Promise<Response> {
  if (!client.scopes.includes(CUSTOMERS_SCOPE)) {
    return errorResponse(`Missing scope: ${CUSTOMERS_SCOPE}`, "forbidden", 403);
  }
  const sinceRaw = url.searchParams.get("since");
  const cursorRaw = url.searchParams.get("cursor");
  const pageId = url.searchParams.get("page_id");
  const stage = url.searchParams.get("stage");
  const id = url.searchParams.get("id");
  const include = url.searchParams.get("include");
  const limit = parseLimit(url.searchParams.get("limit"));

  if (sinceRaw && Number.isNaN(Date.parse(sinceRaw))) {
    return errorResponse("`since` must be an ISO 8601 timestamp", "bad_request", 400);
  }
  const cursorResult = parseCursor(cursorRaw);
  if ("error" in cursorResult) return cursorResult.error;
  const cursor = cursorResult.cursor;
  if (include && include !== "transcript") {
    return errorResponse("`include` only supports `transcript`", "bad_request", 400);
  }
  const includeTranscript = include === "transcript";
  if (includeTranscript && !client.scopes.includes(TRANSCRIPT_SCOPE)) {
    return errorResponse(`Missing scope: ${TRANSCRIPT_SCOPE}`, "forbidden", 403);
  }

  const { data, error } = await admin.rpc("crm_customers_page", {
    p_since: cursor ? null : sinceRaw,
    p_after_at: cursor?.at ?? null,
    p_after_id: cursor?.id ?? null,
    p_limit: limit,
    p_page_id: pageId,
    p_stage: stage,
    p_id: id,
    p_include_transcript: includeTranscript,
  });
  if (error) {
    console.error("crm-customers: crm_customers_page failed", error);
    return errorResponse("Query failed", "unavailable", 503);
  }

  const rows = (data ?? []) as Array<Record<string, unknown> & { id: string; updated_at: string }>;

  // Single-record lookup by id: no pagination envelope needed.
  if (id) {
    return jsonResponse(
      {
        ok: true,
        resource: "customers",
        data: rows,
        count: rows.length,
        has_more: false,
        next_cursor: null,
        next_since: null,
        server_time: new Date().toISOString(),
      },
      200,
    );
  }

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  let nextSince: string | null = null;
  if (!hasMore) {
    const candidateMs = last ? Date.parse(last.updated_at) : Date.parse(sinceRaw ?? new Date().toISOString());
    nextSince = new Date(candidateMs - 60_000).toISOString();
  }

  return jsonResponse(
    {
      ok: true,
      resource: "customers",
      data: page,
      count: page.length,
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeCursor({ at: last.updated_at, id: last.id }) : null,
      next_since: nextSince,
      server_time: new Date().toISOString(),
    },
    200,
  );
}

async function handleDeleted(admin: SupabaseClient, url: URL, client: ApiClient): Promise<Response> {
  if (!client.scopes.includes(CUSTOMERS_SCOPE)) {
    return errorResponse(`Missing scope: ${CUSTOMERS_SCOPE}`, "forbidden", 403);
  }
  const sinceRaw = url.searchParams.get("since");
  const cursorRaw = url.searchParams.get("cursor");
  const limit = parseLimit(url.searchParams.get("limit"));

  if (sinceRaw && Number.isNaN(Date.parse(sinceRaw))) {
    return errorResponse("`since` must be an ISO 8601 timestamp", "bad_request", 400);
  }
  const cursorResult = parseCursor(cursorRaw);
  if ("error" in cursorResult) return cursorResult.error;
  const cursor = cursorResult.cursor;

  const { data, error } = await admin.rpc("crm_deleted_customers_page", {
    p_since: cursor ? null : sinceRaw,
    p_after_at: cursor?.at ?? null,
    p_after_id: cursor?.id ?? null,
    p_limit: limit,
  });
  if (error) {
    console.error("crm-customers: crm_deleted_customers_page failed", error);
    return errorResponse("Query failed", "unavailable", 503);
  }

  const rows = (data ?? []) as Array<{ id: string; deleted_at: string }>;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  let nextSince: string | null = null;
  if (!hasMore) {
    const candidateMs = last ? Date.parse(last.deleted_at) : Date.parse(sinceRaw ?? new Date().toISOString());
    nextSince = new Date(candidateMs - 60_000).toISOString();
  }

  return jsonResponse(
    {
      ok: true,
      resource: "deleted_customers",
      data: page,
      count: page.length,
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeCursor({ at: last.deleted_at, id: last.id }) : null,
      next_since: nextSince,
      server_time: new Date().toISOString(),
    },
    200,
  );
}

// TradingView indicator access (tv_access) — who has which indicator, lot,
// status, expiration. No chat/customer-contact fields beyond what TradingView
// itself needs (username, trade id, email) so a tradingview-only key never
// sees chat content.
async function handleTradingview(admin: SupabaseClient, url: URL, client: ApiClient): Promise<Response> {
  if (!client.scopes.includes(TRADINGVIEW_SCOPE)) {
    return errorResponse(`Missing scope: ${TRADINGVIEW_SCOPE}`, "forbidden", 403);
  }

  const sinceRaw = url.searchParams.get("since");
  const cursorRaw = url.searchParams.get("cursor");
  const username = url.searchParams.get("username");
  const tradeId = url.searchParams.get("trade_id");
  const pineId = url.searchParams.get("pine_id");
  const brandIdRaw = url.searchParams.get("brand_id");
  const status = url.searchParams.get("status");
  const idRaw = url.searchParams.get("id");
  const limit = parseLimit(url.searchParams.get("limit"));

  if (sinceRaw && Number.isNaN(Date.parse(sinceRaw))) {
    return errorResponse("`since` must be an ISO 8601 timestamp", "bad_request", 400);
  }
  const cursorResult = parseCursor(cursorRaw);
  if ("error" in cursorResult) return cursorResult.error;
  const cursor = cursorResult.cursor;

  const brandId = brandIdRaw ? Number(brandIdRaw) : null;
  if (brandIdRaw && !Number.isSafeInteger(brandId)) {
    return errorResponse("`brand_id` must be an integer", "bad_request", 400);
  }
  const id = idRaw ? Number(idRaw) : null;
  if (idRaw && !Number.isSafeInteger(id)) {
    return errorResponse("`id` must be an integer", "bad_request", 400);
  }

  const { data, error } = await admin.rpc("crm_tradingview_page", {
    p_since: cursor ? null : sinceRaw,
    p_after_at: cursor?.at ?? null,
    p_after_id: cursor?.id ? Number(cursor.id) : null,
    p_limit: limit,
    p_username: username,
    p_trade_id: tradeId,
    p_pine_id: pineId,
    p_brand_id: brandId,
    p_status: status,
    p_id: id,
  });
  if (error) {
    console.error("crm-customers: crm_tradingview_page failed", error);
    return errorResponse("Query failed", "unavailable", 503);
  }

  const rows = (data ?? []) as Array<Record<string, unknown> & { id: number; updated_at: string }>;

  if (id) {
    return jsonResponse(
      {
        ok: true,
        resource: "tradingview",
        data: rows,
        count: rows.length,
        has_more: false,
        next_cursor: null,
        next_since: null,
        server_time: new Date().toISOString(),
      },
      200,
    );
  }

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  let nextSince: string | null = null;
  if (!hasMore) {
    const candidateMs = last ? Date.parse(last.updated_at) : Date.parse(sinceRaw ?? new Date().toISOString());
    nextSince = new Date(candidateMs - 60_000).toISOString();
  }

  return jsonResponse(
    {
      ok: true,
      resource: "tradingview",
      data: page,
      count: page.length,
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeCursor({ at: last.updated_at, id: String(last.id) }) : null,
      next_since: nextSince,
      server_time: new Date().toISOString(),
    },
    200,
  );
}

async function handleTradingviewDeleted(admin: SupabaseClient, url: URL, client: ApiClient): Promise<Response> {
  if (!client.scopes.includes(TRADINGVIEW_SCOPE)) {
    return errorResponse(`Missing scope: ${TRADINGVIEW_SCOPE}`, "forbidden", 403);
  }

  const sinceRaw = url.searchParams.get("since");
  const cursorRaw = url.searchParams.get("cursor");
  const limit = parseLimit(url.searchParams.get("limit"));

  if (sinceRaw && Number.isNaN(Date.parse(sinceRaw))) {
    return errorResponse("`since` must be an ISO 8601 timestamp", "bad_request", 400);
  }
  const cursorResult = parseCursor(cursorRaw);
  if ("error" in cursorResult) return cursorResult.error;
  const cursor = cursorResult.cursor;

  const { data, error } = await admin.rpc("crm_deleted_tv_page", {
    p_since: cursor ? null : sinceRaw,
    p_after_at: cursor?.at ?? null,
    p_after_id: cursor?.id ? Number(cursor.id) : null,
    p_limit: limit,
  });
  if (error) {
    console.error("crm-customers: crm_deleted_tv_page failed", error);
    return errorResponse("Query failed", "unavailable", 503);
  }

  const rows = (data ?? []) as Array<{ id: number; deleted_at: string }>;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  let nextSince: string | null = null;
  if (!hasMore) {
    const candidateMs = last ? Date.parse(last.deleted_at) : Date.parse(sinceRaw ?? new Date().toISOString());
    nextSince = new Date(candidateMs - 60_000).toISOString();
  }

  return jsonResponse(
    {
      ok: true,
      resource: "deleted_tradingview",
      data: page,
      count: page.length,
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeCursor({ at: last.deleted_at, id: String(last.id) }) : null,
      next_since: nextSince,
      server_time: new Date().toISOString(),
    },
    200,
  );
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") {
    return errorResponse("Only GET is supported", "bad_request", 405);
  }

  const url = new URL(req.url);
  // Strip the function's own mount path so this works the same whether
  // Supabase forwards "/crm-customers/deleted" or just "/deleted".
  const path = url.pathname.replace(/^\/(functions\/v1\/)?crm-customers/, "");

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const authResult = await authenticate(admin, req.headers.get("authorization"));
  if ("error" in authResult) return authResult.error;
  const { client } = authResult;

  const rateLimitError = await enforceRateLimit(admin, client.id);
  if (rateLimitError) return rateLimitError;

  // Best-effort bookkeeping — never block the response on this.
  admin
    .from("api_clients")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", client.id)
    .then(({ error }) => {
      if (error) console.error("crm-customers: last_used_at update failed", error);
    });

  if (path === "" || path === "/") {
    return handleCustomers(admin, url, client);
  }
  if (path === "/deleted") {
    return handleDeleted(admin, url, client);
  }
  if (path === "/tradingview") {
    return handleTradingview(admin, url, client);
  }
  if (path === "/tradingview/deleted") {
    return handleTradingviewDeleted(admin, url, client);
  }
  return errorResponse("Unknown resource", "not_found", 404);
});
