import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "content-type": "application/json" },
});
const PAGE_SIZE = 50;
const MAX_ROWS = 50_000;
const SELECT_COLUMNS = "id,customer_name,page_id,page_name,trade_id,phone,email,username,psid,source,entry_ad_id,entry_ad_name,comment_ad_name,comment_ad_names,comment_ad_ids,comment_is_ad,last_user_text,user_message_count,message_count,first_customer_message_at,last_message_at,stage,stage_manual,meta_push_status,meta_push_at,meta_push_error";
const VALID_DATE_FILTERS = new Set(["all", "today", "yesterday", "last3", "this_week", "last_week", "this_month", "last_month", "this_year", "last_year", "7", "30", "90", "custom"]);
const SORT_COLUMNS: Record<string, string> = {
  customer_name: "customer_name", page_name: "page_name", trade_id: "trade_id", phone: "phone",
  email: "email", username: "username", psid: "psid", source: "source", messages: "user_message_count",
  stage: "stage", first_customer_message_at: "first_customer_message_at", last_message_at: "first_customer_message_at", synced_at: "first_customer_message_at",
};

const clean = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
const bangkokDateParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: get("year"), month: get("month"), day: get("day") };
};
const calendarDate = (parts: { year: number; month: number; day: number }) => new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
const shift = (parts: { year: number; month: number; day: number }, days: number) => {
  const date = calendarDate(parts); date.setUTCDate(date.getUTCDate() + days);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
};
const isoStart = (parts: { year: number; month: number; day: number }) => new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - 7 * 3600e3).toISOString();
const presetRange = (preset: string, from: string, to: string, now = new Date()) => {
  if (preset === "all") return { from: null, to: null };
  if (preset === "custom") {
    const start = new Date(`${from}T00:00:00+07:00`);
    const end = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 864e5);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  if (["7", "30", "90"].includes(preset)) return { from: new Date(now.getTime() - Number(preset) * 864e5).toISOString(), to: null };
  const today = bangkokDateParts(now), tomorrow = shift(today, 1);
  if (preset === "today") return { from: isoStart(today), to: isoStart(tomorrow) };
  if (preset === "yesterday") return { from: isoStart(shift(today, -1)), to: isoStart(today) };
  if (preset === "last3") return { from: isoStart(shift(today, -2)), to: isoStart(tomorrow) };
  const daysSinceMonday = (calendarDate(today).getUTCDay() + 6) % 7;
  const monday = shift(today, -daysSinceMonday);
  if (preset === "this_week") return { from: isoStart(monday), to: isoStart(tomorrow) };
  if (preset === "last_week") return { from: isoStart(shift(monday, -7)), to: isoStart(monday) };
  const monthStart = { year: today.year, month: today.month, day: 1 };
  const previousMonth = today.month === 1 ? { year: today.year - 1, month: 12, day: 1 } : { year: today.year, month: today.month - 1, day: 1 };
  if (preset === "this_month") return { from: isoStart(monthStart), to: isoStart(tomorrow) };
  if (preset === "last_month") return { from: isoStart(previousMonth), to: isoStart(monthStart) };
  const yearStart = { year: today.year, month: 1, day: 1 };
  if (preset === "this_year") return { from: isoStart(yearStart), to: isoStart(tomorrow) };
  if (preset === "last_year") return { from: isoStart({ year: today.year - 1, month: 1, day: 1 }), to: isoStart(yearStart) };
  return { from: null, to: null };
};

