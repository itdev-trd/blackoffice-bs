// supabase/functions/set-meta-token/index.ts
// ตั้ง/ต่ออายุ META access token จากหน้าเว็บแอป (ต้องล็อกอิน)
//   action "save"   -> ตรวจสอบ token กับ Meta แล้วบันทึกลง app_secrets (ถ้าใช้ได้)
//   action "status" -> เช็คสถานะ token ปัจจุบัน (ใช้ได้ไหม/หมดอายุเมื่อไหร่/ชื่อเจ้าของ) โดยไม่คืนค่า token ออกมา
//   action "ad_library_status" / "save_ad_library" -> ดู/ตั้ง token แยกสำหรับค้น Ad Library (ดูโฆษณาคู่แข่ง)
//   action "app_status" / "save_app" -> ดู/ตั้ง App ID + App Secret ของ Meta app (ใช้ตรวจลายเซ็น webhook
//     และสร้าง app token สำหรับตั้ง callback URL) — ค่าที่บันทึกไม่เคยถูกส่งกลับหน้าเว็บ
// token ถูกเก็บในตารางที่ฝั่ง client อ่านไม่ได้ (ดู migration app-secrets)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ACCOUNT_TOKEN_MAP_KEY, AD_LIBRARY_TOKEN_KEY, EXTRA_TOKENS_KEY, MESSAGING_PAGES_CACHE_KEY, WEBHOOK_VERIFY_TOKEN_KEY, getMessagingAppCreds, getMetaAppId, getMetaAppSecret, getMetaToken } from "../_shared/meta.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";

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

