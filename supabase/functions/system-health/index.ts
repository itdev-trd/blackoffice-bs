// supabase/functions/system-health/index.ts
// ตรวจสุขภาพระบบ — สิ่งที่ถ้าพังแล้วไม่มีใครรู้จนลูกค้าบ่นหรือแอดมินล็อกอินไม่ได้
//   { action: "status" }        -> ผลตรวจล่าสุดที่เก็บไว้ (ไม่ยิงอะไรออกไป)
//   { action: "check" }         -> ตรวจใหม่ตอนนี้ + เก็บผล
//   (cron ทุกชั่วโมง, service)  -> ตรวจ + ส่ง push หา owner เฉพาะรายการที่ "เพิ่งแย่ลง"
// หน้าเว็บเรียกได้เฉพาะ owner
//
// ที่มาของแต่ละข้อ (เจอจริงทั้งหมด):
//   · token ตอบแชทยืมของแอปอื่น หมดอายุ 4 พ.ย. 69 — หมดแล้วตอบลูกค้าไม่ได้ทั้งหมด
//   · คุกกี้ TradingView หมดอายุ = ให้สิทธิ์ TV ไม่ได้
//   · ซิงก์แชทหยุด (ตอนโปรเจกต์โดนระงับ ไม่มีใครรู้ 4 ชม.)
//   · งาน cron ล้ม (retention เคยส่งคำสั่งผิดจนไม่เคยทำงานเลย)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";
import { getMetaAppId, getMetaAppSecret, getMetaToken } from "../_shared/meta.ts";
import { tvCheckAccess } from "../_shared/tradingview-direct.ts";
import { expiryStatus, worsened, overall, type HealthCheck } from "../_shared/health-rules.ts";

const GRAPH = "https://graph.facebook.com/v22.0";
const STATE_KEY = "system_health";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });
const getJson = (url: string) => fetch(url, { signal: AbortSignal.timeout(15_000) }).then((r) => r.json()).catch((e) => ({ error: { message: String(e?.message || e) } }));
const thDate = (sec: number) => new Date(sec * 1000).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });

// token หมดอายุได้ 2 แบบ: expires_at (ตัว token) และ data_access_expires_at (สิทธิ์อ่านข้อมูล 90 วัน)
// เอาอันที่ใกล้กว่า — token ตอบแชทที่ยืมมาจะดับที่ data_access_expires_at
function nearestExpiry(d: any): number {
  const xs = [Number(d?.expires_at || 0), Number(d?.data_access_expires_at || 0)].filter((x) => x > 0);
  return xs.length ? Math.min(...xs) : 0;
}

