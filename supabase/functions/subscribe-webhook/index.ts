// supabase/functions/subscribe-webhook/index.ts
// ผูกทุกเพจเข้ากับ webhook ของแอป (subscribed_apps) เพื่อให้ Meta ส่ง event มาหา meta-webhook
//   action "subscribe" (ค่าเริ่มต้น) → POST /{page_id}/subscribed_apps ทุกเพจ
//   action "status"                  → GET  /{page_id}/subscribed_apps ดูว่าผูกแล้วยัง
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaAppId, getMetaAppSecret, getMetaToken } from "../_shared/meta.ts";
import { getMetaPages } from "../_shared/meta-pages.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { getOrRefreshCommentAdMap, getSelectedCommentPageIds } from "../_shared/comment-realtime.ts";
import { getMetaBackgroundGuard, recordMetaUsage } from "../_shared/meta-rate.ts";

const GRAPH_VERSION = "v22.0"; // v19 หมดอายุแล้ว (sunset ต้นปี 2026)
// message_reads = ลูกค้าเปิดอ่านข้อความเราแล้ว (ใช้โชว์สถานะ "อ่านแล้ว" ในแอป)
// feed = คอมเมนต์/โพสต์บนหน้าเพจ (ใช้รับคอมเมนต์ใต้โฆษณาแบบเรียลไทม์)
const BASE_FIELDS = "messages,messaging_postbacks,messaging_referrals,message_echoes,message_reads";
const INSTAGRAM_FIELDS = "messages,messaging_postbacks,messaging_seen,messaging_handover,message_reactions,messaging_referral,messaging_optins,message_edit,comments,live_comments,standby";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
async function fetchJson(url: string, init?: RequestInit, admin?: any, source = "subscribe_webhook") {
  const r = await fetch(url, init);
  if (admin) {
    const usage = await recordMetaUsage(admin, r, source);
    if (usage.blocked) throw new Error("Meta usage reached the background safety threshold");
  }
  return await r.json().catch(() => ({}));
}

// token รู้ว่าตัวเองออกโดยแอปไหน — ใช้เป็นค่าสำรองเมื่อยังไม่ได้กรอก App ID ในหน้าตั้งค่า
async function appIdFromToken(base: string, userToken: string, admin: any): Promise<string> {
  if (!userToken) return "";
  const debug = await fetchJson(`${base}/debug_token?input_token=${encodeURIComponent(userToken)}&access_token=${encodeURIComponent(userToken)}`, undefined, admin);
  return debug?.data?.app_id ? String(debug.data.app_id) : "";
}

async function ensureAppPageWebhook(base: string, userToken: string, admin: any) {
  const appSecret = await getMetaAppSecret();
  const verifyToken = Deno.env.get("META_VERIFY_TOKEN") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  if (!appSecret || !verifyToken || !supabaseUrl) {
    return { success: false, error: "ยังไม่ได้ตั้ง App Secret (ตั้งได้ที่ ตั้งค่า → Meta) หรือ META_VERIFY_TOKEN / SUPABASE_URL ไม่ครบ" };
  }
  // App ID ที่ตั้งไว้ในหน้าเว็บมาก่อน — ตอนย้ายไปใช้แอปอื่น token อาจยังเป็นของแอปเดิมอยู่ชั่วคราว
  const appId = (await getMetaAppId()) || await appIdFromToken(base, userToken, admin);
  if (!appId) return { success: false, error: "หา Meta App ID ไม่สำเร็จ — ใส่ App ID ในหน้าตั้งค่า" };
  const appToken = `${appId}|${appSecret}`;
  const callbackUrl = `${supabaseUrl}/functions/v1/meta-webhook`;
  const fields = `${BASE_FIELDS},feed`;
  const subscribeObject = async (object: string, subscribedFields: string) => {
    const form = new URLSearchParams({
      object, callback_url: callbackUrl, fields: subscribedFields,
      verify_token: verifyToken, include_values: "true",
    });
    const saved = await fetchJson(`${base}/${appId}/subscriptions?access_token=${encodeURIComponent(appToken)}`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString(),
    }, admin, `subscribe_webhook_${object}`);
    return saved?.error
      ? { success: false, error: saved.error.error_user_msg || saved.error.message }
      : { success: saved?.success === true };
  };
  const pageSaved = await subscribeObject("page", fields);
  const instagramSaved = await subscribeObject("instagram", INSTAGRAM_FIELDS);
  const status = await fetchJson(`${base}/${appId}/subscriptions?access_token=${encodeURIComponent(appToken)}`, undefined, admin);
  const pageSub = (status?.data || []).find((x: any) => x.object === "page");
  const instagramSub = (status?.data || []).find((x: any) => x.object === "instagram");
  // callback_url ที่ Meta เก็บไว้จริง = ตัวชี้ขาดว่า webhook จะถูกส่งไปที่ระบบไหน
  // (แอปหนึ่งมี callback ได้ที่เดียวต่อ object ถ้ามีอีกระบบตั้งทับ event จะไปเข้าที่นั้นทั้งหมด)
  const callbackOf = (sub: any) => {
    const urls = [...new Set((sub?.fields ?? []).map((f: any) => String(f?.callback_url || "")).filter(Boolean))];
    return urls.length ? urls.join(", ") : String(sub?.callback_url || "");
  };
  const fieldNames = (sub: any) => (sub?.fields ?? []).map((f: any) => ({ name: f?.name ?? null, version: f?.version ?? null }));
  return {
    success: pageSaved.success === true && instagramSaved.success === true,
    app_id: appId,
    expected_callback_url: callbackUrl,
    page: { ...pageSaved, active: pageSub?.active !== false, fields: fieldNames(pageSub), callback_url: callbackOf(pageSub), callback_matches: callbackOf(pageSub) === callbackUrl },
    instagram: { ...instagramSaved, active: instagramSub?.active !== false, fields: fieldNames(instagramSub), callback_url: callbackOf(instagramSub), callback_matches: callbackOf(instagramSub) === callbackUrl },
  };
}

