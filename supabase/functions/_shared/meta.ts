// supabase/functions/_shared/meta.ts
// ตัวช่วยกลาง: ดึง META access token จากตาราง app_secrets (ตั้งจากหน้าเว็บแอปได้)
// ถ้าไม่มีในฐานข้อมูล จะ fallback ไปใช้ env META_ACCESS_TOKEN (ของเดิม)
// ใช้ service role client (bypass RLS) จึงอ่าน app_secrets ได้ ทั้งที่ฝั่ง client อ่านไม่ได้

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOKEN_CACHE_MS = 5 * 60 * 1000;
let cachedToken = "";
let cachedTokenAt = 0;

export async function getMetaToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now - cachedTokenAt < TOKEN_CACHE_MS) return cachedToken;
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data } = await admin
      .from("app_secrets")
      .select("value")
      .eq("key", "meta_access_token")
      .maybeSingle();
    if (data?.value) {
      cachedToken = String(data.value);
      cachedTokenAt = now;
      return cachedToken;
    }
  } catch (_e) {
    // เงียบไว้ แล้วไป fallback env
  }
  cachedToken = Deno.env.get("META_ACCESS_TOKEN") ?? "";
  cachedTokenAt = now;
  return cachedToken;
}

// ---------- token สำหรับ "ตอบแชท" แยกจาก token หลัก ----------
//
// ทำไมต้องแยก: token หลัก (system user ของธุรกิจ) มีสิทธิ์บัญชีโฆษณาและใช้กับรายงานอยู่
// แต่การส่งข้อความติดที่ "แอปไหนออก token" — Meta ตรวจระดับสิทธิ์ของแอปนั้น
// ถ้ามีแอปอื่นที่ได้ Advanced Access ของ pages_messaging อยู่แล้ว
// วาง token ของแอปนั้นไว้ที่นี่ = ตอบแชทได้ทันทีโดยไม่ต้องแตะ token ของงานโฆษณา
//
// ไม่ได้ตั้ง = ใช้ token หลักเหมือนเดิม (พฤติกรรมเดิมไม่เปลี่ยน)
let cachedMsgToken = "";
let cachedMsgTokenAt = 0;

// page access token ที่แลกมาจาก token ตอบแชท ต้องเก็บแยกช่องจากของงานโฆษณา
// (page token ผูกกับแอปที่ออก user token — ปนกันแล้วการส่งจะไปใช้ token ของแอปที่ส่งไม่ได้)
export const MESSAGING_PAGES_CACHE_KEY = "meta_pages_cache_messaging";

// คืนทั้ง token และธงว่าเป็น "token แยกสำหรับตอบแชท" หรือ fallback ไป token หลัก
// ผู้เรียกต้องใช้ cacheKey ที่คืนมานี้กับ getMetaPages เสมอ
export async function getMetaMessagingContext(): Promise<{ token: string; dedicated: boolean; cacheKey: string }> {
  const now = Date.now();
  if (cachedMsgToken && now - cachedMsgTokenAt < TOKEN_CACHE_MS) {
    return { token: cachedMsgToken, dedicated: true, cacheKey: MESSAGING_PAGES_CACHE_KEY };
  }
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data } = await admin
      .from("app_secrets")
      .select("value")
      .eq("key", "meta_messaging_token")
      .maybeSingle();
    const v = String(data?.value || "").trim();
    if (v) {
      cachedMsgToken = v;
      cachedMsgTokenAt = now;
      return { token: v, dedicated: true, cacheKey: MESSAGING_PAGES_CACHE_KEY };
    }
  } catch (_e) { /* ไป fallback token หลัก */ }
  cachedMsgToken = "";
  cachedMsgTokenAt = now;
  return { token: await getMetaToken(), dedicated: false, cacheKey: "meta_pages_cache" };
}

export async function getMetaMessagingToken(): Promise<string> {
  return (await getMetaMessagingContext()).token;
}

// ---------- token สำหรับ "ดูโฆษณาคู่แข่ง" (Ad Library API) แยกจาก token หลัก ----------
//
// ทำไมต้องแยก: /ads_archive ผูกสิทธิ์กับ "คนที่ยืนยันตัวตนกับ Meta แล้ว"
// (ID verification + ลงทะเบียนที่ facebook.com/ads/library/api) ไม่ใช่กับแอปหรือธุรกิจ
// token หลักของระบบเป็น System User ซึ่งไม่มีตัวตนให้ยืนยัน จึงถูกปฏิเสธตลอด
// วาง user token ของคนที่ยืนยันตัวตนแล้วไว้ที่นี่ = ค้น Ad Library ได้ โดยงานโฆษณายังใช้ token หลักเดิม
//
// ไม่ได้ตั้ง = ใช้ token หลักเหมือนเดิม (พฤติกรรมเดิมไม่เปลี่ยน)
export const AD_LIBRARY_TOKEN_KEY = "meta_ad_library_token";
let cachedLibToken = "";
let cachedLibTokenAt = 0;

