// supabase/functions/tradingview/index.ts
// จัดการสิทธิ์เข้า pine script บน TradingView
// สำคัญ: Supabase Edge (Deno) ส่ง header Cookie ออกไม่ได้ (forbidden header) → ยิง TradingView ตรงไม่ได้
//   จึงส่งคำสั่งไปที่ "n8n webhook" (รันบน Node.js ส่ง Cookie ได้) ให้ n8n เป็นตัวยิง TradingView แทน
//   ส่วนนี้ทำหน้าที่: ตรวจสิทธิ์ผู้ใช้ + คุมข้อมูลใน DB (tv_scripts/tv_access) + สั่งงาน n8n
// actions:
//   set_webhook { url, secret }  (admin)  → เก็บ URL + secret ของ n8n webhook
//   get_webhook                  (admin)  → คืน url + มี secret ไหม (ไว้เติมในฟอร์ม)
//   webhook_status                        → ping n8n ดูว่า cookie TradingView ฝั่ง n8n ยังล็อกอินอยู่ไหม
//   add_script { pine_id, name, script_key } (admin) → เพิ่มสคริปต์ใน DB
//   validate_user { username }            → ให้ n8n เช็ค username มีจริงไหม
//   check_access { id }                   → ให้ n8n อ่านสิทธิ์จริงบน TradingView แล้วบันทึกผลตรวจ
//   grant { username, display_name, pine_ids[], lifetime, days, lot, trade_id } → สั่ง n8n ให้สิทธิ์ + บันทึก DB
//   revoke { username, pine_id }          → สั่ง n8n ถอนสิทธิ์ + ลบ DB
//   expire  (service/cron)                → ถอนสิทธิ์ที่หมดอายุ (สั่ง n8n ทีละราย)
//   sync    (service/cron)                → ดึงรายชื่อสิทธิ์ต่อสคริปต์วันละครั้ง เก็บเป็น snapshot แยกจากประวัติสมาชิกใน tv_access
//   refresh_lots { period_start, period_end, brand_id? } (admin) → ดึงยอด lot จริงจาก broker (XM) มา cache
//     ใน tv_lot_usage ต่อ trade_id/ช่วงเดือน ใช้กับหน้า "จัดการสมาชิก Indicator" (ปุ่ม "ตรวจ Lot ทุกคน")

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hasFullData, authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";
import { tvValidate, tvListUsers, tvCheckAccess, tvGrant, tvRevoke, tvPing,
  tvExtend,
} from "../_shared/tradingview-direct.ts";

const URL_KEY = "n8n_tv_webhook_url";
// สวิตช์เลือกทางคุยกับ TradingView: "direct" = ยิงตรงจากที่นี่ · "n8n" = ผ่าน webhook แบบเดิม
// ค่าเริ่มต้นเป็น n8n เพื่อไม่ให้พฤติกรรมเปลี่ยนเองโดยไม่ได้ตั้งใจ — ต้องไปสลับในหน้าตั้งค่า
const TRANSPORT_KEY = "tv_transport";
const SECRET_KEY = "n8n_tv_secret";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}
async function getSetting(key: string): Promise<string> {
  const { data } = await admin().from("app_secrets").select("value").eq("key", key).maybeSingle();
  return String(data?.value || "");
}
// คุกกี้ TradingView ต่อแบรนด์ — เก็บใน app_secrets (service role เท่านั้น)
type BrandCookie = { sessionid?: string; sign?: string; tv_base?: string };
async function getBrandCookie(brandId: number | null | undefined): Promise<BrandCookie> {
  if (!brandId) return {};
  try { return JSON.parse(await getSetting(`tv_cookie_${brandId}`) || "{}"); } catch { return {}; }
}
// ช่องทางที่ลูกค้าติดต่อเข้ามา — รับเฉพาะค่าที่ตาราง tv_access ยอม (มี check constraint คุมอีกชั้น)
const CONTACT_CHANNELS = ["facebook", "line", "instagram", "telegram", "tiktok", "youtube"];
function normalizeContactChannel(value: unknown): string | null {
  const key = String(value ?? "").trim().toLowerCase();
  return CONTACT_CHANNELS.includes(key) ? key : null;
}
// plan ของสมาชิก (new = ทดลอง 1 เดือน · free = ผ่านทดลองแล้ว · premium = ครบโควตาติดกัน 3 รอบ
// · renew = ต่ออายุแล้ว) — รับเฉพาะค่าที่ check constraint ของ tv_access ยอม
const MEMBER_TYPES = ["new", "free", "premium", "renew"];
function normalizeMemberType(value: unknown): string | null {
  const key = String(value ?? "").trim().toLowerCase();
  return MEMBER_TYPES.includes(key) ? key : null;
}
// broker ที่แอดมินระบุเอง (ป้ายกำกับเท่านั้น ไม่ได้เช็คจริง) — รับเฉพาะค่าที่ตาราง tv_access ยอม
function normalizeBroker(value: unknown): string {
  return String(value ?? "") === "Exness" ? "Exness" : "XM";
}
// brand_id ของสคริปต์ (pine)
async function pineBrandId(pineId: string): Promise<number | null> {
  const { data } = await admin().from("tv_scripts").select("brand_id").eq("pine_id", pineId).maybeSingle();
  return data?.brand_id ?? null;
}
// บันทึกทุกครั้งที่คุยกับ TradingView ลง tv_api_log
// ตอนใช้ n8n เราได้ execution log ของ n8n มาดูฟรี พอยิงตรงความสามารถนั้นหายไป
// ถ้าไม่เก็บเอง เวลาให้สิทธิ์ไม่สำเร็จจะไม่มีทางรู้ว่า TradingView ตอบอะไร — ตารางนี้มาแทน
// เขียน log ห้ามทำให้งานหลักล้ม จึงกลืน error ของตัวเองทิ้งเสมอ
async function logTv(entry: Record<string, unknown>) {
  try { await admin().from("tv_api_log").insert(entry); } catch { /* log พังไม่ควรทำให้การให้สิทธิ์พัง */ }
}

// เรียก n8n webhook (n8n เป็นตัวคุยกับ TradingView จริง) — ส่งคุกกี้ของแบรนด์ไปใน payload ให้ n8n ใช้
async function callN8n(payload: Record<string, unknown>, cookie: BrandCookie = {}): Promise<any> {
  const url = await getSetting(URL_KEY);
  if (!url) throw new Error("ยังไม่ได้ตั้งค่า n8n Webhook URL (กด 'ตั้งค่า n8n' ในหน้าตั้งค่า TV)");
  const secret = await getSetting(SECRET_KEY);
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, sessionid: cookie.sessionid || "", sessionid_sign: cookie.sign || "", tv_base: cookie.tv_base || "", secret }),
  });
  const txt = await r.text();
  try {
    return JSON.parse(txt);
  } catch {
    // n8n ตอบไม่ใช่ JSON — มักคือ response ว่าง (workflow ไม่ active / ไม่มี node Respond / Respond ตั้งค่าผิด) หรือหน้า error ของ n8n
    return { ok: false, error: `n8n ตอบไม่ใช่ JSON (HTTP ${r.status}): ${txt.slice(0, 200) || "(ว่างเปล่า — เช็คว่า workflow Active + node Respond ต่อจาก TV Access + Webhook ตั้ง Respond = 'Using Respond to Webhook node')"}` };
  }
}

// ---- ตัวกลางเลือกทาง: ยิงตรง หรือผ่าน n8n ----
// ทุกเส้นทางเดิมที่เคยเรียก callN8n ย้ายมาเรียกตัวนี้แทน จะได้เปลี่ยนทางที่เดียวและได้ log ครบทั้งสองแบบ
let TRANSPORT_CACHE: string | null = null;
async function transport(): Promise<"direct" | "n8n"> {
  if (TRANSPORT_CACHE === null) TRANSPORT_CACHE = (await getSetting(TRANSPORT_KEY)) || "n8n";
  return TRANSPORT_CACHE === "direct" ? "direct" : "n8n";
}