async function checkToken(key: string, label: string, token: string, debugWith: string): Promise<HealthCheck> {
  if (!token) return { key, label, status: "error", detail: "ยังไม่ได้ตั้ง token" };
  const me = await getJson(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
  if (me?.error) return { key, label, status: "error", detail: `ใช้ไม่ได้: ${me.error.message}` };
  const dbg = await getJson(`${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(debugWith)}`);
  const exp = nearestExpiry(dbg?.data);
  const { status, days_left } = expiryStatus(exp);
  const who = me?.name ? ` · ${me.name}` : "";
  return {
    key, label, status, days_left,
    detail: exp ? `หมดอายุ ${thDate(exp)} (อีก ${days_left} วัน)${who}` : `ใช้งานได้ ไม่มีวันหมดอายุ${who}`,
  };
}

async function runChecks(admin: any): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];
  const secret = async (k: string) => String((await admin.from("app_secrets").select("value").eq("key", k).maybeSingle()).data?.value || "");

  // 1) token หลัก (โฆษณา/รายงาน/อ่านแชท) — ตรวจด้วย app token ของแอปเรา
  const mainToken = await getMetaToken();
  const [appId, appSecret] = await Promise.all([getMetaAppId(), getMetaAppSecret()]);
  checks.push(await checkToken("meta_main", "Meta token หลัก (โฆษณา/ซิงก์แชท)", mainToken, appId && appSecret ? `${appId}|${appSecret}` : mainToken));

  // 2) token ตอบแชท — ของแอปอื่น ตรวจด้วยตัวมันเอง (app token ของเราอ่าน token แอปอื่นไม่ได้)
  const msgToken = await secret("meta_messaging_token");
  if (msgToken) checks.push(await checkToken("meta_messaging", "Meta token ตอบแชท Messenger", msgToken, msgToken));

  // 3) คุกกี้ TradingView ของทุกแบรนด์ที่เปิดใช้ — ถามรายชื่อสิทธิ์ด้วย username สมมติ 1 คำขอ
  const { data: brands } = await admin.from("tv_brands").select("id, name").eq("active", true);
  for (const b of brands ?? []) {
    const key = `tv_cookie_${b.id}`;
    const label = `คุกกี้ TradingView · ${b.name}`;
    let cookie: any = {};
    try { cookie = JSON.parse(await secret(key) || "{}"); } catch { cookie = {}; }
    if (!cookie.sessionid) { checks.push({ key, label, status: "error", detail: "ยังไม่ได้ใส่คุกกี้" }); continue; }
    const { data: pine } = await admin.from("tv_scripts").select("pine_id").eq("brand_id", b.id).limit(1).maybeSingle();
    if (!pine?.pine_id) { checks.push({ key, label, status: "warn", detail: "แบรนด์นี้ยังไม่มีสคริปต์ให้ใช้ทดสอบ" }); continue; }
    const r = await tvCheckAccess("__health_check__", String(pine.pine_id), cookie);
    checks.push(r.ok
      ? { key, label, status: "ok", detail: "ล็อกอินอยู่ ใช้ให้สิทธิ์ได้" }
      : { key, label, status: "error", detail: String(r.error || "เรียก TradingView ไม่สำเร็จ") });
  }

  // 4) ซิงก์แชท Messenger ยังเดินไหม — cron recent เรียกทุกนาที ประทับเวลาไว้ต่อเพจ
  const { data: recent } = await admin.from("settings").select("value").eq("key", "messenger_recent_sync").maybeSingle();
  const stamps = Object.values(recent?.value?.last_by_page || {}).map((v) => Date.parse(String(v))).filter(Number.isFinite) as number[];
  const lastSync = stamps.length ? Math.max(...stamps) : 0;
  const mins = lastSync ? Math.round((Date.now() - lastSync) / 60000) : null;
  checks.push({
    key: "chat_sync", label: "ซิงก์แชท Messenger",
    status: mins === null || mins > 15 ? "error" : mins > 5 ? "warn" : "ok",
    detail: mins === null ? "ยังไม่เคยซิงก์" : `ซิงก์ล่าสุด ${mins} นาทีที่แล้ว`,
  });

  // 5) งานตั้งเวลา (cron) ที่ล้มใน 24 ชม. — อ่านผ่าน RPC เพราะ schema cron เรียกจาก API ตรงไม่ได้
  const { data: jobs, error: jobErr } = await admin.rpc("admin_cron_health");
  if (jobErr) {
    checks.push({ key: "cron", label: "งานตั้งเวลา (cron)", status: "warn", detail: `อ่านสถานะไม่ได้: ${jobErr.message}` });
  } else {
    const bad = (jobs ?? []).filter((j: any) => Number(j.failed_24h) > 0 || j.active === false);
    checks.push({
      key: "cron", label: "งานตั้งเวลา (cron)",
      status: bad.some((j: any) => j.last_status === "failed") ? "error" : bad.length ? "warn" : "ok",
      detail: bad.length
        ? bad.map((j: any) => `${j.jobname}: ${j.active === false ? "ปิดอยู่" : `ล้ม ${j.failed_24h} ครั้ง/24 ชม.`}`).join(" · ")
        : `ทำงานปกติทั้ง ${(jobs ?? []).length} งาน`,
    });
  }
  return checks;
}

async function notifyOwners(problems: HealthCheck[]) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || !problems.length) return;
  const title = problems.some((p) => p.status === "error") ? "⚠️ ระบบมีปัญหา" : "🔔 ระบบใกล้มีปัญหา";
  const body = problems.map((p) => `${p.label}: ${p.detail}`).join("\n").slice(0, 300);
  await fetch(`${url}/functions/v1/send-push`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ action: "notify_owner", title, body, url: "/settings?section=health", tag: "system-health" }),
  }).catch(() => null);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { owner: true, allowService: true });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const body = await readJsonBody(req, 16 * 1024).catch(() => ({})) as Record<string, any>;
    const action = String(body?.action || (auth.isService ? "cron" : "status"));
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: stRow } = await admin.from("settings").select("value").eq("key", STATE_KEY).maybeSingle();
    const prev = stRow?.value || null;

    if (action === "status") return json({ ok: true, ...(prev || { checks: [], checked_at: null }) });
    if (action !== "check" && action !== "cron") return json({ ok: false, error: `ไม่รู้จัก action "${action}"` }, 400);

    const checks = await runChecks(admin);
    const nowIso = new Date().toISOString();
    // แจ้งเฉพาะที่เพิ่งแย่ลง · ถ้ายังพังค้างอยู่ เตือนซ้ำวันละครั้ง ไม่ใช่ทุกชั่วโมง
    let toNotify = worsened(prev?.checks, checks);
    const lastNotified = Date.parse(String(prev?.notified_at || "")) || 0;
    if (!toNotify.length && Date.now() - lastNotified > 24 * 3600 * 1000) toNotify = checks.filter((c) => c.status === "error");
    const shouldNotify = action === "cron" && toNotify.length > 0;
    if (shouldNotify) await notifyOwners(toNotify);
    const value = { checked_at: nowIso, overall: overall(checks), checks, notified_at: shouldNotify ? nowIso : (prev?.notified_at ?? null) };
    await admin.from("settings").upsert({ key: STATE_KEY, value, updated_at: nowIso });
    return json({ ok: true, ...value, notified: shouldNotify ? toNotify.map((c) => c.key) : [] });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