async function cacheKey(pageId: string, dateFilter: string, dateFrom: string, dateTo: string) {
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 2, pageId, dateFilter, dateFrom, dateTo }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const pageId = clean(body.page_id, 100);
    const dateFilter = clean(body.date_filter, 30);
    const dateFrom = clean(body.date_from, 10);
    const dateTo = clean(body.date_to, 10);
    if (!pageId) return json({ ok: false, error: "กรุณาเลือกเพจ" }, 400);
    if (!VALID_DATE_FILTERS.has(dateFilter)) return json({ ok: false, error: "กรุณาเลือกช่วงเวลา" }, 400);
    if (dateFilter === "custom" && (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || dateFrom > dateTo)) {
      return json({ ok: false, error: "ช่วงวันที่กำหนดเองไม่ถูกต้อง" }, 400);
    }
    // สิทธิ์ตอบแชทไม่ผูกกับเพจ — ใครเข้าหน้าตอบแชทได้ ก็ตอบได้ทุกเพจและทุก LINE OA (รีพอร์ตอ่านจากแชทชุดเดียวกัน จึงไม่จำกัดรายเพจ)
    const auth = await authorizeRequest(req, { tab: "customerdb" });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const key = await cacheKey(pageId, dateFilter, dateFrom, dateTo);
    if (body.action === "invalidate") {
      const { error } = await admin.from("customer_report_cache").delete().eq("page_id", pageId);
      if (error) throw error;
      return json({ ok: true, invalidated: true });
    }
    const force = body.force === true;
    let snapshot: any = null;
    let servedFromCache = false;
    if (!force) {
      const { data } = await admin.from("customer_report_cache").select("rows,total,refreshed_at,refreshed_by").eq("cache_key", key).maybeSingle();
      snapshot = data;
      servedFromCache = !!data;
    }
    if (!snapshot) {
      const range = presetRange(dateFilter, dateFrom, dateTo);
      const allRows: any[] = [];
      for (let from = 0; from < MAX_ROWS; from += 1000) {
        let query = admin.from("chat_customers").select(SELECT_COLUMNS).eq("page_id", pageId);
        if (range.from) query = query.gte("first_customer_message_at", range.from);
        if (range.to) query = query.lt("first_customer_message_at", range.to);
        const { data, error } = await query.order("first_customer_message_at", { ascending: false, nullsFirst: false }).range(from, from + 999);
        if (error) throw error;
        allRows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      const refreshedAt = new Date().toISOString();
      snapshot = { rows: allRows, total: allRows.length, refreshed_at: refreshedAt, refreshed_by: auth.permission?.email || auth.user?.email || null };
      const { error } = await admin.from("customer_report_cache").upsert({
        cache_key: key, page_id: pageId, date_filter: dateFilter, date_from: dateFrom || null, date_to: dateTo || null,
        rows: allRows, total: allRows.length, refreshed_at: refreshedAt, refreshed_by: snapshot.refreshed_by,
      });
      if (error) throw error;
      await admin.from("customer_report_cache").delete().lt("refreshed_at", new Date(Date.now() - 30 * 864e5).toISOString());
    }

    let rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
    const stage = clean(body.stage_filter, 40) || "all";
    const dataFilter = clean(body.data_filter, 20) || "all";
    const source = clean(body.source_filter, 20) || "all";
    const search = clean(body.q, 200).toLocaleLowerCase("th-TH");
    if (stage !== "all") rows = rows.filter((row) => row.stage === stage);
    if (dataFilter === "has") rows = rows.filter((row) => row.phone || row.trade_id || row.username);
    if (dataFilter === "none") rows = rows.filter((row) => !row.phone && !row.trade_id && !row.username);
    if (source === "ad") rows = rows.filter((row) => row.source === "ad" || row.entry_ad_id);
    if (source === "organic") rows = rows.filter((row) => row.source === "organic");
    if (source === "unknown") rows = rows.filter((row) => !row.entry_ad_id && !["ad", "organic"].includes(row.source));
    if (search) {
      const fields = ["customer_name", "phone", "trade_id", "username", "email", "psid", "last_user_text", "page_name", "entry_ad_id"];
      rows = rows.filter((row) => fields.some((field) => String(row[field] ?? "").toLocaleLowerCase("th-TH").includes(search)));
    }
    const sortColumn = SORT_COLUMNS[clean(body.sort_key, 40)] || "first_customer_message_at";
    const direction = body.sort_dir === "asc" ? 1 : -1;
    rows.sort((a, b) => String(a[sortColumn] ?? "").localeCompare(String(b[sortColumn] ?? ""), "th", { numeric: true }) * direction);
    const page = Math.max(1, Math.floor(Number(body.page) || 1));
    const total = rows.length;
    const start = (page - 1) * PAGE_SIZE;
    return json({
      ok: true, rows: rows.slice(start, start + PAGE_SIZE), total, cached: servedFromCache,
      refreshed_at: snapshot.refreshed_at, refreshed_by: snapshot.refreshed_by,
    });
  } catch (error) {
    return json({ ok: false, error: String(error instanceof Error ? error.message : error) }, 500);
  }
});