async function callTv(payload: Record<string, unknown>, cookie: BrandCookie = {}, meta: { actor?: string | null; brand_id?: number | null } = {}): Promise<any> {
  const action = String(payload.action || "");
  const username = payload.username ? String(payload.username) : null;
  const pine_id = payload.pine_id ? String(payload.pine_id) : null;
  const mode = await transport();
  const started = Date.now();
  let res: any;
  let endpoint = mode === "n8n" ? "(n8n webhook)" : "";
  let http: number | null = null;

  try {
    if (mode === "direct") {
      const exp = payload.expiration === undefined ? null : (payload.expiration as string | null);
      const r =
        action === "grant"        ? await tvGrant(username!, pine_id!, exp, cookie)
      : action === "extend"       ? await tvExtend(username!, pine_id!, exp, cookie)
      : action === "revoke"       ? await tvRevoke(username!, pine_id!, cookie)
      : action === "validate"     ? await tvValidate(username!, cookie)
      : action === "check_access" ? await tvCheckAccess(username!, pine_id!, cookie)
      : action === "list_users"   ? await tvListUsers(pine_id!, cookie)
      : action === "ping"         ? await tvPing(pine_id || "", cookie)
      : { ok: false, endpoint: "-", error: `ไม่รองรับ action "${action}" ในโหมดยิงตรง` };
      endpoint = String(r.endpoint || "");
      http = (r.http_status as number) ?? null;
      // ตัด raw ออกก่อนส่งต่อ — เก็บไว้ใน log อย่างเดียว ไม่ให้หลุดขึ้นหน้าเว็บ
      const { raw, _full, ...clean } = r as Record<string, unknown>;
      await logTv({ transport: mode, action, username, pine_id, brand_id: meta.brand_id ?? null, endpoint,
        http_status: http, ok: !!r.ok, duration_ms: Date.now() - started,
        error: r.ok ? null : String(r.error || ""), response: typeof raw === "string" ? raw.slice(0, 2000) : null, actor: meta.actor ?? null });
      res = clean;
    } else {
      res = await callN8n(payload, cookie);
      await logTv({ transport: mode, action, username, pine_id, brand_id: meta.brand_id ?? null, endpoint,
        http_status: null, ok: !!res?.ok, duration_ms: Date.now() - started,
        error: res?.ok ? null : String(res?.error || ""), response: JSON.stringify(res).slice(0, 2000), actor: meta.actor ?? null });
    }
    // ทั้งสองทางส่งชื่อฟิลด์ต่างกัน: ยิงตรงคืน has_access แต่ n8n คืน found
    // ผู้เรียกอ่าน res.found อย่างเดียว จึงได้ undefined ทุกครั้งในโหมดยิงตรง
    // แล้วสรุปว่า "ไม่พบสิทธิ์" ทั้งที่ TradingView ตอบว่าพบ — ปรับให้มีทั้งสองชื่อ
    if (res && typeof res === "object") {
      const r = res as Record<string, unknown>;
      if (r.found === undefined && r.has_access !== undefined) r.found = r.has_access;
      if (r.has_access === undefined && r.found !== undefined) r.has_access = r.found;
    }
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logTv({ transport: mode, action, username, pine_id, brand_id: meta.brand_id ?? null, endpoint,
      http_status: http, ok: false, duration_ms: Date.now() - started, error: msg, actor: meta.actor ?? null });
    // คงพฤติกรรมเดิม: callN8n เคย throw ผู้เรียกบางจุดดักไว้แล้ว
    throw e;
  }
}

function normalizeTvExpiration(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "" || value === false) return null;
  const raw = String(value).trim();
  // รองรับทั้ง ISO/date string และ Unix timestamp วินาที/มิลลิวินาทีที่บาง response ใช้
  const numeric = /^\d{9,13}$/.test(raw) ? Number(raw) : NaN;
  const d = Number.isFinite(numeric) ? new Date(raw.length <= 10 ? numeric * 1000 : numeric) : new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function tvUserMap(value: unknown): Map<string, { username: string; expiration?: string | null; tv_granted_at?: string | null }> {
  const out = new Map<string, { username: string; expiration?: string | null; tv_granted_at?: string | null }>();
  if (!Array.isArray(value)) return out;
  for (const row of value as any[]) {
    const username = String(row?.username || row?.user || row?.name || "").trim();
    if (!username) continue;
    const rawExpiration = row?.expiration ?? row?.expires_at ?? row?.expiresAt;
    const expiration = normalizeTvExpiration(rawExpiration);
    const rawGrantedAt = row?.tv_granted_at ?? row?.created ?? row?.created_at ?? row?.createdAt ?? row?.granted_at ?? row?.grantedAt;
    const tvGrantedAt = normalizeTvExpiration(rawGrantedAt);
    out.set(username.toLowerCase(), {
      username,
      ...(expiration !== undefined ? { expiration } : {}),
      ...(tvGrantedAt !== undefined ? { tv_granted_at: tvGrantedAt } : {}),
    });
  }
  return out;
}

// ตรวจสิทธิ์ทันทีหลังให้สิทธิ์/ต่ออายุ เพื่อให้ป้าย TV ในตารางสะท้อนปลายทาง
// โดยตรง ไม่ต้องรอรอบซิงก์เที่ยงคืน (ผลตรวจไม่พบจะไม่เปลี่ยน status ธุรกิจเป็น revoked
// เพราะ TradingView อาจใช้เวลา propagate สิทธิ์เล็กน้อย)
async function verifyTvAccessRow(
  db: ReturnType<typeof admin>,
  row: { id: number; username: string; pine_id: string; brand_id?: number | null },
  cookie: BrandCookie,
): Promise<{ ok: boolean; found?: boolean; error?: string; tv_granted_at?: string | null; verified_at: string }> {
  const nowIso = new Date().toISOString();
  let res: any;
  try {
    res = await callTv({ action: "check_access", username: row.username, pine_id: row.pine_id }, cookie, { brand_id: row.brand_id ?? null });
  } catch (e) {
    res = { ok: false, error: String(e instanceof Error ? e.message : e) };
  }
  if (!res?.ok) {
    const error = String(res?.error || "ตรวจสิทธิ์ไม่สำเร็จ").slice(0, 500);
    await db.from("tv_access").update({
      tv_access_verified: null,
      tv_verified_at: nowIso,
      tv_verify_error: error,
      last_synced_at: nowIso,
      updated_at: nowIso,
    }).eq("id", row.id);
    return { ok: false, error, verified_at: nowIso };
  }
  const found = res.found === true;
  const error = found ? null : String(res.error || "ไม่พบสิทธิ์จาก TradingView หลังบันทึก").slice(0, 500);
  const verifyPatch: Record<string, unknown> = {
    tv_access_verified: found,
    tv_verified_at: nowIso,
    tv_verify_error: error,
    last_synced_at: nowIso,
    updated_at: nowIso,
  };
  const tvGrantedAt = normalizeTvExpiration(res.tv_granted_at);
  if (tvGrantedAt !== undefined) verifyPatch.tv_granted_at = tvGrantedAt;
  // เก็บ "วันหมดอายุที่ TradingView มีจริง" แยกจากค่าที่เราตั้งใจให้
  // ถ้าสองค่านี้ไม่ตรงกัน = ปลายทางไม่ได้เปลี่ยนตามที่สั่ง ต้องเห็นได้ ไม่ใช่ขึ้นว่าสำเร็จเฉย ๆ
  const tvExpiration = normalizeTvExpiration(res.expiration);
  if (tvExpiration !== undefined) {
    verifyPatch.tv_expiration = tvExpiration;
    if (tvExpiration && new Date(tvExpiration).getTime() <= Date.now()) {
      verifyPatch.tv_access_verified = false;
      verifyPatch.tv_verify_error = `TradingView ยังบันทึกว่าหมดอายุ ${new Date(tvExpiration).toLocaleDateString("th-TH")} — สิทธิ์นี้ใช้งานจริงไม่ได้`;
    }
  }
  await db.from("tv_access").update(verifyPatch).eq("id", row.id);
  return { ok: true, found, ...(error ? { error } : {}), ...(tvGrantedAt !== undefined ? { tv_granted_at: tvGrantedAt } : {}), verified_at: nowIso };
}

// ---- ยอด lot จริงจาก broker (XM) ผ่าน webhook ai.besight.net ----
// ตรวจกับของจริงแล้ว (ก.ย. 2569): check-lot คืนยอดที่ "นับได้" แล้ว — ผลรวมของ check-lot (527.27)
// บวกกับ check-lot-symbol-not-in-list (164.77) เท่ากับ check-lot-campaign (692.03) เป๊ะ ๆ
// แปลว่า lot ของสัญลักษณ์ที่ไม่เข้าเงื่อนไขถูกหักออกจาก check-lot ให้แล้ว จึงเอาก้อนที่ไม่นับมาโชว์คู่กัน
// เพื่ออธิบายลูกค้าได้ว่าทำไมยอดในแอป BeSight/MT5 มากกว่ายอดที่ใช้นับโควตา
// ช่วงวันที่นับปลายทั้งสองข้าง (date_from และ date_to รวมอยู่ในผล — ทดสอบยืนยันแล้ว)
const BROKER_LOT_BASE = "https://ai.besight.net/webhook";

// วันที่ตามเวลาไทย (broker คิดวันแบบวันปฏิทิน ไม่ใช่ UTC) — คืน YYYY-MM-DD
const thDay = (ts: unknown) => {
  if (!ts) return "";
  const t = new Date(String(ts)).getTime();
  if (!Number.isFinite(t)) return "";
  return new Date(t + 7 * 3600 * 1000).toISOString().slice(0, 10);
};
const thNow = () => new Date(Date.now() + 7 * 3600 * 1000);
const thMonthStart = () => { const n = thNow(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)).toISOString().slice(0, 10); };
const thMonthEnd = () => { const n = thNow(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); };

// บวก/ลบเดือนจากวันที่ YYYY-MM-DD แบบหนีบวันสิ้นเดือน (31 ม.ค. +1 เดือน = 28 ก.พ.)
const addMonthsDay = (ymd: string, k: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + k, 1));
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, lastDay))).toISOString().slice(0, 10);
};