// อ่านการตั้งค่า webhook ของแอปแบบ read-only — action=status ต้องไม่ไปตั้ง callback ทับของใคร
// ใช้ตรวจว่า "Meta จะส่ง event ไปที่ URL ไหน" ซึ่งเป็นคำตอบเดียวที่บอกได้ว่าทำไม webhook ไม่เข้า
async function readAppWebhook(base: string, userToken: string, admin: any) {
  const appSecret = await getMetaAppSecret();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  if (!appSecret) return { success: false, error: "ยังไม่ได้ตั้ง App Secret (ตั้งได้ที่ ตั้งค่า → Meta)" };
  const appId = (await getMetaAppId()) || await appIdFromToken(base, userToken, admin);
  if (!appId) return { success: false, error: "หา Meta App ID ไม่สำเร็จ — ใส่ App ID ในหน้าตั้งค่า" };
  const status = await fetchJson(`${base}/${appId}/subscriptions?access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`, undefined, admin);
  if (status?.error) return { success: false, app_id: appId, error: status.error.error_user_msg || status.error.message };
  const expected = `${supabaseUrl}/functions/v1/meta-webhook`;
  const pick = (object: string) => {
    const sub = (status?.data || []).find((x: any) => x.object === object);
    const urls = [...new Set((sub?.fields ?? []).map((f: any) => String(f?.callback_url || "")).filter(Boolean))];
    const callback = urls.length ? urls.join(", ") : String(sub?.callback_url || "");
    return {
      active: sub?.active !== false,
      fields: (sub?.fields ?? []).map((f: any) => f?.name).filter(Boolean),
      callback_url: callback,
      callback_matches: callback === expected,
    };
  };
  return { success: true, app_id: appId, expected_callback_url: expected, page: pick("page"), instagram: pick("instagram") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action === "status" ? "status" : body?.action === "sync_comments" ? "sync_comments" : "subscribe";
    const auth = await authorizeRequest(req, action === "sync_comments"
      ? { tab: "inbox", allowService: true }
      : { admin: true, setting: "synccfg", allowService: action === "status" });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const selectedPageIds = action === "sync_comments" ? await getSelectedCommentPageIds(admin) : [];
    if (action === "sync_comments" && body?.force !== true) {
      const { data: cached } = await admin.from("settings").select("value").eq("key", "comment_webhook_sync_status").maybeSingle();
      const value = cached?.value || {};
      const age = Date.now() - new Date(value.at || 0).getTime();
      const oldScope = Array.isArray(value.selected_page_ids) ? value.selected_page_ids.map(String).sort() : [];
      const newScope = selectedPageIds.map(String).sort();
      const igWebhookReady = value?.app_webhook?.instagram?.active !== false &&
        Array.isArray(value?.app_webhook?.instagram?.fields) && value.app_webhook.instagram.fields.includes("messages");
      if (Number.isFinite(age) && age >= 0 && age < 6 * 60 * 60 * 1000 && JSON.stringify(oldScope) === JSON.stringify(newScope) && igWebhookReady) {
        return json({ ok: true, action, cached: true, ...value });
      }
    }
    if (action === "sync_comments") {
      const guard = await getMetaBackgroundGuard(admin);
      if (guard.blocked) return json({ ok: true, action, cached: true, rate_guarded: true, selected_comment_pages: selectedPageIds });
    }
    const token = await getMetaToken();
    if (!token) throw new Error("ยังไม่ได้ตั้งค่า Meta access token");
    const base = `https://graph.facebook.com/${GRAPH_VERSION}`;

    const pagesData = await getMetaPages(base, token, { forceRefresh: action === "subscribe" });
    if (pagesData?.error) throw new Error(pagesData.error.message || "ดึงรายชื่อเพจไม่สำเร็จ (ต้องมีสิทธิ์ pages_show_list/pages_messaging)");
    const pages = (pagesData?.data ?? []).filter((p: any) => p.access_token);
    if (!pages.length) throw new Error("ไม่พบเพจ (เช็คสิทธิ์ token)");

    // ลงทะเบียนเพจเข้า page_lead_config ด้วย — หน้า "ตอบแชท" กับตัวกรองเพจอ่านรายชื่อจากตารางนี้
    // เดิมมีแต่ sync-conversations ที่เขียนตารางนี้ พอเพิ่มเพจใหม่แล้วกดซิงค์ webhook อย่างเดียว
    // เพจจะโผล่แค่ในหน้านี้ แต่ไม่โผล่ในหน้าตอบแชทจนกว่าจะกดซิงก์แชท (งงมาก)
    // ignoreDuplicates: true = ไม่ทับการตั้งค่าของเพจเดิม (required_fields / sync_enabled / use_ai)
    let registered = 0;
    try {
      const rows = [...new Map(pages.map((p: any) => [String(p.id), p.name])).entries()]
        .map(([page_id, page_name]) => ({ page_id, page_name }));
      const { data, error } = await admin.from("page_lead_config")
        .upsert(rows, { onConflict: "page_id", ignoreDuplicates: true })
        .select("page_id");
      if (error) console.warn("page_lead_config upsert failed:", error.message);
      registered = data?.length ?? 0;
    } catch (e) {
      console.warn("page_lead_config upsert error:", e instanceof Error ? e.message : e);
    }

    let mappedPosts = 0;
    let mapRefreshed = false;
    let rateGuarded = false;
    let appWebhook: any = null;
    if (action === "status") {
      appWebhook = await readAppWebhook(base, token, admin);
    }
    if (action === "sync_comments") {
      appWebhook = await ensureAppPageWebhook(base, token, admin);
      const mapResult = await getOrRefreshCommentAdMap(admin, base, token, selectedPageIds, { force: body?.force === true });
      mappedPosts = Object.keys(mapResult.posts).length;
      mapRefreshed = mapResult.refreshed;
      rateGuarded = mapResult.rate_guarded;
    }

    const results: any[] = [];
    for (const p of pages) {
      if (action === "status") {
        const r = await fetchJson(`${base}/${p.id}/subscribed_apps?access_token=${p.access_token}`, undefined, admin);
        const app = (r?.data ?? [])[0];
        results.push({ page: p.name, page_id: p.id, subscribed: !!app, fields: app?.subscribed_fields ?? [], error: r?.error?.message ?? null });
      } else {
        const commentsEnabled = action !== "sync_comments" || selectedPageIds.includes(String(p.id));
        const fields = commentsEnabled ? `${BASE_FIELDS},feed` : BASE_FIELDS;
        const r = await fetchJson(`${base}/${p.id}/subscribed_apps?subscribed_fields=${encodeURIComponent(fields)}&access_token=${p.access_token}`, { method: "POST" }, admin);
        results.push({ page: p.name, page_id: p.id, comments_enabled: commentsEnabled, success: r?.success === true, error: r?.error?.error_user_msg || r?.error?.message || null });
      }
    }
    if (action === "sync_comments") {
      await admin.from("settings").upsert({
        key: "comment_webhook_sync_status",
        value: { at: new Date().toISOString(), selected_page_ids: selectedPageIds, mapped_ad_posts: mappedPosts, map_refreshed: mapRefreshed, rate_guarded: rateGuarded, app_webhook: appWebhook, results },
        updated_at: new Date().toISOString(),
      });
    }
    return json({ ok: true, action, count: results.length, registered_pages: registered, selected_comment_pages: selectedPageIds, mapped_ad_posts: mappedPosts, map_refreshed: mapRefreshed, rate_guarded: rateGuarded, app_webhook: appWebhook, results });
  } catch (err) {
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 200);
  }
});
