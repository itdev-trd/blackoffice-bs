import { getMetaToken } from "../_shared/meta.ts";
import { authorizeRequest, normAcc } from "../_shared/permissions.ts";
import { errorResponse, readJsonBody } from "../_shared/security.ts";

const GRAPH_BASE = "https://graph.facebook.com/v22.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_CAMPAIGNS = 500;
const MAX_ADSETS = 1500;
const MAX_ADS = 3000;
const MAX_RESULTS = 300;

async function graphPage(path: string, token: string, maxPages = 12) {
  const rows: any[] = [];
  let url = `${GRAPH_BASE}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  let truncated = false;
  for (let page = 0; page < maxPages && url; page++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const payload = await response.json().catch(() => ({}));
    if (payload?.error) throw new Error(payload.error.message || "Meta API error");
    rows.push(...(payload?.data || []));
    url = payload?.paging?.next || "";
  }
  if (url) truncated = true;
  return { rows, truncated };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    results.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  }
  return results;
}

function textFrom(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textFrom).join(" ");
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).map(textFrom).join(" ");
  return "";
}

function geoInfo(targeting: any) {
  const geo = targeting?.geo_locations || {};
  const countries = [...new Set((geo.countries || []).map((v: unknown) => String(v).toUpperCase()).filter(Boolean))];
  const regions = Array.isArray(geo.regions) ? geo.regions.length : 0;
  const cities = Array.isArray(geo.cities) ? geo.cities.length : 0;
  const zips = Array.isArray(geo.zips) ? geo.zips.length : 0;
  const otherGeo = regions + cities + zips;
  let geoMode = "broad_or_custom";
  if (countries.length) geoMode = "countries";
  else if (otherGeo) geoMode = "regions_or_cities";
  return { countries, regions, cities, zips, geo_mode: geoMode };
}

function cleanKeyword(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { tab: ["analyze", "campaigns", "overview"] });
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });

    const body = await readJsonBody(req, 32 * 1024);
    const accountId = normAcc(body?.ad_account_id);
    const keywords = [...new Set((Array.isArray(body?.keywords) ? body.keywords : String(body?.keywords || "").split(/[\n,]/)).map(cleanKeyword).filter((v) => v.length >= 2).slice(0, 30))];
    if (!accountId) throw new Error("กรุณาเลือกบัญชีโฆษณา");
    if (!keywords.length) throw new Error("กรุณาใส่คีย์เวิร์ดอย่างน้อย 1 คำ");
    if (auth.permission?.role === "analyze_only" && !(auth.permission.allowed || []).map(normAcc).includes(accountId)) {
      return new Response(JSON.stringify({ ok: false, error: "คุณไม่มีสิทธิ์ตรวจบัญชีโฆษณานี้" }), { status: 403, headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    const token = await getMetaToken();
    if (!token) throw new Error("ยังไม่ได้ตั้งค่า Meta access token");
    const campaignPage = await graphPage(`/act_${accountId}/campaigns?fields=id,name,status,effective_status&limit=200`, token);
    const campaigns = campaignPage.rows.slice(0, MAX_CAMPAIGNS);
    const adsetGroups = await mapLimit(campaigns, 5, async (campaign) => {
      const page = await graphPage(`/${campaign.id}/adsets?fields=id,name,status,effective_status,targeting&limit=200`, token, 8);
      return page.rows.map((adset) => ({ ...adset, campaign }));
    });
    const adsets = adsetGroups.flat().slice(0, MAX_ADSETS);
    const adGroups = await mapLimit(adsets, 5, async (adset) => {
      const page = await graphPage(`/${adset.id}/ads?fields=id,name,status,effective_status,creative{id,name,title,body,link_url,object_story_spec}&limit=200`, token, 8);
      return page.rows.map((ad) => ({ ...ad, adset }));
    });
    const ads = adGroups.flat().slice(0, MAX_ADS);

    const normalizedKeywords = keywords.map((keyword) => ({ original: keyword, value: keyword.toLocaleLowerCase("th-TH") }));
    const matches = ads.flatMap((ad) => {
      const creative = ad.creative || {};
      const haystack = textFrom([ad.name, creative.name, creative.title, creative.body, creative.link_url, creative.object_story_spec]).toLocaleLowerCase("th-TH");
      const matched = normalizedKeywords.filter((keyword) => haystack.includes(keyword.value)).map((keyword) => keyword.original);
      if (!matched.length) return [];
      const geo = geoInfo(ad.adset?.targeting);
      return [{
        ad_id: ad.id, ad_name: ad.name || "ไม่มีชื่อโฆษณา", status: ad.status, effective_status: ad.effective_status,
        campaign_id: ad.adset?.campaign?.id, campaign_name: ad.adset?.campaign?.name || "ไม่มีชื่อแคมเปญ",
        adset_id: ad.adset?.id, adset_name: ad.adset?.name || "ไม่มีชื่อชุดโฆษณ", matched_keywords: matched,
        countries: geo.countries, geo_mode: geo.geo_mode, geo_details: { regions: geo.regions, cities: geo.cities, zips: geo.zips },
        creative_text: textFrom([creative.title, creative.body, creative.link_url]).trim().slice(0, 280),
      }];
    }).slice(0, MAX_RESULTS);

    const countryMap = new Map<string, { country_code: string; matched_ads: number; keywords: Set<string> }>();
    for (const match of matches) for (const code of match.countries) {
      const row = countryMap.get(code) || { country_code: code, matched_ads: 0, keywords: new Set<string>() };
      row.matched_ads++;
      match.matched_keywords.forEach((keyword: string) => row.keywords.add(keyword));
      countryMap.set(code, row);
    }
    const summary = [...countryMap.values()].sort((a, b) => b.matched_ads - a.matched_ads).map((row) => ({ ...row, keywords: [...row.keywords] }));
    return new Response(JSON.stringify({
      ok: true, account_id: accountId, keywords, scanned: { campaigns: campaigns.length, adsets: adsets.length, ads: ads.length },
      truncated: campaignPage.truncated || campaigns.length >= MAX_CAMPAIGNS || adsets.length >= MAX_ADSETS || ads.length >= MAX_ADS,
      matched_ads: matches.length, summary, matches,
      note: "ประเทศในผลลัพธ์คือประเทศที่ตั้งเป้าไว้ใน Ad Set ไม่ใช่รายงานการส่งมอบจริงจาก Insights; แอดที่ยิงกว้างหรือกำหนดเป็นเมือง/ภูมิภาคจะแสดงสถานะให้ตรวจสอบเพิ่ม",
    }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