export async function getAdLibraryContext(): Promise<{ token: string; dedicated: boolean }> {
  const now = Date.now();
  if (cachedLibToken && now - cachedLibTokenAt < TOKEN_CACHE_MS) {
    return { token: cachedLibToken, dedicated: true };
  }
  const fromDb = await readSecretRow(AD_LIBRARY_TOKEN_KEY);
  if (fromDb.trim()) {
    cachedLibToken = fromDb.trim();
    cachedLibTokenAt = now;
    return { token: cachedLibToken, dedicated: true };
  }
  cachedLibToken = "";
  cachedLibTokenAt = now;
  return { token: await getMetaToken(), dedicated: false };
}

// ---------- ข้อมูลของ "Meta app" (App ID / App Secret) ----------
// ใช้ตรวจลายเซ็น webhook (x-hub-signature-256) และสร้าง app access token (`{app_id}|{app_secret}`)
// สำหรับตั้ง callback URL ของ webhook — ตั้งจากหน้าเว็บได้เหมือน token เพื่อไม่ต้องเข้าไปแก้ env
// ทุกครั้งที่ย้ายไปใช้ Meta app ตัวอื่น ต้องเปลี่ยนคู่นี้พร้อมกับ access token
const APP_CACHE_MS = 60 * 1000;   // สั้นกว่า token เพราะเปลี่ยนแล้วต้องมีผลกับ webhook เกือบทันที
let cachedAppSecret = "";
let cachedAppSecretAt = 0;
let cachedAppId = "";
let cachedAppIdAt = 0;

async function readSecretRow(key: string): Promise<string> {
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data } = await admin.from("app_secrets").select("value").eq("key", key).maybeSingle();
    return data?.value ? String(data.value) : "";
  } catch (_e) {
    return "";   // อ่านไม่ได้ = ไป fallback env
  }
}

export async function getMetaAppSecret(): Promise<string> {
  const now = Date.now();
  if (cachedAppSecret && now - cachedAppSecretAt < APP_CACHE_MS) return cachedAppSecret;
  const fromDb = await readSecretRow("meta_app_secret");
  cachedAppSecret = fromDb || Deno.env.get("META_APP_SECRET") || "";
  cachedAppSecretAt = now;
  return cachedAppSecret;
}

export async function getMetaAppId(): Promise<string> {
  const now = Date.now();
  if (cachedAppId && now - cachedAppIdAt < APP_CACHE_MS) return cachedAppId;
  const fromDb = await readSecretRow("meta_app_id");
  cachedAppId = fromDb || Deno.env.get("META_APP_ID") || "";
  cachedAppIdAt = now;
  return cachedAppId;
}

// ---- แอป Meta แยกสำหรับ "ตอบแชท" (ไม่พึ่ง Besight Backend) ----
// เก็บใน app_secrets: meta_messaging_app_id / meta_messaging_app_secret · ไม่มี env fallback
// ใช้ 2 ที่: (1) ตรวจลายเซ็น webhook ที่แอปนี้ส่งมา (2) ผูก webhook/เพจเข้ากับแอปนี้
export async function getMessagingAppCreds(): Promise<{ appId: string; appSecret: string }> {
  const [appId, appSecret] = await Promise.all([readSecretRow("meta_messaging_app_id"), readSecretRow("meta_messaging_app_secret")]);
  return { appId: appId.trim(), appSecret: appSecret.trim() };
}

// App Secret ทุกตัวที่ webhook อาจเซ็นมา — แอปหลัก + แอปตอบแชท (ถ้าตั้งไว้)
// Meta เซ็น x-hub-signature-256 ด้วย secret ของแอปที่ส่ง event นั้น เพจเดียวผูกได้หลายแอป
export async function getWebhookAppSecrets(): Promise<string[]> {
  const [main, msg] = await Promise.all([getMetaAppSecret(), getMessagingAppCreds()]);
  return [...new Set([main, msg.appSecret].filter(Boolean))];
}

// verify token ตอนกด "ตรวจสอบยืนยัน" ใน Meta — รับทั้งของเดิมใน env และตัวที่ระบบสร้างเก็บไว้ใน DB
export const WEBHOOK_VERIFY_TOKEN_KEY = "meta_webhook_verify_token";
export async function getWebhookVerifyTokens(): Promise<string[]> {
  const fromDb = await readSecretRow(WEBHOOK_VERIFY_TOKEN_KEY);
  return [...new Set([Deno.env.get("META_VERIFY_TOKEN") || "", fromDb.trim()].filter(Boolean))];
}

