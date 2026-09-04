// supabase/functions/list-campaigns/index.ts
// คืนรายการแคมเปญของบัญชีโฆษณาที่เลือก (พร้อมสถานะ/วัตถุประสงค์/งบ)
// ใช้ในหน้า "วิเคราะห์" ให้ผู้ใช้เลือกแคมเปญที่ต้องการดึงผล
//
// Secrets: META_ACCESS_TOKEN

import { getMetaToken } from "../_shared/meta.ts";
import { authorizeRequest, normAcc } from "../_shared/permissions.ts";
import { cacheGet, cacheSet, listCacheTtlMs } from "../_shared/meta-cache.ts";
import { errorResponse, readJsonBody } from "../_shared/security.ts";
import { buildMetrics } from "../_shared/ad-metrics.ts";

const GRAPH_VERSION = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ตัวชี้วัดทั้งหมดย้ายไป _shared/ad-metrics.ts แล้ว — เดิมไฟล์นี้กับ list-children
// คำนวณแยกกันและ LEAD_TYPES ไม่เท่ากันด้วย ทั้งที่คอมเมนต์เขียนว่า "เป๊ะเหมือนกัน"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { tab: ["analyze", "campaigns", "overview"] });
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });

    const token = await getMetaToken();
    if (!token) throw new Error("ยังไม่ได้ตั้งค่า Meta access token (ตั้งได้ในหน้าตั้งค่า)");

    const { ad_account_id, refresh, date_preset, time_range } = await readJsonBody(req, 32 * 1024);
    if (!ad_account_id) throw new Error("ต้องส่ง ad_account_id");

    // สิทธิ์: analyze_only เข้าถึงได้เฉพาะบัญชีใน allowlist (กันฝั่ง server)
    const perm = auth.permission;
    if (perm?.role === "analyze_only") {
      const allow = new Set((perm.allowed || []).map(normAcc));
      if (!allow.has(normAcc(ad_account_id))) {
        return new Response(JSON.stringify({ ok: false, error: "ไม่มีสิทธิ์เข้าถึงบัญชีนี้" }), {
          status: 403, headers: { ...corsHeaders, "content-type": "application/json" },
        });
      }
    }

    const act = String(ad_account_id).startsWith("act_") ? ad_account_id : `act_${ad_account_id}`;

    // shared cache: ใครดึงบัญชีนี้แล้ว user อื่นได้เลย ไม่ยิง Meta ซ้ำ (ลด #17 ต่อบัญชี)
    // ช่วงวันต้องอยู่ใน cache key ด้วย ไม่งั้นสลับ 7 วัน/30 วันแล้วได้ตัวเลขชุดเดิมจาก cache
    const rangeKey = time_range?.since && time_range?.until
      ? `${time_range.since}..${time_range.until}`
      : (typeof date_preset === "string" ? date_preset : "last_30d");
    const cacheKey = `campaigns:${act}:${rangeKey}`;
    if (refresh !== true) {
      const hit = await cacheGet(cacheKey, await listCacheTtlMs());
      if (hit) return new Response(JSON.stringify({ ok: true, campaigns: hit.payload, cached: true, fetched_at: hit.fetched_at }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    const rangeExpr = time_range?.since && time_range?.until
      ? `insights.time_range(${JSON.stringify({ since: time_range.since, until: time_range.until })})`
      : `insights.date_preset(${typeof date_preset === "string" ? date_preset : "last_30d"})`;
    const insightFields = "spend,impressions,reach,frequency,clicks,ctr,cpm,cpc,inline_link_clicks,actions";
    // adsets{optimization_goal} = ตัวบอกว่า Meta นับอะไรเป็น "ผลลัพธ์" ของแคมเปญนี้
    // ดึงมาพร้อมกันด้วย field expansion ไม่เสีย request เพิ่ม
    const fields = `id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,adsets.limit(50){optimization_goal},${rangeExpr}{${insightFields}}`;

    const campaigns: Record<string, unknown>[] = [];
    let url =
      `https://graph.facebook.com/${GRAPH_VERSION}/${act}/campaigns` +
      `?fields=${encodeURIComponent(fields)}&limit=200&access_token=${token}`;
    for (let i = 0; i < 5 && url; i++) {
      const resp = await fetch(url);
      const data = await resp.json();
      if (data?.error) throw new Error(data.error.message || "Meta error");
      for (const c of data?.data ?? []) {
        campaigns.push({
          id: c.id,
          name: c.name,
          status: c.status,
          effective_status: c.effective_status,
          objective: c.objective,
          // Meta ส่งงบมาเป็นหน่วยสตางค์ — หารร้อยแล้วห้ามปัดทิ้ง ไม่งั้นยอดไม่ตรงกับ Ads Manager
          // (ฝ่ายบัญชีใช้ตัวเลขนี้กระทบยอด จึงต้องเก็บทศนิยมไว้)
          daily_budget_thb: c.daily_budget ? Number((parseFloat(c.daily_budget) / 100).toFixed(2)) : null,
          lifetime_budget_thb: c.lifetime_budget ? Number((parseFloat(c.lifetime_budget) / 100).toFixed(2)) : null,
          start_time: c.start_time ?? null,
          stop_time: c.stop_time ?? null,
          metrics: buildMetrics(c.insights?.data?.[0] ?? {}, {
            goals: (c.adsets?.data ?? []).map((a: any) => a?.optimization_goal).filter(Boolean),
            objective: c.objective,
          }),
        });
      }
      url = data?.paging?.next ?? "";
    }

    const nowIso = new Date().toISOString();
    await cacheSet(cacheKey, act, "campaigns", rangeKey, campaigns);
    return new Response(JSON.stringify({ ok: true, campaigns, cached: false, fetched_at: nowIso }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