// รอบที่ใช้นับ lot = "รอบเดือน" ของสมาชิกคนนั้น ไม่ใช่เดือนปฏิทิน
// ได้สิทธิ์ 10 ก.พ. → นับ 10 ก.พ.–10 มี.ค. · ต่ออายุถึง 10 เม.ย. → นับ 10 มี.ค.–10 เม.ย.
// วิธีคิด: ถอยจากวันหมดอายุทีละ 1 เดือนจนได้รอบที่ครอบ "วันนี้" (รองรับต่ออายุหลายเดือนในครั้งเดียว
// และต่ออายุช้ากว่ากำหนด เพราะหมุดคือวันหมดอายุจริง ไม่ใช่วันที่ได้สิทธิ์ครั้งแรก)
//   หมดอายุไปแล้ว → ใช้รอบสุดท้ายก่อนหมดอายุ (ยอดนิ่งแล้ว)
//   ตลอดชีพ       → ยึดวันที่ได้สิทธิ์เป็นหมุด เลื่อนไปรอบที่ครอบวันนี้
// หมายเหตุ: วันหัว-ท้ายรอบนับรวมทั้งคู่ (broker นับปลายทั้งสองข้าง) ตามที่ตกลงกันว่า "10 มี.ค. ถึง 10 เม.ย."
function lotCycleOf(grantDay: string, expiryDay: string | null, today: string): { start: string; end: string } {
  const floorTo = (anchor: string) => {
    let s = anchor;
    for (let i = 0; i < 240 && addMonthsDay(s, 1) <= today; i++) s = addMonthsDay(s, 1);
    return s;
  };
  let start: string, end: string;
  if (!expiryDay) {
    start = floorTo(grantDay);
    end = addMonthsDay(start, 1);
  } else if (expiryDay <= today) {
    start = addMonthsDay(expiryDay, -1);
    end = expiryDay;
  } else {
    let i = 1;
    start = addMonthsDay(expiryDay, -1);
    while (start > today && i < 240) { i++; start = addMonthsDay(expiryDay, -i); }
    end = addMonthsDay(expiryDay, -(i - 1));
  }
  if (start < grantDay) start = grantDay;            // รอบแรกเริ่มนับตั้งแต่วันที่ได้สิทธิ์
  if (end <= start) end = addMonthsDay(start, 1);    // กันข้อมูลวันที่เพี้ยน
  return { start, end };
}

const brokerLoginOf = (row: any) => String(row?.loginId ?? row?.login_id ?? row?.tradeid ?? row?.trade_id ?? "").trim();
// broker ส่ง lots มาเป็น string ("0.7400") — กัน comma และค่าเพี้ยนไว้ด้วย
const brokerLotsOf = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

// ยิง webhook แล้วบังคับให้ได้ array เสมอ — ถ้า HTTP ไม่ 2xx หรือ body ไม่ใช่ JSON array ต้อง throw
// ไม่ใช่คืน [] เงียบ ๆ เพราะผู้เรียกจะแปลว่า "ทุกคนเทรด 0 lot" แล้วเขียนทับแคชเป็น 0 ทั้งตาราง
async function brokerLotRows(path: string, params: Record<string, string>): Promise<any[]> {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${BROKER_LOT_BASE}/${path}?${qs}`, { signal: AbortSignal.timeout(25000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path} ตอบ HTTP ${r.status}: ${text.slice(0, 200)}`);
  // body ว่าง + HTTP 200 = "ไม่มีข้อมูลในช่วงนี้" (n8n ตอบแบบนี้จริงเมื่อ query ไม่เจอแถว) ไม่ใช่ error
  if (!text.trim()) return [];
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { throw new Error(`${path} ตอบไม่ใช่ JSON: ${text.slice(0, 200)}`); }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const wrapped = (parsed as any).data ?? (parsed as any).rows ?? (parsed as any).result;
    if (Array.isArray(wrapped)) return wrapped;
    if (brokerLoginOf(parsed)) return [parsed];          // คืนมาแถวเดียวแบบไม่ห่อ array
  }
  throw new Error(`${path} ตอบรูปแบบที่อ่านไม่ได้: ${text.slice(0, 200)}`);
}

type BrokerLot = { lots: number; campaign_name: string | null; excluded_lots: number };