// ---------- token เพิ่มเติม "แยกตาม Business Portfolio" (งานโฆษณา) ----------
//
// ทำไมต้องมี: token หลักเป็น System User ซึ่งอยู่ได้แค่ธุรกิจเดียว — บัญชีโฆษณาที่อยู่ portfolio อื่น
// (เช่น ADS 1Shot, Forex Advertiser) จะมองไม่เห็นเลยจนกว่าจะแชร์ข้ามธุรกิจ
// แทนที่จะต้องแชร์ทุกบัญชี ให้วาง System User token ของแต่ละ portfolio ไว้ที่นี่ได้หลายตัว
// แล้วระบบเลือก token ให้เองตามบัญชีโฆษณา/แคมเปญ/ชุดโฆษณา/โฆษณาที่กำลังเรียก
//
// เก็บใน app_secrets:
//   meta_extra_tokens       = JSON [{ id, label, token, business_id, business_name, owner_name, added_at }]
//   meta_account_token_map  = JSON { [account_id]: token_id }   (list-ad-accounts เขียนให้ทุกครั้งที่ดึงใหม่)
// token_id "main" = token หลัก · ไม่มี token เพิ่มเลย = ทุกฟังก์ชันทำงานเหมือนเดิมทุกอย่าง (ไม่ยิงอะไรเพิ่ม)
export const EXTRA_TOKENS_KEY = "meta_extra_tokens";
export const ACCOUNT_TOKEN_MAP_KEY = "meta_account_token_map";
export type ExtraToken = { id: string; label: string; token: string; business_id?: string | null; business_name?: string | null; owner_name?: string | null; added_at?: string };

const EXTRA_CACHE_MS = 60 * 1000;   // สั้น เพราะเพิ่ม/ลบ token แล้วควรมีผลเกือบทันที
let cachedExtra: ExtraToken[] = [];
let cachedExtraAt = 0;
let cachedAccMap: Record<string, string> = {};
let cachedAccMapAt = 0;

export async function getExtraMetaTokens(): Promise<ExtraToken[]> {
  const now = Date.now();
  if (now - cachedExtraAt < EXTRA_CACHE_MS) return cachedExtra;
  let list: ExtraToken[] = [];
  try {
    const raw = await readSecretRow(EXTRA_TOKENS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed.filter((t) => t && t.id && t.token);
  } catch (_e) { /* JSON เสีย = ถือว่าไม่มี */ }
  cachedExtra = list;
  cachedExtraAt = now;
  return list;
}

// token ทั้งหมดที่ใช้กับงานโฆษณาได้ เรียง token หลักก่อนเสมอ
export async function getAllMetaTokens(): Promise<{ id: string; label: string; token: string }[]> {
  const main = await getMetaToken();
  const extras = await getExtraMetaTokens();
  const out: { id: string; label: string; token: string }[] = [];
  if (main) out.push({ id: "main", label: "token หลัก", token: main });
  for (const t of extras) if (t.token !== main) out.push({ id: t.id, label: t.label || t.business_name || t.id, token: t.token });
  return out;
}

async function getAccountTokenMap(): Promise<Record<string, string>> {
  const now = Date.now();
  if (now - cachedAccMapAt < EXTRA_CACHE_MS) return cachedAccMap;
  let map: Record<string, string> = {};
  try {
    const raw = await readSecretRow(ACCOUNT_TOKEN_MAP_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") map = parsed;
  } catch (_e) { /* ไม่มี map = ใช้ token หลัก */ }
  cachedAccMap = map;
  cachedAccMapAt = now;
  return map;
}

// token ของบัญชีโฆษณานี้ — ดูจาก map ที่ list-ad-accounts สร้างไว้ ไม่เจอ = token หลัก
export async function getMetaTokenForAccount(accountId: unknown): Promise<string> {
  const extras = await getExtraMetaTokens();
  if (!extras.length) return await getMetaToken();
  const acc = String(accountId ?? "").replace(/^act_/, "").trim();
  if (acc) {
    const tid = (await getAccountTokenMap())[acc];
    const hit = tid && tid !== "main" ? extras.find((t) => t.id === tid) : null;
    if (hit) return hit.token;
  }
  return await getMetaToken();
}

// token ที่เข้าถึง object นี้ได้ (แคมเปญ/ชุดโฆษณา/โฆษณา/ครีเอทีฟ) — ฟังก์ชันที่ได้แค่ node id
// ไม่มี token เพิ่ม = คืน token หลักทันที (ไม่ยิงเพิ่ม) · มี = ลองทีละตัวว่าตัวไหนอ่านได้ แล้วจำไว้ในรอบนี้
const nodeTokenCache = new Map<string, string>();
export async function getMetaTokenForNode(nodeId: unknown, accountHint?: unknown): Promise<string> {
  const extras = await getExtraMetaTokens();
  if (!extras.length) return await getMetaToken();
  if (accountHint) return await getMetaTokenForAccount(accountHint);
  const id = String(nodeId ?? "").trim();
  if (!id) return await getMetaToken();
  if (id.startsWith("act_")) return await getMetaTokenForAccount(id);
  const cached = nodeTokenCache.get(id);
  if (cached) return cached;
  const all = await getAllMetaTokens();
  for (const t of all) {
    try {
      const r = await fetch(`https://graph.facebook.com/v22.0/${id}?fields=id&access_token=${t.token}`).then((x) => x.json());
      if (r && !r.error) { nodeTokenCache.set(id, t.token); return t.token; }
    } catch (_e) { /* ลองตัวถัดไป */ }
  }
  return all[0]?.token || "";
}
