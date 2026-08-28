// supabase/functions/set-meta-token/index.ts
// ตั้ง/ต่ออายุ META access token จากหน้าเว็บแอป (ต้องล็อกอิน)
//   action "save"   -> ตรวจสอบ token กับ Meta แล้วบันทึกลง app_secrets (ถ้าใช้ได้)
//   action "status" -> เช็คสถานะ token ปัจจุบัน (ใช้ได้ไหม/หมดอายุเมื่อไหร่/ชื่อเจ้าของ) โดยไม่คืนค่า token ออกมา
// token ถูกเก็บในตารางที่ฝั่ง client อ่านไม่ได้ (ดู migration app-secrets)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { authorizeRequest } from "../_shared/permissions.ts";

const GRAPH_VERSION = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ตรวจ token กับ Meta: คืนชื่อเจ้าของ + จำนวนบัญชีที่เห็น + วันหมดอายุ (ถ้าดูได้)
async function inspectToken(token: string) {
  const me = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me?fields=id,name&access_token=${token}`).then((r) => r.json());
  if (me?.error) return { valid: false, error: me.error.message };
  const acc = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/adaccounts?limit=1&access_token=${token}`).then((r) => r.json());
  // debug_token ต้องใช้ app token — ดึงวันหมดอายุ + "สิทธิ์ที่ token นี้มี" แบบ best-effort
  let expires_at: number | null = null;
  let scopes: string[] = [];
  try {
    const appId = Deno.env.get("META_APP_ID");
    const appSecret = Deno.env.get("META_APP_SECRET");
    if (appId && appSecret) {
      const dbg = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/debug_token?input_token=${token}&access_token=${appId}|${appSecret}`
      ).then((r) => r.json());
      expires_at = dbg?.data?.expires_at ?? null;
      scopes = Array.isArray(dbg?.data?.scopes) ? dbg.data.scopes : [];
    }
  } catch (_e) { /* ไม่บังคับ */ }
  // สิทธิ์ที่ระบบนี้ต้องใช้ — โชว์ให้เห็นว่าขาดตัวไหน (page_events จำเป็นสำหรับ Conversion Leads)
  const NEEDED = ["pages_show_list", "pages_messaging", "instagram_basic", "instagram_manage_messages", "page_events", "ads_management", "ads_read"];
  const missing = scopes.length ? NEEDED.filter((s) => !scopes.includes(s)) : [];
  return { valid: true, name: me.name, id: me.id, can_see_adaccounts: !acc?.error, expires_at, scopes, missing_scopes: missing };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { admin: true, setting: "meta" });
    if (!auth.ok) {
      return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const action = body.action === "status" ? "status" : "save";

    if (action === "status") {
      const current = await getMetaToken();
      if (!current) {
        return new Response(JSON.stringify({ ok: true, has_token: false }), { headers: { ...corsHeaders, "content-type": "application/json" } });
      }
      const info = await inspectToken(current);
      // ดูว่ามาจาก DB หรือ env
      const { data: row } = await admin.from("app_secrets").select("updated_at").eq("key", "meta_access_token").maybeSingle();
      return new Response(
        JSON.stringify({ ok: true, has_token: true, source: row ? "db" : "env", updated_at: row?.updated_at ?? null, ...info }),
        { headers: { ...corsHeaders, "content-type": "application/json" } }
      );
    }

    // save
    const token = String(body.token || "").trim();
    if (!token) throw new Error("กรุณาวาง token");
    const info = await inspectToken(token);
    if (!info.valid) throw new Error(`token ใช้ไม่ได้: ${info.error || "ไม่ทราบสาเหตุ"}`);

    await admin.from("app_secrets").upsert({ key: "meta_access_token", value: token, updated_at: new Date().toISOString() });

    return new Response(JSON.stringify({ ok: true, saved: true, ...info }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
});
