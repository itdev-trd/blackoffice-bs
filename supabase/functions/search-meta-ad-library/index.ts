import { getMetaToken } from "../_shared/meta.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { RequestError, errorResponse, readJsonBody } from "../_shared/security.ts";

const GRAPH_BASE = "https://graph.facebook.com/v22.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function csv(value: unknown) {
  return String(value || "").split(/[\n,]/).map((v) => v.trim()).filter(Boolean).slice(0, 20);
}

function query(params: Record<string, string>) {
  return Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
}

async function pageAll(url: string, token: string) {
  const rows: any[] = [];
  let next = `${url}&access_token=${encodeURIComponent(token)}`;
  let truncated = false;
  for (let page = 0; page < 20 && next; page++) {
    const response = await fetch(next, { signal: AbortSignal.timeout(20_000) });
    const payload = await response.json().catch(() => ({}));
    if (payload?.error) throw new RequestError(502, `Meta Ad Library: ${payload.error.message || "เรียกข้อมูลไม่สำเร็จ"}`, "meta_api_error");
    if (!response.ok) throw new RequestError(502, `Meta Ad Library ตอบกลับสถานะ ${response.status}`, "meta_api_error");
    rows.push(...(payload?.data || []));
    next = payload?.paging?.next || "";
  }
  if (next) truncated = true;
  return { rows, truncated };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { tab: ["ad_library", "analyze"] });
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });
    const body = await readJsonBody(req, 32 * 1024);
    const terms = csv(body?.search_terms);
    const countries = csv(body?.ad_reached_countries || "TH").map((v) => v.toUpperCase());
    if (!terms.length) throw new RequestError(400, "กรุณาใส่คีย์เวิร์ดหรือชื่อเพจอย่างน้อย 1 คำ", "missing_terms");
    if (!countries.length) throw new RequestError(400, "กรุณาเลือกประเทศอย่างน้อย 1 ประเทศ", "missing_country");
    const token = await getMetaToken();
    if (!token) throw new RequestError(400, "ยังไม่ได้ตั้งค่า Meta access token ในหน้าตั้งค่า", "missing_token");
    const fields = [
      "id", "page_id", "page_name", "ad_creation_time", "ad_delivery_start_time", "ad_delivery_stop_time",
      "ad_snapshot_url", "currency", "spend", "impressions", "reach", "publisher_platforms", "languages",
      "demographic_distribution", "delivery_by_region", "funding_entity", "disclaimer",
    ].join(",");
    const params = query({
      search_terms: terms.join(" "), ad_reached_countries: JSON.stringify(countries), ad_type: body?.ad_type || "ALL",
      ad_active_status: body?.ad_active_status || "ACTIVE", fields, limit: "50",
      ...(body?.search_page_ids ? { search_page_ids: csv(body.search_page_ids).join(",") } : {}),
      ...(body?.delivery_date_min ? { ad_delivery_date_min: String(body.delivery_date_min) } : {}),
      ...(body?.delivery_date_max ? { ad_delivery_date_max: String(body.delivery_date_max) } : {}),
    });
    const result = await pageAll(`${GRAPH_BASE}/ads_archive?${params}`, token);
    const ads = result.rows.map((ad) => ({
      ...ad,
      reached_countries: countries,
      // ชื่อฟิลด์อ่านง่ายสำหรับหน้าเว็บ โดยยังเก็บ payload จาก Meta ไว้ครบเท่าที่ API คืนมา
      has_delivery_data: Boolean(ad.impressions || ad.reach || ad.spend),
    }));
    return new Response(JSON.stringify({ ok: true, ads, count: ads.length, truncated: result.truncated, query: { terms, countries, status: body?.ad_active_status || "ACTIVE", ad_type: body?.ad_type || "ALL" }, note: "ประเทศคือประเทศที่โฆษณาเข้าถึงตาม Ad Library ไม่ใช่ targeting ที่ Meta ไม่เปิดเผยในข้อมูลสาธารณะ" }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
