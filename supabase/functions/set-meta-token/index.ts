// supabase/functions/set-meta-token/index.ts
// ตั้ง/ต่ออายุ META access token จากหน้าเว็บแอป (ต้องล็อกอิน)
//   action "save"   -> ตรวจสอบ token กับ Meta แล้วบันทึกลง app_secrets (ถ้าใช้ได้)
//   action "status" -> เช็คสถานะ token ปัจจุบัน (ใช้ได้ไหม/หมดอายุเมื่อไหร่/ชื่อเจ้าของ) โดยไม่คืนค่า token ออกมา
//   action "app_status" / "save_app" -> ดู/ตั้ง App ID + App Secret ของ Meta app (ใช้ตรวจลายเซ็น webhook
//     และสร้าง app token สำหรับตั้ง callback URL) — ค่าที่บันทึกไม่เคยถูกส่งกลับหน้าเว็บ
// token ถูกเก็บในตารางที่ฝั่ง client อ่านไม่ได้ (ดู migration app-secrets)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaAppId, getMetaAppSecret, getMetaToken } from "../_shared/meta.ts";
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
    const appId = await getMetaAppId();
    const appSecret = await getMetaAppSecret();
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
    const action = ["status", "app_status", "save_app"].includes(String(body.action)) ? String(body.action) : "save";

    // ---------- App ID / App Secret ของ Meta app ----------
    // ตรวจโดยขอ app access token (`{app_id}|{app_secret}`) ไปอ่านข้อมูลแอปตัวเอง
    // ถ้า secret ไม่ตรงกับ app id Meta จะตอบ error ทันที = รู้ผลก่อนบันทึก
    const appInfo = async (appId: string, appSecret: string) => {
      const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${appId}?fields=id,name&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`)
        .then((res) => res.json()).catch(() => ({ error: { message: "เรียก Meta ไม่สำเร็จ" } }));
      return r?.error ? { valid: false, error: r.error.error_user_msg || r.error.message } : { valid: true, name: r?.name ?? null, id: r?.id ?? appId };
    };
    const maskTail = (v: string) => (v.length > 4 ? `••••${v.slice(-4)}` : "••••");

    if (action === "app_status") {
      const [appId, appSecret] = await Promise.all([getMetaAppId(), getMetaAppSecret()]);
      const { data: rows } = await admin.from("app_secrets").select("key, updated_at").in("key", ["meta_app_id", "meta_app_secret"]);
      const byKey: Record<string, any> = {};
      for (const row of rows ?? []) byKey[row.key] = row;
      const checked = appId && appSecret ? await appInfo(appId, appSecret) : null;
      return new Response(JSON.stringify({
        ok: true,
        app_id: appId || null,
        app_id_source: byKey.meta_app_id ? "db" : (Deno.env.get("META_APP_ID") ? "env" : null),
        has_app_secret: !!appSecret,
        app_secret_source: byKey.meta_app_secret ? "db" : (Deno.env.get("META_APP_SECRET") ? "env" : null),
        app_secret_masked: appSecret ? maskTail(appSecret) : null,
        updated_at: byKey.meta_app_secret?.updated_at ?? null,
        valid: checked?.valid ?? null,
        app_name: checked?.valid ? checked.name : null,
        error: checked && !checked.valid ? checked.error : null,
      }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    if (action === "save_app") {
      const appSecret = String(body.app_secret || "").trim();
      if (!appSecret) throw new Error("กรุณาวาง App Secret");
      if (!/^[A-Za-z0-9]{16,64}$/.test(appSecret)) throw new Error("App Secret ต้องเป็นตัวอักษร/ตัวเลขล้วน (คัดลอกจาก App settings → Basic)");
      // ไม่ระบุ App ID มา = ใช้ของที่เคยตั้งไว้ ไม่งั้นถามจาก token ปัจจุบันว่าออกโดยแอปไหน
      let appId = String(body.app_id || "").trim();
      if (appId && !/^\d{10,20}$/.test(appId)) throw new Error("App ID ต้องเป็นตัวเลขล้วน");
      if (!appId) appId = await getMetaAppId();
      if (!appId) {
        const token = await getMetaToken();
        if (token) {
          const dbg = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/debug_token?input_token=${token}&access_token=${token}`)
            .then((r) => r.json()).catch(() => ({}));
          appId = dbg?.data?.app_id ? String(dbg.data.app_id) : "";
        }
      }
      if (!appId) throw new Error("ไม่รู้ว่าเป็นแอปไหน — กรุณากรอก App ID ด้วย");

      const checked = await appInfo(appId, appSecret);
      // force = ยืนยันบันทึกทั้งที่ Meta ยังตอบ error (เช่นกำลังสลับแอปแล้ว token เดิมยังเป็นของอีกแอป)
      if (!checked.valid && body.force !== true) {
        return new Response(JSON.stringify({ ok: false, error: `App Secret ใช้กับ App ID ${appId} ไม่ได้: ${checked.error}`, app_id: appId, can_force: true }),
          { headers: { ...corsHeaders, "content-type": "application/json" } });
      }
      const nowIso = new Date().toISOString();
      await admin.from("app_secrets").upsert([
        { key: "meta_app_id", value: appId, updated_at: nowIso },
        { key: "meta_app_secret", value: appSecret, updated_at: nowIso },
      ]);
      return new Response(JSON.stringify({ ok: true, saved: true, app_id: appId, app_name: checked.valid ? checked.name : null, unverified: !checked.valid, error: checked.valid ? null : checked.error }),
        { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

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
