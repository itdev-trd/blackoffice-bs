// Common server-side guardrails for Supabase Edge Functions.
// These are intentionally dependency-free so every function can use them.

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cache-Control": "no-store",
};

export class RequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "bad_request") {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.code = code;
  }
}

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

export function errorResponse(error: unknown, extraHeaders: HeadersInit = {}): Response {
  const status = error instanceof RequestError ? error.status : 500;
  const code = error instanceof RequestError ? error.code : "internal_error";
  const message = error instanceof RequestError ? error.message : "เกิดข้อผิดพลาดภายในระบบ";
  if (status >= 500) console.error(error);
  return jsonResponse({ ok: false, error: message, code }, status, extraHeaders);
}

/** Read JSON with a hard byte limit. Never call req.json() directly on public endpoints. */
export async function readJsonBody<T = Record<string, unknown>>(
  req: Request,
  maxBytes = 256 * 1024,
): Promise<T> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RequestError(413, "ข้อมูลคำขอมีขนาดใหญ่เกินไป", "payload_too_large");
  }

  const raw = await req.arrayBuffer();
  if (raw.byteLength > maxBytes) {
    throw new RequestError(413, "ข้อมูลคำขอมีขนาดใหญ่เกินไป", "payload_too_large");
  }
  if (raw.byteLength === 0) return {} as T;

  try {
    return JSON.parse(new TextDecoder().decode(raw)) as T;
  } catch {
    throw new RequestError(400, "รูปแบบ JSON ไม่ถูกต้อง", "invalid_json");
  }
}

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let lastCleanup = 0;
const MAX_BUCKETS = 10_000;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Number(Deno.env.get(name));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

/** Process-local limiter. Supabase Edge instances are short-lived, so keep it bounded and cheap. */
export function checkRateLimit(
  key: string,
  options: { limit?: number; windowSeconds?: number } = {},
): { ok: true } | { ok: false; retryAfter: number } {
  const windowSeconds = options.windowSeconds ?? envInt("APP_RATE_LIMIT_WINDOW_SECONDS", 60, 10, 3600);
  const limit = options.limit ?? envInt("APP_RATE_LIMIT_PER_MINUTE", 120, 10, 2000);
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  let current = buckets.get(key);

  if (now - lastCleanup > windowMs) {
    lastCleanup = now;
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }

  // Bound memory even when an attacker rotates source IPs/identities faster
  // than the normal expiry cleanup. Evict oldest buckets first; this keeps the
  // limiter cheap and prevents request-key cardinality from becoming a DoS.
  if (buckets.size >= MAX_BUCKETS) {
    for (const [k, b] of buckets) {
      if (b.resetAt <= now || buckets.size >= MAX_BUCKETS) buckets.delete(k);
      if (buckets.size < MAX_BUCKETS * 0.9) break;
    }
    current = buckets.get(key);
  }

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (current.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { ok: true };
}

export function requestClientKey(req: Request, identity: string): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || req.headers.get("x-real-ip") || "unknown";
  return `${new URL(req.url).pathname}:${identity}:${ip}`;
}
