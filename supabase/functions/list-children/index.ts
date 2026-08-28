// supabase/functions/list-children/index.ts
// ดึง "ลูก" ของ node พร้อม insight ต่อชิ้น เพื่อทำ drill-down ในหน้ารายงาน
//   level "adsets" -> /{campaign_id}/adsets  (ชุดโฆษณาในแคมเปญ)
//   level "ads"    -> /{adset_id}/ads         (โฆษณาในชุดโฆษณา)
// รองรับช่วงวัน (date_preset หรือ time_range) เหมือนหน้าอื่น
//
// token มาจาก app_secrets (ตั้งในหน้าเว็บ) หรือ env META_ACCESS_TOKEN

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { canAccessMetaNodes } from "../_shared/meta-authorization.ts";
import { cacheGet, cacheSet, listCacheTtlMs } from "../_shared/meta-cache.ts";

const GRAPH_VERSION = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LEAD_TYPES = ["lead", "onsite_conversion.lead_grouped"];
const num = (v: unknown) => (v == null ? 0 : parseFloat(String(v)) || 0);
function leads(actions: any[]) {
  return (actions || []).filter((a) => LEAD_TYPES.includes(a.action_type)).reduce((s, a) => s + num(a.value), 0);
}
function sumBy(actions: any[], m: (t: string) => boolean) {
  return (actions || []).filter((a) => m(a.action_type)).reduce((s, a) => s + num(a.value), 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const token = await getMetaToken();
    if (!token) throw new Error("ยังไม่ได้ตั้งค่า Meta access token (ตั้งได้ในหน้าตั้งค่า)");

    const { parent_id, level, date_preset, time_range, refresh } = await req.json();
    if (!parent_id) throw new Error("ต้องส่ง parent_id");
    const auth = await authorizeRequest(req, { tab: ["campaigns", "analyze", "overview"] });
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });
    if (auth.permission && !(await canAccessMetaNodes(auth.permission, token, [parent_id], GRAPH_VERSION))) {
      return new Response(JSON.stringify({ ok: false, error: "ไม่มีสิทธิ์เข้าถึงบัญชีโฆษณานี้" }), { status: 403, headers: { ...corsHeaders, "content-type": "application/json" } });
    }
    const edge = level === "ads" ? "ads" : "adsets";

    // shared cache: ต่อ parent+ระดับ+ช่วงเวลา — ใครดึงแล้ว user อื่น/export/prefetch ใช้ร่วมกัน ไม่ยิง Meta ซ้ำ
    const rangeKey = (time_range?.since && time_range?.until) ? `tr:${time_range.since}_${time_range.until}` : (typeof date_preset === "string" ? date_preset : "last_30d");
    const cacheKey = `children:${parent_id}:${edge}:${rangeKey}`;
    if (refresh !== true) {
      const hit = await cacheGet(cacheKey, await listCacheTtlMs());
      if (hit) return new Response(JSON.stringify({ ok: true, level: edge, parent_id, nodes: hit.payload, cached: true, fetched_at: hit.fetched_at }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    // insight subfield ตามช่วงวัน (field expansion)
    const rangeExpr =
      time_range && time_range.since && time_range.until
        ? `insights.time_range(${JSON.stringify({ since: time_range.since, until: time_range.until })})`
        : `insights.date_preset(${typeof date_preset === "string" ? date_preset : "last_30d"})`;
    const insightFields = "spend,impressions,reach,frequency,clicks,ctr,cpm,cpc,inline_link_clicks,actions";
    const baseFields =
      edge === "adsets"
        ? `id,name,status,effective_status,daily_budget,${rangeExpr}{${insightFields}}`
        : `id,name,status,effective_status,created_time,updated_time,creative{thumbnail_url},${rangeExpr}{${insightFields}}`;

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${parent_id}/${edge}?fields=${encodeURIComponent(baseFields)}&limit=200&access_token=${token}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data?.error) throw new Error(data.error.message || "Meta error");

    const nodes = (data?.data ?? []).map((n: any) => {
      const o = n.insights?.data?.[0] ?? {};
      const spend = num(o.spend);
      const lead = leads(o.actions);
      const conversations = sumBy(o.actions, (t) => t.includes("messaging_conversation_started"));
      const replies = sumBy(o.actions, (t) => t.includes("messaging_user_depth_2_message_send"));
      return {
        id: n.id,
        name: n.name,
        status: n.status,
        effective_status: n.effective_status,
        created_time: n.created_time || null,
        updated_time: n.updated_time || null,
        thumbnail: n.creative?.thumbnail_url || null,
        daily_budget_thb: n.daily_budget ? Math.round(num(n.daily_budget) / 100) : null,
        metrics: {
          spend,
          impressions: num(o.impressions),
          reach: num(o.reach),
          frequency: num(o.frequency),
          clicks: num(o.clicks),
          link_clicks: num(o.inline_link_clicks),
          ctr: num(o.ctr),
          cpm: num(o.cpm),
          cpc: num(o.cpc),
          leads: lead,
          cpl: lead > 0 ? spend / lead : null,
          conversations,
          replies,
          reply_rate: conversations > 0 ? replies / conversations : null,
        },
      };
    });

    await cacheSet(cacheKey, String(parent_id), edge, rangeKey, nodes);
    return new Response(JSON.stringify({ ok: true, level: edge, parent_id, nodes, cached: false, fetched_at: new Date().toISOString() }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
});
