// supabase/functions/messenger-menu/index.ts
// จัดการ "เมนูปุ่มในแชท" ของเพจ ผ่าน Messenger Profile API
//   { action: "get",   page_id }          → อ่านเมนูปัจจุบัน (persistent_menu, ice_breakers, greeting)
//   { action: "save",  page_id, ... }     → เขียนทับทั้งชุด
//   { action: "clear", page_id, fields }  → ลบเฉพาะฟิลด์ที่ระบุ
//
// สองอย่างนี้ต่างกัน ห้ามสับสน:
//   ice_breakers   = คำถามที่โผล่ "ก่อน" ลูกค้าทักครั้งแรก (หน้าจอเปล่า) — สูงสุด 4 ข้อ
//   persistent_menu = เมนูแฮมเบอร์เกอร์ข้างช่องพิมพ์ กดได้ตลอดการสนทนา — สูงสุด 3 ปุ่มต่อชั้น
//
// ใช้สิทธิ์ pages_messaging ตัวเดียวกับการตอบแชท ไม่ต้องขอสิทธิ์เพิ่ม

import { getMetaToken } from "../_shared/meta.ts";
import { getMetaPages } from "../_shared/meta-pages.ts";
import { authorizeRequest, canAccessPage } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";

const GRAPH_VERSION = "v22.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function fetchJson(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, signal: init?.signal || AbortSignal.timeout(12_000) });
  return await r.json().catch(() => ({}));
}

// ข้อจำกัดจริงของ Meta — เกินแล้วโดนปฏิเสธทั้งชุด ตัดตั้งแต่ต้นทางดีกว่าให้ error งงๆ กลับไป
const MAX_ICE_BREAKERS = 4;
const MAX_MENU_ITEMS = 3;
const MAX_TITLE = 30; // ปุ่ม persistent menu
const MAX_QUESTION = 80; // คำถาม ice breaker
const MAX_PAYLOAD = 1000;

const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

// payload คือค่าที่วิ่งกลับมาทาง webhook ตอนลูกค้ากด — ต้องมีเสมอ ถ้าแอดมินไม่ตั้งก็สร้างจากชื่อปุ่ม
function toPayload(raw: unknown, fallback: string) {
  const p = clean(raw, MAX_PAYLOAD);
  return p || `MENU_${fallback.replace(/\s+/g, "_").toUpperCase()}`.slice(0, MAX_PAYLOAD);
}

function buildIceBreakers(input: unknown) {
  const list = Array.isArray(input) ? input : [];
  const out = list
    .map((it: any) => ({ question: clean(it?.question, MAX_QUESTION), payload: toPayload(it?.payload, clean(it?.question, 40)) }))
    .filter((it) => it.question)
    .slice(0, MAX_ICE_BREAKERS);
  // Meta รับเป็น array ของ locale — "default" ใช้กับทุกภาษา
  return out.length ? [{ locale: "default", call_to_actions: out }] : null;
}

