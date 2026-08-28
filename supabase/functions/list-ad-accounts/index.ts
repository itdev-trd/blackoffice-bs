// supabase/functions/list-ad-accounts/index.ts
// คืนรายการบัญชีโฆษณาทั้งหมดที่ token เข้าถึงได้ (รวมจากทุก Business Portfolio)
// ปรับให้เบา ไม่โดน Meta rate limit:
//   - ใช้ /me/adaccounts เป็นหลัก (User token มักคืนบัญชีครบอยู่แล้ว) + ได้ชื่อธุรกิจจาก field business
//   - ไล่ owned/client รายธุรกิจ "เฉพาะเมื่อจำเป็น" (บัญชีตรงน้อย = น่าจะเป็น System User) แบบจำกัดจำนวน+throttle
//   - cache ผลไว้ 10 นาทีใน app_secrets (ส่ง { refresh: true } เพื่อดึงใหม่)
//
// token มาจาก app_secrets (ตั้งในหน้าเว็บ) หรือ env META_ACCESS_TOKEN

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { authorizeRequest, normAcc } from "../_shared/permissions.ts";
import { errorResponse, readJsonBody } from "../_shared/security.ts";

const GRAPH_VERSION = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const STATUS_LABEL: Record<number, string> = {
  1: "ใช้งานอยู่", 2: "ปิดใช้งาน", 3: "ยังไม่ชำระเงิน", 7: "รอตรวจสอบ", 8: "รอตรวจสอบ", 9: "อยู่ระหว่างพิจารณา", 101: "ปิดถาวร",
};
const ACC_FIELDS = "account_id,name,currency,account_status,timezone_name,business{id,name}";
const CACHE_TTL_MS = 10 * 60 * 1000;

function isRateLimit(err: any) {
  const m = (err?.message || "").toLowerCase();
  return err?.code === 17 || err?.code === 4 || err?.code === 32 || m.includes("request limit") || m.includes("rate limit");
}

async function pageEdge(startUrl: string, maxPages = 3): Promise<{ rows: any[]; error: any }> {
  const out: any[] = [];
  let url = startUrl;
  let error: any = null;
  for (let i = 0; i < maxPages && url; i++) {
    try {
      const resp = await fetch(url);
      const data = await resp.json();
      if (data?.error) { error = data.error; break; }
      for (const row of data?.data ?? []) out.push(row);
      url = data?.paging?.next ?? "";
    } catch (e) { error = { message: String(e) }; break; }
  }
  return { rows: out, error };
}

// รัน task ทีละ N ตัว (จำกัด concurrency) กันยิงถี่เกิน
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const res: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    res.push(...(await Promise.all(batch.map(fn))));
  }
  return res;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { tab: ["analyze", "campaigns", "overview"] });
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });

    // สิทธิ์ผู้ใช้: analyze_only เห็นเฉพาะบัญชีใน allowlist (กันฝั่ง server)
    const perm = auth.permission;
    const restrictAccounts = (list: any[]) => {
      if (perm?.role !== "analyze_only") return list;
      const allow = new Set((perm.allowed || []).map(normAcc));
      return (list || []).filter((a: any) => allow.has(normAcc(a.account_id)));
    };

    const token = await getMetaToken();
    if (!token) throw new Error("ยังไม่ได้ตั้งค่า Meta access token (ตั้งได้ในหน้าตั้งค่า)");
    const base = `https://graph.facebook.com/${GRAPH_VERSION}`;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await readJsonBody(req, 32 * 1024);
    const forceRefresh = body?.refresh === true;

    // ---- cache ----
    if (!forceRefresh) {
      const { data: cacheRow } = await admin.from("app_secrets").select("value, updated_at").eq("key", "meta_accounts_cache").maybeSingle();
      if (cacheRow?.value && cacheRow.updated_at && Date.now() - new Date(cacheRow.updated_at).getTime() < CACHE_TTL_MS) {
        try {
          const cached = JSON.parse(cacheRow.value);
          const accts = restrictAccounts(cached.accounts || []);
          return new Response(JSON.stringify({ ok: true, cached: true, ...cached, accounts: accts, count: accts.length }), { headers: { ...corsHeaders, "content-type": "application/json" } });
        } catch (_e) { /* cache เสีย ข้ามไปดึงใหม่ */ }
      }
    }

    const byId: Record<string, any> = {};
    const add = (a: any, business?: string) => {
      if (!a?.account_id) return;
      const biz = business || a.business?.name || null;
      if (!byId[a.account_id]) {
        byId[a.account_id] = {
          account_id: a.account_id, name: a.name, currency: a.currency, timezone: a.timezone_name,
          status: a.account_status, status_label: STATUS_LABEL[a.account_status] || String(a.account_status), business: biz,
        };
      } else if (biz && !byId[a.account_id].business) byId[a.account_id].business = biz;
    };

    let rateLimited = false;

    // 1) แหล่งหลัก: /me/adaccounts (User token มักครบอยู่แล้ว)
    const direct = await pageEdge(`${base}/me/adaccounts?fields=${ACC_FIELDS}&limit=500&access_token=${token}`);
    direct.rows.forEach((a) => add(a));
    if (isRateLimit(direct.error)) rateLimited = true;

    // 2) ไล่รายธุรกิจ "เฉพาะเมื่อบัญชีตรงน้อย" (เคส System User) เพื่อลดการยิง API
    let enumerated = false;
    if (byId && Object.keys(byId).length < 5 && !rateLimited) {
      const biz = await pageEdge(`${base}/me/businesses?fields=id,name&limit=100&access_token=${token}`, 2);
      if (isRateLimit(biz.error)) rateLimited = true;
      const bizMap: Record<string, string> = {};
      biz.rows.forEach((b: any) => { if (b.id) bizMap[b.id] = b.name; });
      direct.rows.forEach((a: any) => { if (a.business?.id) bizMap[a.business.id] = a.business.name; });
      const entries = Object.entries(bizMap).slice(0, 40);
      enumerated = entries.length > 0;
      await mapLimit(entries, 3, async ([bid, bname]) => {
        const owned = await pageEdge(`${base}/${bid}/owned_ad_accounts?fields=${ACC_FIELDS}&limit=500&access_token=${token}`, 1);
        const client = await pageEdge(`${base}/${bid}/client_ad_accounts?fields=${ACC_FIELDS}&limit=500&access_token=${token}`, 1);
        if (isRateLimit(owned.error) || isRateLimit(client.error)) rateLimited = true;
        owned.rows.forEach((a: any) => add(a, bname as string));
        client.rows.forEach((a: any) => add(a, bname as string));
      });
    }

    const accounts = Object.values(byId).sort((a: any, b: any) => String(a.name || "").localeCompare(String(b.name || "")));
    const payload = {
      count: accounts.length,
      accounts,
      debug: { direct_count: direct.rows.length, enumerated, rate_limited: rateLimited, direct_error: direct.error?.message ?? null },
    };

    // เก็บ cache (ถ้าไม่โดน rate limit จนได้ข้อมูลน้อยผิดปกติ)
    if (accounts.length > 0) {
      await admin.from("app_secrets").upsert({ key: "meta_accounts_cache", value: JSON.stringify(payload), updated_at: new Date().toISOString() });
    }

    const visibleAccounts = restrictAccounts(payload.accounts);
    return new Response(JSON.stringify({ ok: true, cached: false, ...payload, accounts: visibleAccounts, count: visibleAccounts.length }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
