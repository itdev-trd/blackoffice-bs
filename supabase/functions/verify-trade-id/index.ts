// supabase/functions/verify-trade-id/index.ts
// เช็คเลขไอดีเทรด (XM) แบบแมนวลให้พนักงานใช้ในหน้าตอบแชท — ยิงผ่าน edge function เพื่อเลี่ยง CORS + กันสิทธิ์
// ลำดับ: เช็ค "API" (api.trdapi.com) ก่อนเสมอ → ถ้าไม่ผ่าน ค่อยเช็ค "อีเมล" (ai.traderider.com)
//   • API ผ่าน   → { pass:true, via:"api" }
//   • อีเมลผ่าน  → { pass:true, via:"email", platform, insertdate }
//   • ไม่ผ่านทั้งคู่ → { pass:false }
import { authorizeRequest } from "../_shared/permissions.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API_URL = "https://api.trdapi.com/webhook/verify-trade-id";
const EMAIL_URL = "https://ai.traderider.com/webhook/verify-xm";
const BROKER = "xm";
const TIMEOUT_MS = 12000;
const FAIL_TTL_MS = 10 * 60 * 1000;   // cache ผล "ไม่ผ่าน" สั้นๆ เผื่อลูกค้าเพิ่งสมัคร (ผล "ผ่าน" เก็บถาวร)

let _admin: any = null;
const admin = () => (_admin ??= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const fetchTimeout = (url: string, init: RequestInit = {}) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    // ต้องล็อกอิน + มีสิทธิ์ใช้งาน (fail-closed) — ใครเข้าหน้าตอบแชทได้ก็ใช้ได้
    const auth = await authorizeRequest(req);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const body = await req.json().catch(() => ({}));
    const tradeId = String(body?.trade_id ?? "").trim();
    if (!tradeId) return json({ ok: false, error: "กรุณาระบุเลขไอดีเทรด" }, 400);

    // 0) cache — ผล "ผ่าน" เก็บถาวร, ผล "ไม่ผ่าน" ใช้ได้ชั่วคราว (FAIL_TTL_MS)
    try {
      const { data: c } = await admin().from("trade_id_cache").select("pass, via, platform, insertdate, checked_at").eq("trade_id", tradeId).maybeSingle();
      if (c?.pass) return json({ ok: true, pass: true, via: c.via || "cache", trade_id: tradeId, platform: c.platform || null, insertdate: c.insertdate || null, cached: true });
      if (c && c.pass === false && c.checked_at && Date.now() - new Date(c.checked_at).getTime() < FAIL_TTL_MS) {
        return json({ ok: true, pass: false, trade_id: tradeId, cached: true });
      }
    } catch { /* cache พลาด = เช็คสด */ }

    const notes: string[] = [];
    const saveCache = (row: Record<string, unknown>) => admin().from("trade_id_cache").upsert({ trade_id: tradeId, checked_at: new Date().toISOString(), ...row }).then(() => {}, () => {});

    // 1) API — เช็คก่อนเสมอ (result === "pass" = ผ่าน)
    try {
      const r = await fetchTimeout(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ broker: BROKER, trade_id: tradeId }),
      });
      const j = await r.json().catch(() => ({}));
      if (String(j?.result ?? "").toLowerCase() === "pass") {
        await saveCache({ pass: true, via: "api", platform: null, insertdate: null });
        return json({ ok: true, pass: true, via: "api", trade_id: tradeId });
      }
    } catch (e) {
      notes.push(`API: ${String(e instanceof Error ? e.message : e)}`);
    }

    // 2) อีเมล — เช็คต่อเมื่อ API ไม่ผ่าน (verified === "pass" = ผ่าน)
    try {
      const r = await fetchTimeout(`${EMAIL_URL}?trade_id=${encodeURIComponent(tradeId)}`);
      const j = await r.json().catch(() => ({}));
      if (String(j?.verified ?? "").toLowerCase() === "pass") {
        await saveCache({ pass: true, via: "email", platform: j?.platform || null, insertdate: j?.insertdate || null });
        return json({ ok: true, pass: true, via: "email", trade_id: tradeId, platform: j?.platform || null, insertdate: j?.insertdate || null });
      }
    } catch (e) {
      notes.push(`Email: ${String(e instanceof Error ? e.message : e)}`);
    }

    // ไม่ผ่านทั้งสองช่องทาง — cache แบบ TTL สั้น (ยกเว้นตอน external ล่ม จะไม่ cache กันจำผลผิด)
    if (!notes.length) await saveCache({ pass: false, via: null, platform: null, insertdate: null });
    return json({ ok: true, pass: false, trade_id: tradeId, ...(notes.length ? { note: notes.join(" · ") } : {}) });
  } catch (err) {
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