// คืน Map<login, ยอด lot> ดิบ ๆ ไม่ยุ่งกับ DB (ผู้เรียกเอาไปจับคู่กับ trade_id เอง)
// tradeId: ใส่เพื่อกรองเฉพาะบัญชีเดียว (พารามิเตอร์ tradeid ใช้ได้จริง ยืนยันแล้ว) ไม่ใส่ = ทุกบัญชีใต้ IB
async function fetchBrokerLots(periodStart: string, periodEnd: string, tradeId?: string): Promise<Map<string, BrokerLot>> {
  const params: Record<string, string> = { date_from: periodStart, date_to: periodEnd };
  if (tradeId) params.tradeid = tradeId;
  const [counted, notCounted] = await Promise.all([
    brokerLotRows("check-lot", params),
    // ก้อน "ไม่นับ" เป็นข้อมูลเสริม ถ้าล้มก็ยังต้องได้ยอดหลัก
    brokerLotRows("check-lot-symbol-not-in-list", params).catch(() => [] as any[]),
  ]);
  const byLogin = new Map<string, BrokerLot>();
  const slot = (login: string) => {
    const cur = byLogin.get(login) ?? { lots: 0, campaign_name: null, excluded_lots: 0 };
    byLogin.set(login, cur);
    return cur;
  };
  for (const row of counted) {
    const login = brokerLoginOf(row);
    if (!login || (tradeId && login !== tradeId)) continue;
    const cur = slot(login);
    // broker แยกแถวตาม campaign — บัญชีเดียวอาจมีหลายแถว ต้อง "บวก" ไม่ใช่ทับ (ของเดิมทับจนยอดหาย)
    cur.lots += brokerLotsOf(row?.lots);
    if (!cur.campaign_name && row?.campaignName) cur.campaign_name = String(row.campaignName);
  }
  for (const row of notCounted) {
    const login = brokerLoginOf(row);
    if (!login || (tradeId && login !== tradeId)) continue;
    // แถวนี้แยกตาม instrument ด้วย คนเดียวมีได้หลายแถวแน่นอน
    slot(login).excluded_lots += brokerLotsOf(row?.lots);
  }
  return byLogin;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const isService = !!authHeader && authHeader.replace(/^Bearer\s+/i, "") === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const body = await readJsonBody(req, 64 * 1024);
    const action = String(body?.action || (isService ? "expire" : ""));
    const db = admin();

    // ---- cron/service: ถอนสิทธิ์ที่หมดอายุ ----
    if (action === "expire") {
      if (!isService) { const a = await authorizeRequest(req, { admin: true }); if (!a.ok) return json({ ok: false, error: a.error }, a.status); }
      const nowIso = new Date().toISOString();
      const { data: rows } = await db.from("tv_access").select("id, username, pine_id, brand_id").eq("status", "active").not("expiration", "is", null).lte("expiration", nowIso).limit(500);
      let removed = 0, failed = 0;
      for (const r of rows ?? []) {
        try {
          const cookie = await getBrandCookie(r.brand_id ?? (await pineBrandId(r.pine_id)));
          const res = await callTv({ action: "revoke", username: r.username, pine_id: r.pine_id }, cookie);
          if (!res?.ok) throw new Error(res?.error || "n8n revoke failed");
          await db.from("tv_access").update({
            status: "expired",
            tv_access_verified: false,
            tv_verified_at: nowIso,
            tv_verify_error: "หมดอายุและถอนสิทธิ์จาก TradingView แล้ว",
            updated_at: nowIso,
            last_synced_at: nowIso,
            last_error: null,
          }).eq("id", r.id);
          removed++;
        } catch (e) {
          await db.from("tv_access").update({ last_error: String(e), updated_at: nowIso }).eq("id", r.id);
          failed++;
        }
      }
      return json({ ok: true, removed, failed });
    }

    // ---- ซิงก์รายชื่อจริงจาก TradingView วันละครั้ง (service/cron เท่านั้น) ----
    // สำคัญ: รายชื่อจาก TV เก็บใน tv_external_members เท่านั้น ไม่แตะ tv_access
    // เพราะ tv_access เป็นประวัติการติดต่อ/การให้สิทธิ์ที่เกิดขึ้นผ่านแอป
    if (action === "sync") {
      if (!isService) { const a = await authorizeRequest(req, { admin: true }); if (!a.ok) return json({ ok: false, error: a.error }, a.status); }
      const nowIso = new Date().toISOString();
      const requestedBrandId = Number(body?.brand_id);
      let scriptQuery = db.from("tv_scripts").select("pine_id, brand_id");
      if (Number.isFinite(requestedBrandId) && requestedBrandId > 0) scriptQuery = scriptQuery.eq("brand_id", requestedBrandId);
      const { data: scripts, error: scriptErr } = await scriptQuery.order("pine_id");
      if (scriptErr) return json({ ok: false, error: scriptErr.message }, 500);
      const results: any[] = [];
      let synced = 0, failed = 0, changed = 0;
      for (const script of scripts ?? []) {
        const pineId = String(script.pine_id || "").trim();
        if (!pineId) continue;
        try {
          const cookie = await getBrandCookie(Number(script.brand_id) || null);
          const res = await callTv({ action: "list_users", pine_id: pineId }, cookie);
          if (!res?.ok) throw new Error(String(res?.error || "n8n list_users failed"));
          if (res.complete !== true) throw new Error("TradingView ส่งรายการมาไม่ครบ จึงไม่เปลี่ยนสถานะสมาชิก");
          const tvUsers = tvUserMap(res.users);
          const snapshot = [...tvUsers.values()].map((tv) => ({
            username: tv.username,
            pine_id: pineId,
            brand_id: script.brand_id ?? null,
            expiration: tv.expiration ?? null,
            tv_granted_at: tv.tv_granted_at ?? null,
            status: tv.expiration && new Date(tv.expiration).getTime() <= Date.now() ? "expired" : "active",
            synced_at: nowIso,
            updated_at: nowIso,
          }));
          if (snapshot.length) {
            const { error: insertErr } = await db.from("tv_external_members").upsert(snapshot, { onConflict: "username,pine_id" });
            if (insertErr) throw new Error(insertErr.message);
          }
          // ลบเฉพาะแถวเก่าหลังจากเขียน snapshot ชุดใหม่สำเร็จแล้ว
          // ถ้า insert/upsert ล้มเหลว snapshot เดิมจะยังอยู่ ไม่กลายเป็นข้อมูลว่าง
          const { error: staleErr } = await db.from("tv_external_members")
            .delete().eq("pine_id", pineId).neq("synced_at", nowIso);
          if (staleErr) throw new Error(staleErr.message);
          changed += snapshot.length;
          synced++;
          results.push({ pine_id: pineId, brand_id: script.brand_id ?? null, ok: true, members: tvUsers.size, stored_in: "tv_external_members", pages: res.pages ?? null });
        } catch (e) {
          failed++;
          const error = String(e instanceof Error ? e.message : e).slice(0, 500);
          results.push({ pine_id: pineId, brand_id: script.brand_id ?? null, ok: false, error });
        }
      }
      return json({ ok: failed === 0, action: "sync", brand_id: requestedBrandId > 0 ? requestedBrandId : null, synced, failed, changed, synced_at: nowIso, results });
    }

    // ---- รับคุกกี้อัตโนมัติจาก Chrome extension (ตรวจด้วย token ต่อแบรนด์ ไม่ต้องล็อกอินแอป) ----
    if (action === "ingest_cookie") {
      const token = String(body?.token || "").trim();
      const sessionid = String(body?.sessionid || "").trim();
      const sign = String(body?.sessionid_sign || body?.sign || "").trim();
      if (!token || !sessionid) return json({ ok: false, error: "ต้องมี token และ sessionid" }, 400);
      const { data: brand } = await db.from("tv_brands").select("id, tv_base").eq("ingest_token", token).maybeSingle();
      if (!brand) return json({ ok: false, error: "token ไม่ถูกต้อง" }, 403);
      const nowIso = new Date().toISOString();
      await db.from("app_secrets").upsert({ key: `tv_cookie_${brand.id}`, value: JSON.stringify({ sessionid, sign, tv_base: String(body?.tv_base || brand.tv_base || "") }), updated_at: nowIso });
      return json({ ok: true, brand_id: brand.id });
    }

    // ---- ต่อจากนี้ต้องมีสิทธิ์แท็บ tv_members ----
    const auth = await authorizeRequest(req, { tab: "tv_members" });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    // เดิมเช็ค role === "admin" ตรง ๆ — บทบาท owner/ads ต้องได้สิทธิ์เดียวกัน
    const isAdmin = !!auth.permission && hasFullData(auth.permission);

    if (action === "set_webhook") {
      if (!isAdmin) return json({ ok: false, error: "เฉพาะแอดมิน" }, 403);
      const url = String(body?.url || "").trim();
      if (!url) return json({ ok: false, error: "ไม่มี URL" });
      await db.from("app_secrets").upsert({ key: URL_KEY, value: url, updated_at: new Date().toISOString() });
      if (typeof body?.secret === "string") await db.from("app_secrets").upsert({ key: SECRET_KEY, value: String(body.secret), updated_at: new Date().toISOString() });
      return json({ ok: true });
    }

    if (action === "get_webhook") {
      if (!isAdmin) return json({ ok: false, error: "เฉพาะแอดมิน" }, 403);
      return json({ ok: true, url: await getSetting(URL_KEY), has_secret: !!(await getSetting(SECRET_KEY)), transport: await transport() });
    }

    // สลับทางคุยกับ TradingView: ยิงตรง (ไม่ต้องใช้ n8n) หรือผ่าน n8n แบบเดิม
    if (action === "set_transport") {
      if (!isAdmin) return json({ ok: false, error: "เฉพาะแอดมิน" }, 403);
      const mode = body?.transport === "direct" ? "direct" : "n8n";
      await admin().from("app_secrets").upsert({ key: TRANSPORT_KEY, value: mode }, { onConflict: "key" });
      TRANSPORT_CACHE = mode;   // ล้างแคชในตัวเอง ไม่งั้นต้องรอ instance ตายก่อนถึงมีผล
      return json({ ok: true, transport: mode });
    }

    // ประวัติการคุยกับ TradingView — มาแทน execution log ของ n8n
    if (action === "logs") {
      if (!isAdmin) return json({ ok: false, error: "เฉพาะแอดมิน" }, 403);
      const limit = Math.min(200, Math.max(1, Number(body?.limit) || 50));
      let q = admin().from("tv_api_log")
        .select("id, at, transport, action, username, pine_id, endpoint, http_status, ok, duration_ms, error, response, actor")
        .order("at", { ascending: false }).limit(limit);
      if (body?.only_failed === true) q = q.eq("ok", false);
      if (body?.username) q = q.eq("username", String(body.username));
      const { data, error } = await q;
      if (error) return json({ ok: false, error: error.message }, 500);

      // แนบชื่อสคริปต์ให้ด้วย — log เก็บแต่ pine_id ซึ่งอ่านไม่รู้เรื่องว่าเป็นอินดี้ตัวไหน
      // (เดิมหน้าจอบอกแค่ "สำเร็จ" จึงไม่รู้ว่าสำเร็จของตัวไหน)
      const { data: scriptRows } = await admin().from("tv_scripts").select("pine_id, name");
      const nameByPine = new Map((scriptRows ?? []).map((x: any) => [String(x.pine_id), String(x.name || "")]));

      // ผลจริงจาก TradingView: "exists" = มีสิทธิ์อยู่แล้ว ไม่ได้แก้อะไร (ไม่ได้ต่ออายุ!)
      //                        "ok"     = เพิ่ม/เปลี่ยนให้จริง
      // ต้องแยกให้เห็น เพราะทั้งสองกรณี HTTP เป็น 2xx และเดิมขึ้นว่า "สำเร็จ" เหมือนกันหมด
      const tvOutcome = (row: any) => {
        if (row?.action !== "grant") return null;
        const text = String(row?.response || "");
        if (/"exists"/.test(text)) return "exists";
        if (/"ok"/.test(text)) return "ok";
        return null;
      };

      return json({
        ok: true,
        rows: (data ?? []).map((r: any) => ({
          ...r,
          script: r.pine_id ? (nameByPine.get(String(r.pine_id)) || String(r.pine_id).slice(0, 12) + "…") : null,
          tv_outcome: tvOutcome(r),
        })),
      });
    }

    // ---- จัดการแบรนด์ TradingView (คุกกี้/เพจ/โชว์ในหน้าจัดการ) ----
    if (action === "list_brands") {
      const { data: brands } = await db.from("tv_brands").select("id, name, tv_base, pages, show_in_manager, active, ingest_token, lot_quota_per_month").order("created_at");
      // แนบสถานะว่ามีคุกกี้แล้วไหม (ไม่ส่งคุกกี้จริงออกไป)
      const withCookie = await Promise.all((brands ?? []).map(async (b: any) => {
        const c = await getBrandCookie(b.id);
        return { ...b, has_cookie: !!(c.sessionid) };
      }));
      return json({ ok: true, brands: withCookie });
    }

    if (action === "save_brand") {
      if (!isAdmin) return json({ ok: false, error: "เฉพาะแอดมิน" }, 403);
      const name = String(body?.name || "").trim();
      if (!name) return json({ ok: false, error: "ต้องมีชื่อแบรนด์" });
      const nowIso = new Date().toISOString();
      const row: Record<string, unknown> = {
        name, tv_base: String(body?.tv_base || "").trim() || null,
        pages: Array.isArray(body?.pages) ? body.pages.map(String) : [],
        show_in_manager: body?.show_in_manager !== false,
        active: body?.active !== false, updated_at: nowIso,
      };
      // โควตา lot/เดือน ของหน้า "จัดการสมาชิก Indicator" — ส่งมาก็แก้ ไม่ส่งมาก็ไม่แตะของเดิม (แก้ผ่านการ์ดสรุปแยกต่างหาก)
      if (body?.lot_quota_per_month !== undefined) row.lot_quota_per_month = Math.max(0, Number(body.lot_quota_per_month) || 0);
      let id = Number(body?.id) || null;
      if (id) {
        // แบรนด์เก่าที่สร้างไว้ก่อนมี ingest_token (เดิมออกให้เฉพาะตอนสร้างใหม่เท่านั้น) จะไม่มี token
        // ค้างตลอดไป กล่อง "รับคุกกี้อัตโนมัติ" ในหน้าตั้งค่าเลยไม่โผล่ — เติมให้ตอนแก้ไขถ้ายังไม่มี
        const { data: cur } = await db.from("tv_brands").select("ingest_token").eq("id", id).maybeSingle();
        if (!cur?.ingest_token) row.ingest_token = crypto.randomUUID().replace(/-/g, "");
        const { error } = await db.from("tv_brands").update(row).eq("id", id);
        if (error) return json({ ok: false, error: error.message });
      } else {
        row.ingest_token = crypto.randomUUID().replace(/-/g, "");   // token รับคุกกี้อัตโนมัติ (ต่อแบรนด์)
        const { data, error } = await db.from("tv_brands").insert(row).select("id").single();
        if (error) return json({ ok: false, error: error.message });
        id = data.id;
      }
      // เก็บคุกกี้ (ถ้าส่งมา — เว้นว่าง = ไม่แก้ของเดิม)
      const sessionid = String(body?.sessionid || "").trim();
      const sign = String(body?.sign || "").trim();
      if (sessionid) {
        await db.from("app_secrets").upsert({ key: `tv_cookie_${id}`, value: JSON.stringify({ sessionid, sign, tv_base: row.tv_base || "" }), updated_at: nowIso });
      }
      return json({ ok: true, id });
    }

    if (action === "delete_brand") {
      if (!isAdmin) return json({ ok: false, error: "เฉพาะแอดมิน" }, 403);
      const id = Number(body?.id) || 0;
      if (!id) return json({ ok: false, error: "ไม่มี id" });
      const { count } = await db.from("tv_scripts").select("pine_id", { count: "exact", head: true }).eq("brand_id", id);
      if ((count || 0) > 0) return json({ ok: false, error: `แบรนด์นี้ยังมีสคริปต์ ${count} ตัว — ลบ/ย้ายสคริปต์ออกก่อน` });
      await db.from("tv_brands").delete().eq("id", id);
      await db.from("app_secrets").delete().eq("key", `tv_cookie_${id}`);
      return json({ ok: true });
    }

    if (action === "webhook_status") {
      // เช็คต่อแบรนด์ (ส่ง brand_id มา) — ใช้คุกกี้ + สคริปต์ของแบรนด์นั้น
      const brandId = Number(body?.brand_id) || null;
      const cookie = await getBrandCookie(brandId);
      const q = db.from("tv_scripts").select("pine_id");
      const { data: sc } = await (brandId ? q.eq("brand_id", brandId) : q).limit(1).maybeSingle();
      try {
        const res = await callTv({ action: "ping", pine_id: sc?.pine_id || "" }, cookie);
        // ยิงตรงกับผ่าน n8n คืนชื่อฟิลด์คนละชุด — เดิมอ่านเฉพาะชื่อฝั่ง n8n (authed/status_code/sid_len/
        // sign_len/sample) พอสลับมาโหมดยิงตรงแล้ว res เป็นผล tvPing (มี logged_in/http_status แทน)
        // ฟิลด์พวกนั้นเลยว่างเปล่าตลอด หน้าเว็บจึงขึ้นเตือน "ยังไม่ล็อกอิน" ทั้งที่คุกกี้ใช้ได้จริง
        // — normalize ให้รองรับทั้งสองโหมด sid_len/sign_len โหมดยิงตรงไม่มีให้มา คำนวณเองจากคุกกี้ที่ถืออยู่
        const authed = res?.authed === true || res?.logged_in === true;
        return json({
          ok: true,
          reachable: true,
          authed,
          status_code: res?.status_code ?? res?.http_status ?? null,
          sample: res?.sample ?? res?.error ?? null,
          sid_len: res?.sid_len ?? (cookie.sessionid ? cookie.sessionid.length : 0),
          sign_len: res?.sign_len ?? (cookie.sign ? cookie.sign.length : 0),
        });
      } catch (e) {
        return json({ ok: true, reachable: false, error: String(e instanceof Error ? e.message : e) });
      }
    }

    if (action === "add_script") {
      if (!isAdmin) return json({ ok: false, error: "เฉพาะแอดมิน" }, 403);
      const pine_id = String(body?.pine_id || "").trim();
      const name = String(body?.name || "").trim();
      const brand_id = Number(body?.brand_id) || null;
      if (!pine_id || !name) return json({ ok: false, error: "ต้องมี pine_id และ name" });
      // เพิ่มใหม่เท่านั้น — ถ้า pine_id ซ้ำให้แจ้ง ไม่เขียนทับสคริปต์เดิม
      const { data: dup } = await db.from("tv_scripts").select("pine_id, name").eq("pine_id", pine_id).maybeSingle();
      if (dup) return json({ ok: false, error: `มีสคริปต์ pine_id นี้อยู่แล้ว ("${dup.name}") — ถ้าต้องการเปลี่ยนชื่อให้ลบอันเดิมก่อน` });
      const { error: insErr } = await db.from("tv_scripts").insert({ pine_id, name, script_key: body?.script_key || null, brand_id });
      if (insErr) return json({ ok: false, error: insErr.message });
      return json({ ok: true });
    }

    if (action === "delete_script") {
      if (!isAdmin) return json({ ok: false, error: "เฉพาะแอดมิน" }, 403);
      const pine_id = String(body?.pine_id || "").trim();
      if (!pine_id) return json({ ok: false, error: "ไม่มี pine_id" });
      await db.from("tv_scripts").delete().eq("pine_id", pine_id);   // cascade ลบ tv_access ของสคริปต์นี้ในแอป (ไม่ถอนสิทธิ์บน TradingView)
      return json({ ok: true });
    }

    // แก้ไขข้อมูลสมาชิก (ชื่อ/USER TV/อีเมล/Trade ID)
    // ถ้าเปลี่ยน USER TV ต้องย้ายสิทธิ์บน TradingView ด้วย เพื่อไม่ให้ชื่อเดิมค้างสิทธิ์
    if (action === "update_member") {
      const id = Number(body?.id) || 0;
      if (!id) return json({ ok: false, error: "ไม่มี id" });
      const nowIso = new Date().toISOString();
      const { data: current, error: currentErr } = await db.from("tv_access")
        .select("id, username, pine_id, brand_id, expiration")
        .eq("id", id)
        .maybeSingle();
      if (currentErr || !current) return json({ ok: false, error: currentErr?.message || "ไม่พบสมาชิก" });
      const requestedUsername = String(body?.username || current.username || "").trim();
      if (!requestedUsername) return json({ ok: false, error: "USER TV ห้ามว่าง" });
      const usernameChanged = requestedUsername.toLowerCase() !== String(current.username || "").trim().toLowerCase();

      // กันชน unique(username,pine_id) ก่อนแตะสิทธิ์ภายนอก
      if (usernameChanged) {
        const { data: duplicate } = await db.from("tv_access").select("id")
          .eq("username", requestedUsername).eq("pine_id", current.pine_id).neq("id", id).maybeSingle();
        if (duplicate) return json({ ok: false, error: `USER TV \"${requestedUsername}\" มีอยู่ในสคริปต์นี้แล้ว` });
      }
      // ใครแก้ไข — ชื่อเล่น (fallback อีเมล)
      let editedBy = auth.permission?.email || null;
      if (editedBy) { const { data: np } = await db.from("user_permissions").select("nickname").eq("email", editedBy).maybeSingle(); if (np?.nickname) editedBy = np.nickname; }
      const patch: Record<string, unknown> = { updated_at: nowIso, edited_by: editedBy, edited_at: nowIso };
      if ("display_name" in body) patch.display_name = String(body.display_name || "").trim() || null;
      if ("email" in body) patch.email = String(body.email || "").trim() || null;
      if ("trade_id" in body) patch.trade_id = String(body.trade_id || "").trim() || null;
      if ("contact_channel" in body) patch.contact_channel = normalizeContactChannel(body.contact_channel);
      if ("member_type" in body) patch.member_type = normalizeMemberType(body.member_type);
      if ("broker" in body) patch.broker = normalizeBroker(body.broker);
      if ("phone" in body) patch.phone = String(body.phone || "").trim() || null;
      if ("country" in body) patch.country = String(body.country || "").trim() || null;
      if ("telegram" in body) patch.telegram = String(body.telegram || "").trim() || null;
      if (usernameChanged) {
        const cookie = await getBrandCookie(Number(current.brand_id) || await pineBrandId(current.pine_id));
        const oldUsername = String(current.username).trim();

        // ถอนชื่อเดิมก่อนตามเจตนาการแก้ไข แล้วให้สิทธิ์ชื่อใหม่ด้วยวันหมดอายุเดิม
        let revokeOld: any;
        try {
          revokeOld = await callTv({ action: "revoke", username: oldUsername, pine_id: current.pine_id }, cookie);
        } catch (e) {
          return json({ ok: false, error: `ถอนสิทธิ์ USER TV เดิมไม่สำเร็จ: ${String(e instanceof Error ? e.message : e)}` });
        }
        if (!revokeOld?.ok) return json({ ok: false, error: `ถอนสิทธิ์ USER TV เดิมไม่สำเร็จ: ${revokeOld?.error || "ลองใหม่"}` });

        let grantNew: any;
        try {
          grantNew = await callTv({ action: "grant", username: requestedUsername, pine_id: current.pine_id, expiration: current.expiration }, cookie);
        } catch (e) {
          // ไม่แน่ใจว่าปลายทางได้รับคำสั่งหรือไม่ จึงคืนสิทธิ์เดิมไว้ก่อน
          await callTv({ action: "grant", username: oldUsername, pine_id: current.pine_id, expiration: current.expiration }, cookie).catch(() => null);
          return json({ ok: false, error: `ให้สิทธิ์ USER TV ใหม่ไม่สำเร็จ: ${String(e instanceof Error ? e.message : e)}` });
        }
        if (!grantNew?.ok) {
          // ชดเชยสิทธิ์เดิมทันที หากเพิ่มชื่อใหม่ไม่สำเร็จ
          await callTv({ action: "grant", username: oldUsername, pine_id: current.pine_id, expiration: current.expiration }, cookie).catch(() => null);
          return json({ ok: false, error: `ให้สิทธิ์ USER TV ใหม่ไม่สำเร็จ: ${grantNew?.error || "ลองใหม่"}` });
        }
        patch.username = String(grantNew.username || requestedUsername).trim();
        patch.last_granted_at = nowIso;
        patch.last_synced_at = nowIso;
        patch.status = "active";
        patch.last_error = null;
      }
      const { error } = await db.from("tv_access").update(patch).eq("id", id);
      if (error) {
        if (usernameChanged) {
          // ฐานข้อมูลเขียนไม่สำเร็จ: คืนสภาพสิทธิ์ให้ชื่อเดิมและถอนชื่อใหม่
          const cookie = await getBrandCookie(Number(current.brand_id) || await pineBrandId(current.pine_id));
          await callTv({ action: "revoke", username: String(patch.username), pine_id: current.pine_id }, cookie).catch(() => null);
          await callTv({ action: "grant", username: current.username, pine_id: current.pine_id, expiration: current.expiration }, cookie).catch(() => null);
        }
        return json({ ok: false, error: error.message });
      }
      // เปลี่ยน USER TV สำเร็จแล้ว ตรวจชื่อใหม่ทันทีและบันทึกผลลงแถวเดิม
      let verification: any = null;
      if (usernameChanged) {
        const cookie = await getBrandCookie(Number(current.brand_id) || await pineBrandId(current.pine_id));
        verification = await verifyTvAccessRow(db, {
          id: Number(current.id),
          username: String(patch.username || current.username),
          pine_id: current.pine_id,
          brand_id: current.brand_id,
        }, cookie);
      }
      return json({ ok: true, username_changed: usernameChanged, old_username: current.username, username: patch.username || current.username, verification });
    }

    // ตรวจสอบสิทธิ์จริงบน TradingView โดยอ่านรายการสิทธิ์จากปลายทาง
    // ไม่เปลี่ยนสถานะสมาชิกในแอปอัตโนมัติ — บันทึกเฉพาะผลตรวจและเวลาไว้ให้ตรวจสอบย้อนหลังได้
    if (action === "check_access") {
      const id = Number(body?.id) || 0;
      if (!id) return json({ ok: false, error: "ไม่มี id" });
      const { data: row, error: rowErr } = await db.from("tv_access")
        .select("id, username, pine_id, brand_id")
        .eq("id", id)
        .maybeSingle();
      if (rowErr || !row) return json({ ok: false, error: rowErr?.message || "ไม่พบสมาชิก" });

      const cookie = await getBrandCookie(Number(row.brand_id) || await pineBrandId(row.pine_id));
      const nowIso = new Date().toISOString();
      let res: any;
      try {
        res = await callTv({ action: "check_access", username: row.username, pine_id: row.pine_id }, cookie);
      } catch (e) {
        res = { ok: false, error: String(e instanceof Error ? e.message : e) };
      }
      if (!res?.ok) {
        await db.from("tv_access").update({
          tv_access_verified: null,
          tv_verified_at: nowIso,
          tv_verify_error: String(res?.error || "ตรวจสิทธิ์ไม่สำเร็จ").slice(0, 500),
          updated_at: nowIso,
        }).eq("id", id);
        return json({ ok: false, error: res?.error || "ตรวจสิทธิ์ไม่สำเร็จ", verified_at: nowIso });
      }

      const found = res.found === true;
      const verifyPatch: Record<string, unknown> = {
        tv_access_verified: found,
        tv_verified_at: nowIso,
        tv_verify_error: found ? null : (res.error ? String(res.error).slice(0, 500) : null),
        updated_at: nowIso,
      };
      const tvGrantedAt = normalizeTvExpiration(res.tv_granted_at);
      if (tvGrantedAt !== undefined) verifyPatch.tv_granted_at = tvGrantedAt;
      await db.from("tv_access").update(verifyPatch).eq("id", id);
      return json({ ok: true, found, username: row.username, pine_id: row.pine_id, ...(tvGrantedAt !== undefined ? { tv_granted_at: tvGrantedAt } : {}), verified_at: nowIso });
    }

    if (action === "validate_user") {
      const u = String(body?.username || "").trim();
      if (!u) return json({ ok: false, error: "ไม่มี username" });
      const cookie = await getBrandCookie(Number(body?.brand_id) || null);
      const res = await callTv({ action: "validate", username: u }, cookie, { actor: auth.permission?.email ?? null });
      return json({ ok: true, exists: !!res?.username, username: res?.username || null });
    }

    // renew: true = "ต่ออายุ" (ปุ่มต่ออายุหน้าแชท) — ต่างจากการให้สิทธิ์ใหม่ 2 อย่าง
    //   1) วันหมดอายุใหม่นับต่อจากวันหมดอายุเดิมที่ยังไม่ถึง (ไม่ใช่นับจากวันนี้ ซึ่งจะทำให้ลูกค้าเสียวันที่เหลือ)
    //   2) plan เปลี่ยนเป็น "ต่ออายุ" (renew) ไม่ใช่ "ลูกค้าใหม่" และบันทึกเวลา/จำนวนครั้งที่ต่อ
    if (action === "grant") {
      const username = String(body?.username || "").trim();
      const pineIds: string[] = Array.isArray(body?.pine_ids) ? body.pine_ids.map(String) : [];
      if (!username || !pineIds.length) return json({ ok: false, error: "ต้องมี username และเลือกสคริปต์อย่างน้อย 1" });
      const lifetime = body?.lifetime === true;
      const days = Number(body?.days) || 0;
      const renew = body?.renew === true;
      // ถ้าส่ง expiration มาตรงๆ (โหมดเลือกจากปฏิทิน) ใช้เลย ไม่คิดจากจำนวนวัน (กันวันเพี้ยนเพราะปัดเศษเวลา)
      const expiration = lifetime ? null
        : (body?.expiration ? new Date(String(body.expiration)).toISOString()
        : new Date(Date.now() + Math.max(1, days) * 86400000).toISOString());
      const nowIso = new Date().toISOString();
      // ใครกดเพิ่ม — ใช้ชื่อเล่นที่ตั้งไว้ (fallback = อีเมล)
      const grantEmail = auth.permission?.email || null;
      let grantedBy = grantEmail;
      if (grantEmail) {
        const { data: np } = await db.from("user_permissions").select("nickname").eq("email", grantEmail).maybeSingle();
        if (np?.nickname) grantedBy = np.nickname;
      }
      let realUser = username;
      const results: any[] = [];
      for (const pine_id of pineIds) {
        try {
          const brand_id = await pineBrandId(pine_id);         // แบรนด์ของสคริปต์นี้ → ใช้คุกกี้ของแบรนด์นั้น
          const cookie = await getBrandCookie(brand_id);
          // แถวเดิม (ถ้ามี) — ต้องรู้ก่อนยิง TradingView เพราะการต่ออายุต้องต่อจากวันหมดอายุเดิม
          const existingOf = async (user: string) => (await db.from("tv_access")
            .select("id, expiration, renew_count, member_type").eq("username", user).eq("pine_id", pine_id).maybeSingle()).data;
          let existing = await existingOf(username);
          let expForPine = expiration;
          if (renew && !lifetime && !body?.expiration) {
            const prev = existing?.expiration ? new Date(String(existing.expiration)).getTime() : 0;
            const base = prev > Date.now() ? prev : Date.now();   // ยังไม่หมดอายุ = ต่อท้ายวันเดิม · หมดแล้ว = นับจากวันนี้
            expForPine = new Date(base + Math.max(1, days) * 86400000).toISOString();
          }
          const res = await callTv({ action: "grant", username, pine_id, expiration: expForPine }, cookie, { actor: auth.permission?.email ?? null, brand_id });
          if (!res?.ok) { results.push({ pine_id, ok: false, error: res?.error || `n8n ตอบ: ${JSON.stringify(res).slice(0, 250)}` }); continue; }
          realUser = res.username || username;
          // TradingView อาจคืน username คนละตัวพิมพ์ — แถวเดิมอยู่ใต้ชื่อที่ปลายทางใช้
          if (realUser !== username) existing = (await existingOf(realUser)) ?? existing;

          // TradingView ตอบ "exists" = มีสิทธิ์อยู่แล้ว และ /pine_perm/add/ จะไม่แก้วันหมดอายุให้
          // ถ้าไม่ยิง extend ต่อ การ "ต่ออายุ" จะไม่มีผลอะไรเลย แต่ระบบเดิมรายงานว่าสำเร็จ
          // (เจอจริง: Besight One STR 62 รายหมดอายุ 3–7 ก.ย. ทั้งที่ในระบบขึ้น active ถึง 8 ต.ค.)
          let extended = false;
          if (res?.already === true) {
            const ext = await callTv({ action: "extend", username: realUser, pine_id, expiration: expForPine }, cookie, { actor: auth.permission?.email ?? null, brand_id });
            if (!ext?.ok) {
              results.push({ pine_id, ok: false, already: true, error: `มีสิทธิ์อยู่แล้วแต่ต่ออายุไม่สำเร็จ: ${ext?.error || "ไม่ทราบสาเหตุ"}` });
              continue;
            }
            extended = true;
          }
          // มีแถวเดิมอยู่แล้ว = "แก้ไข" (ไม่ทับคนเพิ่ม/วันเพิ่มเดิม แต่บันทึกคนแก้+เวลาแก้)
          //                    ไม่มี = "เพิ่มใหม่" (บันทึกคนเพิ่ม/วันเพิ่ม)
          const payload: Record<string, unknown> = {
            username: realUser, pine_id, brand_id, display_name: body?.display_name || null,
            email: body?.email || null,
            expiration: expForPine, lot: body?.lot || null, trade_id: body?.trade_id || null,
            status: "active", last_granted_at: nowIso, last_synced_at: nowIso, last_error: null, updated_at: nowIso,
          };
          // ต่ออายุมักส่งมาแค่ user + จำนวนวัน — ห้ามล้าง trade_id/ชื่อ/อีเมลเดิมทิ้ง
          if (renew) {
            if (!body?.trade_id) delete payload.trade_id;
            if (!body?.display_name) delete payload.display_name;
            if (!body?.email) delete payload.email;
          }
          // ต่ออายุ/เพิ่มสคริปต์ซ้ำมักไม่ส่งช่องทางมาด้วย — ใส่เฉพาะตอนที่ส่งมาจริง จะได้ไม่ล้างค่าเดิมทิ้ง
          const grantChannel = normalizeContactChannel(body?.contact_channel);
          if (grantChannel) payload.contact_channel = grantChannel;
          const grantMemberType = normalizeMemberType(body?.member_type) || (renew ? "renew" : null);
          if (grantMemberType) payload.member_type = grantMemberType;
          if (renew) {
            payload.renewed_at = nowIso;
            payload.renew_count = (Number(existing?.renew_count) || 0) + 1;
          }
          if ("broker" in (body ?? {})) payload.broker = normalizeBroker(body?.broker);
          // เบอร์/ประเทศ/Telegram — ใส่เฉพาะตอนส่งมาจริง เหตุผลเดียวกับ channel/member_type ด้านบน
          if (body?.phone) payload.phone = String(body.phone).trim();
          if (body?.country) payload.country = String(body.country).trim();
          if (body?.telegram) payload.telegram = String(body.telegram).trim();
          if (existing) { payload.edited_by = grantedBy; payload.edited_at = nowIso; }
          else { payload.granted_by = grantedBy; payload.granted_at = nowIso; }
          const { error: upsertError } = await db.from("tv_access").upsert(payload, { onConflict: "username,pine_id" });
          if (upsertError) throw new Error(upsertError.message);
          const { data: savedRow, error: savedRowError } = await db.from("tv_access")
            .select("id, username, pine_id, brand_id")
            .eq("username", realUser).eq("pine_id", pine_id).maybeSingle();
          if (savedRowError || !savedRow) throw new Error(savedRowError?.message || "บันทึกสมาชิกแล้วแต่หาแถวเพื่อตรวจสิทธิ์ไม่พบ");
          // ให้สิทธิ์/ต่ออายุสำเร็จแล้วเช็กกับ TradingView ทันที ไม่ต้องรอ cron รอบเที่ยงคืน
          const verification = await verifyTvAccessRow(db, savedRow, cookie);
          results.push({ pine_id, ok: true, extended, renewed: renew, expiration: expForPine, verification });
        } catch (e) {
          results.push({ pine_id, ok: false, error: String(e instanceof Error ? e.message : e) });
        }
      }
      const okCount = results.filter((r) => r.ok).length;
      return json({ ok: okCount > 0, username: realUser, expiration, results });
    }

    if (action === "revoke") {
      const username = String(body?.username || "").trim();
      const pine_id = String(body?.pine_id || "").trim();
      if (!username || !pine_id) return json({ ok: false, error: "ต้องมี username และ pine_id" });
      const cookie = await getBrandCookie(await pineBrandId(pine_id));
      const res = await callTv({ action: "revoke", username, pine_id }, cookie, { actor: auth.permission?.email ?? null });
      if (!res?.ok) return json({ ok: false, error: res?.error || "n8n revoke failed" });
      // ถอนสิทธิ์บน TradingView ก่อน แล้วตรวจซ้ำทันทีเพื่อให้ตารางสะท้อนผลจริง
      const nowIso = new Date().toISOString();
      const { data: row, error: rowError } = await db.from("tv_access")
        .select("id, username, pine_id, brand_id")
        .eq("username", username).eq("pine_id", pine_id).maybeSingle();
      if (rowError) return json({ ok: false, error: rowError.message });
      const { error: markError } = await db.from("tv_access").update({
        status: "revoked",
        last_synced_at: nowIso,
        last_error: null,
        updated_at: nowIso,
      })
        .eq("username", username).eq("pine_id", pine_id);
      if (markError) return json({ ok: false, error: markError.message });
      let verification: any = null;
      if (row) {
        verification = await verifyTvAccessRow(db, row, cookie);
        // ถ้าปลายทางยังพบสิทธิ์ แสดงสถานะ active ตามความจริง ไม่หลอกว่าถอนสำเร็จแล้ว
        if (verification.ok && verification.found === true) {
          await db.from("tv_access").update({ status: "active", updated_at: verification.verified_at }).eq("id", row.id);
        } else if (verification.ok && verification.found === false) {
          await db.from("tv_access").update({ status: "revoked", updated_at: verification.verified_at }).eq("id", row.id);
        }
      }
      return json({ ok: true, found: verification?.found === true, verified_at: verification?.verified_at || nowIso, verification });
    }

    // ---- ดึงยอด lot จริงจาก broker (XM) มา cache ต่อ trade_id/รอบเดือน — ปุ่ม "ตรวจ Lot ทุกคน" ----
    // ช่วงที่นับ = "รอบเดือน" ของสมาชิกแต่ละคน ไม่ใช่เดือนปฏิทิน (ดู lotCycleOf ด้านบน)
    //   ได้สิทธิ์ 10 ก.พ. → 10 ก.พ.–10 มี.ค. · ต่ออายุถึง 10 เม.ย. → 10 มี.ค.–10 เม.ย.
    // กติกาต้องตรงกับ lotPeriodOf() ในหน้าเว็บเป๊ะ ๆ ไม่งั้นอ่านแคชไม่เจอ
    // ส่ง period_start/period_end มาด้วย = บังคับใช้ช่วงนั้นกับทุกคน (ปุ่มเลือกช่วงในหน้าเว็บ)
    // broker ยิงทีละช่วง ไม่ใช่ทีละคน — คนที่ช่วงเหมือนกันรวมยิงครั้งเดียว
    if (action === "refresh_lots") {
      if (!isAdmin) return json({ ok: false, error: "เฉพาะแอดมิน" }, 403);
      const brandId = Number(body?.brand_id) || null;
      // override: ระบุช่วงมาตรง ๆ = บังคับให้ทุกคนใช้ช่วงเดียวกัน (ใช้ตรวจย้อนหลัง/ดีบัก)
      const forcedStart = String(body?.period_start || "").trim();
      const forcedEnd = String(body?.period_end || "").trim();

      // แบ่งหน้าเอง — ตอนนี้ 884 แถวและโตขึ้นเรื่อย ๆ ถ้าชน 1000 แถวของ PostgREST สมาชิกท้าย ๆ จะหายเงียบ ๆ
      const members: any[] = [];
      for (let from = 0; ; from += 1000) {
        let q = db.from("tv_access").select("trade_id, granted_at, created_at, expiration").not("trade_id", "is", null);
        if (brandId) q = q.eq("brand_id", brandId);
        const { data: page, error: membersErr } = await q.order("id").range(from, from + 999);
        if (membersErr) return json({ ok: false, error: membersErr.message });
        members.push(...(page ?? []));
        if (!page || page.length < 1000) break;
      }

      const today = thDay(new Date().toISOString());
      // สมาชิกคนเดียวมีได้หลายอินดิเคเตอร์ — รวมเป็นวันที่ได้สิทธิ์เก่าสุด + วันหมดอายุใหม่สุด
      // (ถ้ามีใบใดเป็นตลอดชีพ ถือว่าตลอดชีพ)
      const spanByTrade = new Map<string, { grant: string; expiry: string | null; lifetime: boolean }>();
      for (const m of members) {
        const tid = String((m as any).trade_id ?? "").trim();
        if (!tid) continue;
        const grant = thDay((m as any).granted_at) || thDay((m as any).created_at) || thMonthStart();
        const expiry = thDay((m as any).expiration) || null;
        const cur = spanByTrade.get(tid);
        spanByTrade.set(tid, {
          grant: cur && cur.grant < grant ? cur.grant : grant,
          expiry: !cur?.expiry ? expiry : (!expiry ? cur.expiry : (cur.expiry > expiry ? cur.expiry : expiry)),
          lifetime: (cur?.lifetime ?? false) || !expiry,
        });
      }
      const periodByTrade = new Map<string, { start: string; end: string }>();
      for (const [tid, span] of spanByTrade) {
        if (forcedStart && forcedEnd) { periodByTrade.set(tid, { start: forcedStart, end: forcedEnd }); continue; }
        periodByTrade.set(tid, lotCycleOf(span.grant, span.lifetime ? null : span.expiry, today));
      }

      // รอบที่ "ปิดแล้ว" (หมดอายุไปแล้ว + เคยตรวจหลังวันหมดอายุ) ยอดนิ่งถาวร ไม่ต้องยิง broker ซ้ำ
      // ทำให้การตรวจรอบหลัง ๆ เหลือยิงแค่รอบที่ยังเดินอยู่ — force: true คือบังคับตรวจใหม่ทั้งหมด
      const force = body?.force === true;
      let earliestStart = today;
      for (const p of periodByTrade.values()) if (p.start < earliestStart) earliestStart = p.start;
      const cachedAt = new Map<string, string>();
      // แบ่งหน้าเอง — PostgREST คืนสูงสุด 1000 แถว/ครั้ง (สมาชิก × รอบย้อนหลัง เกินได้ง่าย)
      for (let from = 0; ; from += 1000) {
        const { data: page } = await db.from("tv_lot_usage")
          .select("trade_id, period_start, period_end, fetched_at").gte("period_end", earliestStart)
          .order("id").range(from, from + 999);
        for (const r of page ?? []) cachedAt.set(`${r.trade_id}|${r.period_start}|${r.period_end}`, String(r.fetched_at));
        if (!page || page.length < 1000) break;
      }

      const groups = new Map<string, string[]>();
      let settled = 0;
      for (const [tid, p] of periodByTrade) {
        const key = `${p.start}|${p.end}`;
        if (!force && p.end < today) {
          const at = cachedAt.get(`${tid}|${key}`);
          if (at && thDay(at) > p.end) { settled++; continue; }
        }
        const list = groups.get(key) ?? [];
        list.push(tid);
        groups.set(key, list);
      }

      const nowIso = new Date().toISOString();
      const entries = [...groups.entries()];
      const upserts: any[] = [];
      const failures: { period: string; members: number; error: string }[] = [];
      let cursor = 0;
      // ยิงพร้อมกัน 6 ช่วง กัน n8n ของ broker รับไม่ทัน — ช่วงเยอะได้ (วัดจริง: 589 คน = 181 ช่วง)
      // แต่ webhook ตอบเร็ว (~0.3 วิ/ครั้ง) รวมแล้วอยู่ในหลักสิบวินาที
      await Promise.all(Array.from({ length: Math.min(6, entries.length) }, async () => {
        while (cursor < entries.length) {
          const [key, tids] = entries[cursor++];
          const [start, end] = key.split("|");
          try {
            const lotByLogin = await fetchBrokerLots(start, end, tids.length === 1 ? tids[0] : undefined);
            for (const tid of tids) {
              const hit = lotByLogin.get(tid);
              upserts.push({
                trade_id: tid, period_start: start, period_end: end,
                lots: hit?.lots ?? 0, excluded_lots: hit?.excluded_lots ?? 0,
                campaign_name: hit?.campaign_name ?? null, fetched_at: nowIso,
              });
            }
          } catch (e) {
            // ช่วงที่ยิงไม่ผ่านต้องไม่เขียนแคชทับ (ไม่งั้นยอดเดิมกลายเป็น 0)
            failures.push({ period: key, members: tids.length, error: String(e instanceof Error ? e.message : e) });
          }
        }
      }));

      for (let i = 0; i < upserts.length; i += 200) {
        const { error } = await db.from("tv_lot_usage").upsert(upserts.slice(i, i + 200), { onConflict: "trade_id,period_start,period_end" });
        if (error) return json({ ok: false, error: error.message });
      }
      if (!upserts.length && failures.length && !settled) {
        return json({ ok: false, error: `ดึงข้อมูล Lot จาก broker ไม่สำเร็จ: ${failures[0].error}` });
      }
      console.log(`[refresh_lots] ${upserts.length} คน / ${entries.length} ช่วงสิทธิ์ · ข้ามรอบที่ปิดแล้ว ${settled} คน · ล้มเหลว ${failures.length} ช่วง`);
      return json({
        ok: true,
        checked: upserts.length,
        matched: upserts.filter((u) => u.lots > 0).length,
        periods: entries.length,
        settled,
        failed_periods: failures.length,
        fetched_at: nowIso,
        ...(failures.length ? { failures: failures.slice(0, 3) } : {}),
      });
    }

    // ---- ยอด Lot ของสมาชิกคนเดียวในช่วงที่ระบุ (หน้ารายละเอียดสมาชิก เลือกช่วงวันเองได้) ----
    // ต่างจาก refresh_lots ตรงที่ยิงเฉพาะ trade_id เดียว จึงเบาพอจะกดดูสด ๆ ระหว่างเปิดดูรายละเอียด
    if (action === "lot_range") {
      const tradeId = String(body?.trade_id || "").trim();
      const start = String(body?.period_start || "").trim();
      const end = String(body?.period_end || "").trim();
      if (!tradeId) return json({ ok: false, error: "ต้องระบุ trade_id" });
      if (!start || !end) return json({ ok: false, error: "ต้องระบุช่วงวันที่ (period_start, period_end)" });
      if (end < start) return json({ ok: false, error: "วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น" });
      try {
        const hit = (await fetchBrokerLots(start, end, tradeId)).get(tradeId);
        const fetchedAt = new Date().toISOString();
        const row = {
          trade_id: tradeId, period_start: start, period_end: end,
          lots: hit?.lots ?? 0, excluded_lots: hit?.excluded_lots ?? 0,
          campaign_name: hit?.campaign_name ?? null, fetched_at: fetchedAt,
        };
        await db.from("tv_lot_usage").upsert(row, { onConflict: "trade_id,period_start,period_end" });
        return json({ ok: true, ...row });
      } catch (e) {
        return json({ ok: false, error: `ดึงยอด Lot จาก broker ไม่สำเร็จ: ${String(e instanceof Error ? e.message : e)}` });
      }
    }

    // ---- ตั้งโควตา Lot เฉพาะราย (ทับค่ากลางของแบรนด์) ----
    // เขียนลงทุกใบอินดิเคเตอร์ของสมาชิกคนนั้น เพราะโควตาเป็นของ "คน" ไม่ใช่ของใบสิทธิ์
    if (action === "set_lot_quota") {
      if (!isAdmin) return json({ ok: false, error: "เฉพาะแอดมิน" }, 403);
      const username = String(body?.username || "").trim();
      if (!username) return json({ ok: false, error: "ต้องระบุ username" });
      const raw = body?.lot_quota;
      const quota = raw === null || raw === "" || raw === undefined ? null : Number(raw);
      if (quota !== null && (!Number.isFinite(quota) || quota < 0)) return json({ ok: false, error: "โควตาต้องเป็นตัวเลขไม่ติดลบ" });
      let q = db.from("tv_access").update({ lot_quota_override: quota, updated_at: new Date().toISOString() }).eq("username", username);
      const brandId = Number(body?.brand_id) || null;
      if (brandId) q = q.eq("brand_id", brandId);
      const { error } = await q;
      if (error) return json({ ok: false, error: error.message });
      return json({ ok: true, username, lot_quota_override: quota });
    }

    // ---- ประวัติ Lot ย้อนหลังรายเดือนของสมาชิกคนเดียว (ใช้ในหน้ารายละเอียดสมาชิก Indicator) ----
    // ยิง broker แยกทีละเดือนพร้อมกัน แล้ว cache ลง tv_lot_usage ไปด้วย ประวัติจะได้สะสมขึ้นเรื่อย ๆ
    // (broker เก็บย้อนหลังไม่ครบทุกเดือน เดือนที่ไม่มีข้อมูลจะได้ 0 ซึ่งแยกไม่ออกจาก "ไม่ได้เทรด" อยู่แล้ว)
    if (action === "lot_history") {
      const tradeId = String(body?.trade_id || "").trim();
      if (!tradeId) return json({ ok: false, error: "ต้องระบุ trade_id" });
      const months = Math.min(12, Math.max(1, Number(body?.months) || 5));

      // เดือนย้อนหลังตามเวลาไทย (เดือนปัจจุบันเป็นตัวแรก)
      const nowTh = new Date(Date.now() + 7 * 3600 * 1000);
      const periods: { start: string; end: string }[] = [];
      for (let i = 0; i < months; i++) {
        const y = nowTh.getUTCFullYear(), m = nowTh.getUTCMonth() - i;
        periods.push({
          start: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
          end: new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10),
        });
      }

      const rows = await Promise.all(periods.map(async (p) => {
        try {
          const hit = (await fetchBrokerLots(p.start, p.end, tradeId)).get(tradeId);
          return { ...p, lots: hit?.lots ?? 0, excluded_lots: hit?.excluded_lots ?? 0, campaign_name: hit?.campaign_name ?? null, ok: true };
        } catch (e) {
          // เดือนที่ยิงไม่สำเร็จต้องบอกว่าไม่สำเร็จ ไม่ใช่โชว์ 0 (แยกไม่ออกจาก "ไม่ได้เทรด") และไม่ cache ทับของเดิม
          return { ...p, lots: 0, excluded_lots: 0, campaign_name: null, ok: false, error: String(e instanceof Error ? e.message : e) };
        }
      }));

      const fetchedAt = new Date().toISOString();
      const upserts = rows.filter((r) => r.ok).map((r) => ({
        trade_id: tradeId, period_start: r.start, period_end: r.end,
        lots: r.lots, excluded_lots: r.excluded_lots, campaign_name: r.campaign_name, fetched_at: fetchedAt,
      }));
      if (upserts.length) await db.from("tv_lot_usage").upsert(upserts, { onConflict: "trade_id,period_start,period_end" });

      return json({ ok: true, trade_id: tradeId, months: rows, fetched_at: fetchedAt });
    }

    return json({ ok: false, error: `ไม่รู้จัก action "${action}"` });
  } catch (err) {
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 200);
  }
});