// ตรวจ token ที่จะใช้ "ตอบแชท" — ต้องรู้ว่ามาจากแอปไหน เพราะระดับสิทธิ์ผูกกับแอปนั้น
// debug_token ใช้ตัว token เองเป็น access_token ได้ จึงตรวจ token ของแอปอื่นได้ด้วย
// (ต่างจาก inspectToken ที่ใช้ app token ของแอปเรา ซึ่งอ่าน token ของแอปอื่นไม่ได้)
async function inspectMessagingToken(token: string) {
  const me = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me?fields=id,name&access_token=${token}`).then((r) => r.json());
  if (me?.error) return { valid: false, error: me.error.message };
  let app_id: string | null = null;
  let app_name: string | null = null;
  let scopes: string[] = [];
  let token_type: string | null = null;
  let expires_at: number | null = null;
  try {
    const dbg = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/debug_token?input_token=${token}&access_token=${token}`
    ).then((r) => r.json());
    app_id = dbg?.data?.app_id ? String(dbg.data.app_id) : null;
    app_name = dbg?.data?.application ? String(dbg.data.application) : null;
    scopes = Array.isArray(dbg?.data?.scopes) ? dbg.data.scopes : [];
    token_type = dbg?.data?.type ? String(dbg.data.type) : null;
    expires_at = dbg?.data?.expires_at ?? null;
  } catch (_e) { /* best-effort */ }
  // เพจที่ token นี้ตอบแชทได้จริง (ต้องมี pages_messaging และเห็นเพจนั้น)
  const pg = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=id,name&limit=25&access_token=${token}`).then((r) => r.json());
  const pages = Array.isArray(pg?.data) ? pg.data.map((x: any) => ({ id: String(x.id), name: String(x.name || x.id) })) : [];
  return {
    valid: true, name: me?.name || null, app_id, app_name, token_type, expires_at, scopes, pages,
    has_messaging: scopes.length ? scopes.includes("pages_messaging") : null,
  };
}

// ตรวจ token ที่จะใช้ "ค้น Ad Library" — ต้องยิง /ads_archive จริงถึงจะรู้ว่าใช้ได้
//
// เช็คแค่ scopes ไม่พอ: ads_read ติ๊กมาครบก็ยังถูกปฏิเสธได้ เพราะ Meta ผูกสิทธิ์ตัวนี้กับ
// "คนที่ยืนยันตัวตนแล้ว" (facebook.com/ID + ลงทะเบียนที่ facebook.com/ads/library/api)
// ไม่ใช่กับแอปหรือธุรกิจ — และ System User token ไม่มีตัวตนให้ยืนยัน จึงผ่านไม่ได้เลย
// ยิงคำค้นทดสอบ 1 ครั้ง (limit=1) แล้วบอกผลตรง ๆ ดีกว่าให้ผู้ใช้ไปเจอ error ที่หน้าค้นหา
async function inspectAdLibraryToken(token: string) {
  const me = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me?fields=id,name&access_token=${token}`).then((r) => r.json());
  if (me?.error) return { valid: false, error: me.error.message };
  let app_id: string | null = null;
  let app_name: string | null = null;
  let token_type: string | null = null;
  let expires_at: number | null = null;
  let scopes: string[] = [];
  try {
    const dbg = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/debug_token?input_token=${token}&access_token=${token}`
    ).then((r) => r.json());
    app_id = dbg?.data?.app_id ? String(dbg.data.app_id) : null;
    app_name = dbg?.data?.application ? String(dbg.data.application) : null;
    token_type = dbg?.data?.type ? String(dbg.data.type) : null;
    expires_at = dbg?.data?.expires_at ?? null;
    scopes = Array.isArray(dbg?.data?.scopes) ? dbg.data.scopes : [];
  } catch (_e) { /* best-effort */ }
  // คำค้นทดสอบ: ต้องเป็นคำที่มีโฆษณาจริงในไทยแน่ ๆ ไม่งั้นแยกไม่ออกว่า "ไม่มีสิทธิ์" หรือ "ไม่มีผลลัพธ์"
  const probeUrl = `https://graph.facebook.com/${GRAPH_VERSION}/ads_archive`
    + `?search_terms=${encodeURIComponent("insurance")}`
    + `&ad_reached_countries=${encodeURIComponent('["TH"]')}`
    + `&ad_active_status=ALL&fields=id,page_name&limit=1&access_token=${encodeURIComponent(token)}`;
  const probe = await fetch(probeUrl).then((r) => r.json()).catch(() => ({ error: { message: "เรียก Meta ไม่สำเร็จ" } }));
  const probeError: string | null = probe?.error ? String(probe.error.error_user_msg || probe.error.message) : null;
  return {
    valid: true, name: me?.name || null, id: me?.id || null, app_id, app_name, token_type, expires_at, scopes,
    has_ads_read: scopes.length ? scopes.includes("ads_read") : null,
    can_search: !probeError,
    probe_error: probeError,
    probe_count: Array.isArray(probe?.data) ? probe.data.length : 0,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { admin: true, setting: "meta" });
    if (!auth.ok) {
      return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await readJsonBody(req, 64 * 1024).catch(() => ({})) as Record<string, any>;
    // รายชื่อนี้ต้องมี action ใหม่ทุกตัว ไม่งั้นคำขอจะตกไปเป็น "save"
    // (บั๊กที่เจอจริง: messaging_status/save_messaging ไม่ได้อยู่ในลิสต์ → token ที่วางในช่อง
    //  "ตอบแชท" ถูกบันทึกทับ token หลักแทน และหน้าเว็บโชว์ "แอป: ไม่ทราบ · เห็น 0 เพจ"
    //  เพราะได้ผลลัพธ์ของ action save ที่ไม่มีฟิลด์เหล่านั้น)
    // ห้ามเดา action ที่ไม่รู้จักเป็น "save": คำขอที่อ่าน body ไม่ได้ (เช่นหน้าตั้งค่ายิงสถานะพร้อมกัน 4 ตัว
    // แล้วมีตัวหนึ่งมาไม่ครบ) จะไปตกที่ save แล้วล้มเป็น 500 "กรุณาวาง token" — เจอจริงใน log
    const ACTIONS = ["save", "status", "app_status", "save_app", "messaging_status", "save_messaging", "ad_library_status", "save_ad_library", "messaging_app_status", "save_messaging_app", "extra_list", "extra_save", "extra_delete"];
    const action = String(body?.action || "");
    if (!ACTIONS.includes(action)) {
      return new Response(JSON.stringify({ ok: false, error: `ไม่รู้จัก action "${action}"` }), { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    // ---------- App ID / App Secret ของ Meta app ----------
    // ตรวจโดยขอ app access token (`{app_id}|{app_secret}`) ไปอ่านข้อมูลแอปตัวเอง
    // ถ้า secret ไม่ตรงกับ app id Meta จะตอบ error ทันที = รู้ผลก่อนบันทึก
    const appInfo = async (appId: string, appSecret: string) => {
      const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${appId}?fields=id,name&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`)
        .then((res) => res.json()).catch(() => ({ error: { message: "เรียก Meta ไม่สำเร็จ" } }));
      return r?.error ? { valid: false, error: r.error.error_user_msg || r.error.message } : { valid: true, name: r?.name ?? null, id: r?.id ?? appId };
    };
    const maskTail = (v: string) => (v.length > 4 ? `••••${v.slice(-4)}` : "••••");
    // เปลี่ยน token = ต้องล้างแคช page token ที่แลกมาจาก token เดิม (แคชอยู่ 24 ชม. และใช้แบบ stale ตอน Meta ล่มด้วย)
    // ไม่ล้าง = ระบบยังส่ง/อ่านด้วย page token ของแอปเดิมต่อไปอีกเป็นวัน ทั้งที่หน้าเว็บบอกว่าบันทึกแล้ว
    const clearPagesCache = (key: string) => admin.from("app_secrets").delete().eq("key", key);

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

    // ---- แอป Meta แยกสำหรับตอบแชท: App ID/Secret + ข้อมูลที่ต้องกรอกในหน้า Webhooks ของแอปนั้น ----
    // verify token สร้างให้ครั้งเดียวแล้วเก็บใน DB (meta-webhook รับทั้งตัวนี้และ META_VERIFY_TOKEN เดิม)
    if (action === "messaging_app_status") {
      const { appId, appSecret } = await getMessagingAppCreds();
      const { data: vt } = await admin.from("app_secrets").select("value").eq("key", WEBHOOK_VERIFY_TOKEN_KEY).maybeSingle();
      let verifyToken = String(vt?.value || "");
      if (!verifyToken) {
        verifyToken = "bs_" + Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
        await admin.from("app_secrets").upsert({ key: WEBHOOK_VERIFY_TOKEN_KEY, value: verifyToken, updated_at: new Date().toISOString() });
      }
      const checked = appId && appSecret ? await appInfo(appId, appSecret) : null;
      return new Response(JSON.stringify({
        ok: true, app_id: appId || null, has_app_secret: !!appSecret, app_secret_masked: appSecret ? maskTail(appSecret) : null,
        valid: checked?.valid ?? null, app_name: checked?.valid ? checked.name : null, error: checked && !checked.valid ? checked.error : null,
        callback_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/meta-webhook`, verify_token: verifyToken,
      }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }
    if (action === "save_messaging_app") {
      const appId = String(body.app_id || "").trim();
      const appSecret = String(body.app_secret || "").trim();
      if (!/^\d{10,20}$/.test(appId)) throw new Error("App ID ต้องเป็นตัวเลขล้วน");
      if (!/^[A-Za-z0-9]{16,64}$/.test(appSecret)) throw new Error("App Secret ต้องเป็นตัวอักษร/ตัวเลขล้วน (คัดลอกจาก App settings → Basic)");
      const checked = await appInfo(appId, appSecret);
      if (!checked.valid) throw new Error(`App Secret ใช้กับ App ID ${appId} ไม่ได้: ${checked.error}`);
      const nowIso = new Date().toISOString();
      await admin.from("app_secrets").upsert([
        { key: "meta_messaging_app_id", value: appId, updated_at: nowIso },
        { key: "meta_messaging_app_secret", value: appSecret, updated_at: nowIso },
      ]);
      return new Response(JSON.stringify({ ok: true, saved: true, app_id: appId, app_name: checked.name }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    // ---- token สำหรับตอบแชทโดยเฉพาะ (แยกจาก token หลักที่ใช้งานโฆษณา) ----
    if (action === "messaging_status") {
      const { data: row } = await admin.from("app_secrets").select("value, updated_at").eq("key", "meta_messaging_token").maybeSingle();
      const tok = String(row?.value || "").trim();
      if (!tok) return new Response(JSON.stringify({ ok: true, has_token: false }), { headers: { ...corsHeaders, "content-type": "application/json" } });
      const info = await inspectMessagingToken(tok);
      return new Response(JSON.stringify({ ok: true, has_token: true, updated_at: row?.updated_at ?? null, ...info }),
        { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    if (action === "save_messaging") {
      const tok = String(body.token || "").trim();
      // ส่งค่าว่างมา = เลิกใช้ token แยก กลับไปใช้ token หลัก
      if (!tok) {
        await admin.from("app_secrets").delete().eq("key", "meta_messaging_token");
        await clearPagesCache(MESSAGING_PAGES_CACHE_KEY);
        return new Response(JSON.stringify({ ok: true, cleared: true }), { headers: { ...corsHeaders, "content-type": "application/json" } });
      }
      const info = await inspectMessagingToken(tok);
      if (!info.valid) throw new Error(`token ใช้ไม่ได้: ${info.error || "ไม่ทราบสาเหตุ"}`);
      if (!info.pages?.length) throw new Error("token นี้ไม่เห็นเพจใดเลย (ต้องมีสิทธิ์ pages_show_list + pages_messaging และเป็นแอดมินเพจ)");
      await admin.from("app_secrets").upsert({ key: "meta_messaging_token", value: tok, updated_at: new Date().toISOString() });
      await clearPagesCache(MESSAGING_PAGES_CACHE_KEY);
      return new Response(JSON.stringify({ ok: true, saved: true, ...info }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    // ---- token สำหรับค้น Ad Library โดยเฉพาะ (แยกจาก token หลักที่เป็น System User) ----
    if (action === "ad_library_status") {
      const { data: row } = await admin.from("app_secrets").select("value, updated_at").eq("key", AD_LIBRARY_TOKEN_KEY).maybeSingle();
      const tok = String(row?.value || "").trim();
      if (!tok) return new Response(JSON.stringify({ ok: true, has_token: false }), { headers: { ...corsHeaders, "content-type": "application/json" } });
      const info = await inspectAdLibraryToken(tok);
      return new Response(JSON.stringify({ ok: true, has_token: true, updated_at: row?.updated_at ?? null, ...info }),
        { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    if (action === "save_ad_library") {
      const tok = String(body.token || "").trim();
      // ส่งค่าว่างมา = เลิกใช้ token แยก กลับไปใช้ token หลัก
      if (!tok) {
        await admin.from("app_secrets").delete().eq("key", AD_LIBRARY_TOKEN_KEY);
        return new Response(JSON.stringify({ ok: true, cleared: true }), { headers: { ...corsHeaders, "content-type": "application/json" } });
      }
      const info = await inspectAdLibraryToken(tok);
      if (!info.valid) throw new Error(`token ใช้ไม่ได้: ${info.error || "ไม่ทราบสาเหตุ"}`);
      // ค้นไม่ได้แต่ยังให้บันทึกได้ (force) เพราะบางทีสิทธิ์เพิ่งอนุมัติแล้วยังไม่มีผลทันที
      if (!info.can_search && body.force !== true) {
        return new Response(JSON.stringify({ ok: false, error: `token นี้ยังค้น Ad Library ไม่ได้: ${info.probe_error}`, can_force: true, ...info }),
          { headers: { ...corsHeaders, "content-type": "application/json" } });
      }
      await admin.from("app_secrets").upsert({ key: AD_LIBRARY_TOKEN_KEY, value: tok, updated_at: new Date().toISOString() });
      // ค้นได้แล้วให้ล้างแบนเนอร์เตือนที่หน้าดูโฆษณาคู่แข่งทันที ไม่ต้องรอค้นครั้งแรก
      if (info.can_search) {
        await admin.from("settings").upsert({
          key: "ad_library_api",
          value: { ok: true, error: null, checked_at: new Date().toISOString(), dedicated_token: true },
        }, { onConflict: "key" });
      }
      return new Response(JSON.stringify({ ok: true, saved: true, ...info }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    // ---- token เพิ่มเติมแยกตาม Business Portfolio (ดูบัญชีโฆษณาของ portfolio อื่นโดยไม่ต้องแชร์ข้ามธุรกิจ) ----
    // ค่า token ไม่เคยถูกส่งกลับหน้าเว็บ — คืนแค่ชื่อ/ธุรกิจ/จำนวนบัญชี/4 ตัวท้าย
    const readExtras = async (): Promise<any[]> => {
      const { data: row } = await admin.from("app_secrets").select("value").eq("key", EXTRA_TOKENS_KEY).maybeSingle();
      try { const v = JSON.parse(String(row?.value || "[]")); return Array.isArray(v) ? v : []; } catch (_e) { return []; }
    };
    const writeExtras = async (list: any[]) => {
      const nowIso = new Date().toISOString();
      await admin.from("app_secrets").upsert({ key: EXTRA_TOKENS_KEY, value: JSON.stringify(list), updated_at: nowIso });
      // รายชื่อบัญชี/แผนที่บัญชี→token ต้องสร้างใหม่ ไม่งั้นหน้าเว็บยังเห็นชุดเดิมไปอีก 10 นาที
      await admin.from("app_secrets").delete().in("key", ["meta_accounts_cache", ACCOUNT_TOKEN_MAP_KEY]);
    };
    const inspectPortfolioToken = async (tok: string) => {
      const me = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me?fields=id,name&access_token=${tok}`).then((r) => r.json()).catch(() => ({ error: { message: "เรียก Meta ไม่สำเร็จ" } }));
      if (me?.error) return { valid: false, error: String(me.error.error_user_msg || me.error.message) };
      // field "business" มีเฉพาะ System User — token ของคน (user token) ขอแล้ว Meta ตอบ #100 ทั้งคำขอ
      // จึงแยกถามต่างหาก และไม่ถือว่า error ถ้าไม่มี
      const bizRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me?fields=business{id,name}&access_token=${tok}`).then((r) => r.json()).catch(() => ({}));
      const acc = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/adaccounts?fields=account_id,name,business{id,name}&limit=200&access_token=${tok}`).then((r) => r.json()).catch(() => ({}));
      const rows = Array.isArray(acc?.data) ? acc.data : [];
      const accounts = rows.map((a: any) => ({ id: String(a.account_id), name: String(a.name || a.account_id), business: a.business?.name || null }));
      // user token ไม่มีธุรกิจของตัวเอง — ถ้าบัญชีที่เห็นอยู่ธุรกิจเดียวกันหมด ใช้ธุรกิจนั้นเป็นชื่อ
      const bizNames = [...new Set(rows.map((a: any) => a.business?.id ? `${a.business.id}|${a.business.name}` : "").filter(Boolean))] as string[];
      const ownBiz = bizRes?.business?.id ? { id: String(bizRes.business.id), name: String(bizRes.business.name || "") }
        : bizNames.length === 1 ? { id: bizNames[0].split("|")[0], name: bizNames[0].split("|").slice(1).join("|") } : null;
      let expires_at: number | null = null;
      try {
        const dbg = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/debug_token?input_token=${tok}&access_token=${tok}`).then((r) => r.json());
        expires_at = dbg?.data?.expires_at ?? null;
      } catch (_e) { /* best-effort */ }
      return { valid: true, owner_name: me?.name || null, business_id: ownBiz?.id || null, business_name: ownBiz?.name || null, accounts, system_user: !!bizRes?.business?.id, accounts_error: acc?.error?.message || null, expires_at };
    };
    const publicExtra = (t: any, info?: any) => ({
      id: t.id, label: t.label, business_id: t.business_id ?? null, business_name: t.business_name ?? null,
      owner_name: t.owner_name ?? null, added_at: t.added_at ?? null, token_masked: maskTail(String(t.token || "")),
      ...(info ? { valid: info.valid, error: info.error ?? null, accounts: info.accounts ?? [], expires_at: info.expires_at ?? null } : {}),
    });

    if (action === "extra_list") {
      const list = await readExtras();
      // ตรวจสดทุกตัวว่ายังใช้ได้ไหม (ไม่กี่ตัว ยิงขนานได้)
      const infos = await Promise.all(list.map((t) => inspectPortfolioToken(String(t.token || ""))));
      return new Response(JSON.stringify({ ok: true, tokens: list.map((t, i) => publicExtra(t, infos[i])) }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    if (action === "extra_save") {
      const tok = String(body.token || "").trim();
      if (!tok) throw new Error("กรุณาวาง token");
      const info: any = await inspectPortfolioToken(tok);
      if (!info.valid) throw new Error(`token ใช้ไม่ได้: ${info.error || "ไม่ทราบสาเหตุ"}`);
      if (!info.accounts.length) throw new Error(`token นี้ไม่เห็นบัญชีโฆษณาเลย${info.accounts_error ? ` (${info.accounts_error})` : ""} — ตอนสร้าง token ต้องมอบหมายบัญชีโฆษณาให้ผู้ใช้ระบบ และติ๊กสิทธิ์ ads_read / ads_management`);
      if (tok === (await getMetaToken())) throw new Error("token นี้คือ token หลักที่ใช้อยู่แล้ว");
      const list = await readExtras();
      // portfolio เดิมวาง token ใหม่ = แทนที่ตัวเก่า (เช่น ต่ออายุ/สร้างใหม่) ไม่ซ้อนกันหลายตัว
      // แทนที่ด้วย business_id เฉพาะ System User (ของจริงของธุรกิจนั้น) — user token เดาธุรกิจจากบัญชีที่เห็น อาจไปทับตัวอื่นผิด
      const idx = list.findIndex((t) => t.token === tok || (info.system_user && t.system_user && info.business_id && t.business_id === info.business_id));
      const entry = {
        id: idx >= 0 ? list[idx].id : `tk_${crypto.randomUUID().slice(0, 8)}`,
        label: String(body.label || "").trim() || info.business_name || info.owner_name || "portfolio",
        token: tok, business_id: info.business_id, business_name: info.business_name, owner_name: info.owner_name, system_user: !!info.system_user,
        added_at: new Date().toISOString(),
      };
      if (idx >= 0) list[idx] = entry; else list.push(entry);
      await writeExtras(list);
      return new Response(JSON.stringify({ ok: true, saved: true, replaced: idx >= 0, token: publicExtra(entry, info) }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    if (action === "extra_delete") {
      const id = String(body.id || "");
      const list = await readExtras();
      const next = list.filter((t) => t.id !== id);
      if (next.length === list.length) throw new Error("ไม่พบ token นี้");
      await writeExtras(next);
      return new Response(JSON.stringify({ ok: true, deleted: true }), { headers: { ...corsHeaders, "content-type": "application/json" } });
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
    await clearPagesCache("meta_pages_cache");

    return new Response(JSON.stringify({ ok: true, saved: true, ...info }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (err) {
    // ข้อผิดพลาดที่ตั้งใจโยน (กรอกไม่ครบ/token ใช้ไม่ได้) ไม่ใช่ความผิดของเซิร์ฟเวอร์ ตอบ 400 และข้อความสั้น
    console.error(err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
});