function buildPersistentMenu(input: unknown, composerInputDisabled: boolean) {
  const list = Array.isArray(input) ? input : [];
  const actions = list
    .map((it: any) => {
      const title = clean(it?.title, MAX_TITLE);
      if (!title) return null;
      // ปุ่มเปิดลิงก์ต้องเป็น https เท่านั้น ถ้า url เพี้ยน/เป็น http → ตกกลับเป็นปุ่ม postback แทนที่จะทำทั้งชุดพัง
      if (it?.type === "web_url") {
        const url = clean(it?.url, 1000);
        if (/^https:\/\//i.test(url)) return { type: "web_url", title, url, webview_height_ratio: "full" };
      }
      return { type: "postback", title, payload: toPayload(it?.payload, title) };
    })
    .filter(Boolean)
    .slice(0, MAX_MENU_ITEMS);
  return actions.length
    ? [{ locale: "default", composer_input_disabled: !!composerInputDisabled, call_to_actions: actions }]
    : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

  try {
    const body = await readJsonBody(req, 256 * 1024);
    const action = String(body?.action || "get");
    // เมนูนี้ตั้งค่าระดับเพจ = กระทบลูกค้าทุกคน จึงล็อกไว้ที่สิทธิ์หน้า "ตั้งค่า" ไม่ใช่สิทธิ์ตอบแชททั่วไป
    const auth = await authorizeRequest(req, { tab: ["settings"] });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const pageId = body?.page_id ? String(body.page_id) : "";
    if (!pageId) return json({ ok: false, error: "ต้องเลือกเพจก่อน" }, 400);
    if (auth.permission && !canAccessPage(auth.permission, pageId)) {
      return json({ ok: false, error: "ไม่มีสิทธิ์เข้าถึงเพจนี้" }, 403);
    }

    const token = await getMetaToken();
    if (!token) return json({ ok: false, error: "ยังไม่ได้ตั้งค่า Meta access token ในหน้าตั้งค่า" }, 400);
    const pd = await getMetaPages(GRAPH_BASE, token, { mustIncludePageId: pageId });
    const pageTok = (pd?.data ?? []).find((p: any) => String(p.id) === pageId)?.access_token;
    if (!pageTok) return json({ ok: false, error: "ไม่พบ access token ของเพจนี้ (เช็คสิทธิ์ pages_messaging)" }, 400);

    const profileUrl = `${GRAPH_BASE}/${pageId}/messenger_profile`;

    // ---------- อ่านเมนูปัจจุบัน ----------
    if (action === "get") {
      const r = await fetchJson(`${profileUrl}?fields=persistent_menu,ice_breakers,greeting&access_token=${pageTok}`);
      if (r?.error) {
        return json({ ok: false, error: r.error.error_user_msg || r.error.message || "อ่านเมนูไม่สำเร็จ" }, 400);
      }
      // ยังไม่เคยตั้ง → Meta คืน data: [] ไม่ใช่ error
      const cur = (r?.data ?? [])[0] || {};
      const menu = (cur.persistent_menu ?? []).find((m: any) => m.locale === "default") || (cur.persistent_menu ?? [])[0] || null;
      const ice = (cur.ice_breakers ?? []).find((m: any) => m.locale === "default") || (cur.ice_breakers ?? [])[0] || null;
      const greet = (cur.greeting ?? []).find((m: any) => m.locale === "default") || (cur.greeting ?? [])[0] || null;
      return json({
        ok: true,
        ice_breakers: (ice?.call_to_actions ?? []).map((c: any) => ({ question: c.question || "", payload: c.payload || "" })),
        persistent_menu: (menu?.call_to_actions ?? []).map((c: any) => ({
          type: c.type === "web_url" ? "web_url" : "postback",
          title: c.title || "",
          payload: c.payload || "",
          url: c.url || "",
        })),
        composer_input_disabled: !!menu?.composer_input_disabled,
        greeting: greet?.text || "",
      });
    }

    // ---------- ลบเมนู ----------
    if (action === "clear") {
      const allowed = ["persistent_menu", "ice_breakers", "greeting"];
      const fields = (Array.isArray(body?.fields) ? body.fields : allowed).filter((f: string) => allowed.includes(f));
      if (!fields.length) return json({ ok: false, error: "ไม่มีฟิลด์ให้ลบ" }, 400);
      const r = await fetchJson(`${profileUrl}?access_token=${pageTok}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      if (r?.error) return json({ ok: false, error: r.error.error_user_msg || r.error.message || "ลบเมนูไม่สำเร็จ" }, 400);
      return json({ ok: true, cleared: fields });
    }

    // ---------- บันทึกเมนู ----------
    if (action === "save") {
      const ice = buildIceBreakers(body?.ice_breakers);
      const menu = buildPersistentMenu(body?.persistent_menu, body?.composer_input_disabled === true);
      const greetText = clean(body?.greeting, 160);

      // ฟิลด์ที่ "ตั้งใจให้ว่าง" ต้องยิง DELETE ไม่ใช่ POST ค่าว่าง — Meta ไม่รับ array เปล่า
      const toDelete: string[] = [];
      if (!ice) toDelete.push("ice_breakers");
      if (!menu) toDelete.push("persistent_menu");
      if (!greetText) toDelete.push("greeting");

      const post: Record<string, unknown> = {};
      if (ice) post.ice_breakers = ice;
      if (menu) post.persistent_menu = menu;
      if (greetText) post.greeting = [{ locale: "default", text: greetText }];

      if (Object.keys(post).length) {
        const r = await fetchJson(`${profileUrl}?access_token=${pageTok}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(post),
        });
        if (r?.error) {
          return json({ ok: false, error: r.error.error_user_msg || r.error.message || "บันทึกเมนูไม่สำเร็จ" }, 400);
        }
      }
      if (toDelete.length) {
        // ลบทีหลังเสมอ และไม่ถือว่า error ร้ายแรง — ฟิลด์ที่ไม่เคยตั้งมาก่อนจะลบไม่ได้เป็นปกติ
        await fetchJson(`${profileUrl}?access_token=${pageTok}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fields: toDelete }),
        });
      }
      return json({ ok: true, saved: Object.keys(post), cleared: toDelete });
    }

    return json({ ok: false, error: `ไม่รู้จัก action "${action}"` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: msg }, 500);
  }
});
