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
