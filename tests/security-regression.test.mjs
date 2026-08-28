import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("shared authorization is fail-closed and rate limited", () => {
  const permissions = read("supabase/functions/_shared/permissions.ts");
  assert.match(permissions, /if \(!permission\) return \{ ok: false, status: 403/);
  assert.match(permissions, /checkRateLimit\(/);
  assert.match(permissions, /preAuthLimit/);
  assert.match(permissions, /APP_MAX_REQUEST_BYTES/);
  assert.match(permissions, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("request body limits and security headers exist", () => {
  const security = read("supabase/functions/_shared/security.ts");
  assert.match(security, /X-Content-Type-Options/);
  assert.match(security, /payload_too_large/);
  assert.match(security, /raw\.byteLength > maxBytes/);
});

test("signed webhooks remain signature verified", () => {
  const meta = read("supabase/functions/meta-webhook/index.ts");
  const line = read("supabase/functions/line-webhook/index.ts");
  assert.match(meta, /x-hub-signature-256/i);
  assert.match(meta, /META_APP_SECRET/);
  assert.match(line, /x-line-signature/i);
  assert.match(line, /getLineConfig/);
  assert.match(read("supabase/functions/_shared/line.ts"), /LINE_CHANNEL_SECRET/);
});

test("server-owned tables are protected by the security migration", () => {
  const migration = read("supabase/migrations/20260825120000_security_hardening_v2.sql");
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /app_secrets/);
  assert.match(migration, /revoke all on table/);
});

test("browser bundle does not contain service-role or provider secret names", () => {
  const app = read("ai-ads-app.jsx");
  assert.doesNotMatch(app, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(app, /OPENAI_API_KEY/);
  assert.doesNotMatch(app, /ANTHROPIC_API_KEY/);
});
