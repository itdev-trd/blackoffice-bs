// supabase/functions/log-activity/index.ts
// บันทึก 1 กิจกรรมของผู้ใช้ปัจจุบัน (login/logout/action) พร้อม IP, ตำแหน่ง, device
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { errorResponse, readJsonBody } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseDevice(ua: string): string {
  if (!ua) return "ไม่ทราบ";
  const os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "อื่นๆ";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "เบราว์เซอร์";
  return `${br} · ${os}`;
}

async function geoLookup(ip: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const resp = await fetch(`https://ipwho.is/${ip}?fields=success,city,country`, { signal: ctrl.signal });
    clearTimeout(t);
    const d = await resp.json();
    if (d?.success) return [d.city, d.country].filter(Boolean).join(", ") || null;
  } catch (_e) { /* best-effort */ }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req);
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });

    const body = await readJsonBody(req, 32 * 1024);
    const event = String(body?.event || "event").slice(0, 60);
    const detail = body?.detail ?? null;
    const ua = String(body?.user_agent || req.headers.get("user-agent") || "").slice(0, 400);
    const deviceId = body?.device_id ? String(body.device_id).slice(0, 60) : null; // id ประจำเบราว์เซอร์ (นับจำนวนเครื่องได้)
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    const location = ip ? await geoLookup(ip) : null;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await admin.from("activity_log").insert({
      email: auth.user?.email, event, detail, ip, location, user_agent: ua, device: parseDevice(ua), device_id: deviceId,
    });
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
