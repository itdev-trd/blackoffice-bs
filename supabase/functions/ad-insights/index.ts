// supabase/functions/ad-insights/index.ts
// เรียกจากหน้า "วิเคราะห์" เมื่อคลิกการ์ดแอด เพื่อดูแดชบอร์ดเจาะลึกรายแอด
// ดึง insight แบบแยกมิติ (breakdowns) จาก Meta: อายุ, เพศ, พื้นที่, ตำแหน่งจัดวาง, อุปกรณ์ และเทรนด์รายวัน
//
// Secrets: META_ACCESS_TOKEN

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { canAccessMetaNodes } from "../_shared/meta-authorization.ts";

let META_TOKEN = "";

const GRAPH_VERSION = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LEAD_TYPES = ["lead", "onsite_conversion.lead_grouped"];
const num = (v: unknown) => (v == null ? 0 : parseFloat(String(v)) || 0);

function leadsFromActions(actions: { action_type: string; value: string }[] | undefined) {
  return (actions || []).filter((a) => LEAD_TYPES.includes(a.action_type)).reduce((s, a) => s + num(a.value), 0);
}
function sumActionsBy(actions: { action_type: string; value: string }[] | undefined, matcher: (t: string) => boolean) {
  return (actions || []).filter((a) => matcher(a.action_type)).reduce((s, a) => s + num(a.value), 0);
}

async function fetchInsights(adId: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ ...params, access_token: META_TOKEN });
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${adId}/insights?${qs.toString()}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data?.error) throw new Error(data.error.message || "Meta insights error");
  return (data?.data ?? []) as Record<string, any>[];
}

// รวมแถวหลายแถวตาม key เดียว (เช่น age ที่มาจาก age×gender)
// "ตอบกลับจริง" ต่อ segment = ลูกค้าส่งข้อความ >= 2 (depth-2) กันคนกดปุ่มแล้วเงียบ
function repliesFromActions(actions: { action_type: string; value: string }[] | undefined) {
  return sumActionsBy(actions, (t) => t.includes("messaging_user_depth_2_message_send"));
}

function groupSum(rows: Record<string, any>[], keyField: string) {
  const map: Record<string, { key: string; impressions: number; spend: number; leads: number; replies: number; clicks: number }> = {};
  for (const r of rows) {
    const key = r[keyField] ?? "unknown";
    if (!map[key]) map[key] = { key, impressions: 0, spend: 0, leads: 0, replies: 0, clicks: 0 };
    map[key].impressions += num(r.impressions);
    map[key].spend += num(r.spend);
    map[key].clicks += num(r.clicks);
    map[key].leads += leadsFromActions(r.actions);
    map[key].replies += repliesFromActions(r.actions);
  }
  return Object.values(map).sort((a, b) => b.impressions - a.impressions);
}

// สร้างสรุป KPI จากแถว insight รวม 1 แถว (ใช้ทั้ง overall หลักและแต่ละ segment)
function buildOverall(o: Record<string, any>) {
  const leads = leadsFromActions(o.actions);
  const conversations = sumActionsBy(o.actions, (t) => t.includes("messaging_conversation_started"));
  const replies = sumActionsBy(o.actions, (t) => t.includes("messaging_user_depth_2_message_send"));
  const spend = num(o.spend), impressions = num(o.impressions), clicks = num(o.clicks), linkClicks = num(o.inline_link_clicks);
  return {
    spend, impressions, reach: num(o.reach), frequency: num(o.frequency), clicks, link_clicks: linkClicks,
    ctr: o.ctr != null ? num(o.ctr) : impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpm: o.cpm != null ? num(o.cpm) : impressions > 0 ? (spend / impressions) * 1000 : 0,
    cpc: o.cpc != null ? num(o.cpc) : clicks > 0 ? spend / clicks : 0,
    leads, cpl: leads > 0 ? spend / leads : null, cvr: linkClicks > 0 ? (leads / linkClicks) * 100 : null,
    conversations, replies, reply_rate: conversations > 0 ? replies / conversations : null,
  };
}
const OVERALL_FIELDS = "spend,impressions,reach,frequency,clicks,ctr,cpm,cpc,inline_link_clicks,actions";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { ad_id, date_preset, time_range, segments, level, force } = await req.json();
    if (!ad_id) throw new Error("ต้องส่ง ad_id");
    const auth = await authorizeRequest(req, { tab: ["campaigns", "analyze", "overview"], allowService: true });
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });
    META_TOKEN = await getMetaToken();
    if (!META_TOKEN) throw new Error("ยังไม่ได้ตั้งค่า Meta access token (ตั้งได้ในหน้าตั้งค่า)");
    // service role (cron prefetch) = เข้าถึงได้หมด ไม่ต้องเช็คสิทธิ์รายบัญชี
    if (auth.permission && !auth.isService && !(await canAccessMetaNodes(auth.permission, META_TOKEN, [ad_id], GRAPH_VERSION))) {
      return new Response(JSON.stringify({ ok: false, error: "ไม่มีสิทธิ์เข้าถึงบัญชีโฆษณานี้" }), { status: 403, headers: { ...corsHeaders, "content-type": "application/json" } });
    }
    // รองรับทั้ง preset และช่วงวันกำหนดเอง (time_range = {since, until})
    const rangeParams: Record<string, string> =
      time_range && time_range.since && time_range.until
        ? { time_range: JSON.stringify({ since: time_range.since, until: time_range.until }) }
        : { date_preset: typeof date_preset === "string" ? date_preset : "last_30d" };
    const preset = rangeParams.date_preset ?? "custom";

    // ---- Shared cache: ใครดึงแล้ว user อื่นเปิดได้เลย ไม่ยิง Meta ซ้ำ ----
    const lvlKey = typeof level === "string" ? level : "ad";
    const rangeKey = rangeParams.date_preset ?? (time_range?.since ? `tr:${time_range.since}_${time_range.until}` : "last_30d");
    const cacheable = !(Array.isArray(segments) && segments.length);   // ไม่ cache โหมดเปรียบเทียบ (segments)
    const cacheKey = `${lvlKey}:${ad_id}:${rangeKey}`;
    const cacheAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let ttlMin = 60 * 24 * 60;   // ค่าเริ่มต้น 60 วัน — อัปเดตเมื่อกด "ดึงใหม่ (สด)" เท่านั้น (ปรับได้ที่ settings.insights_cache_ttl_min)
    try { const { data: t } = await cacheAdmin.from("settings").select("value").eq("key", "insights_cache_ttl_min").maybeSingle(); if (Number(t?.value) > 0) ttlMin = Number(t.value); } catch { /* ใช้ค่าเริ่มต้น */ }
    if (cacheable && force !== true) {
      try {
        const { data: c } = await cacheAdmin.from("ad_insights_cache").select("payload, fetched_at").eq("cache_key", cacheKey).maybeSingle();
        if (c?.payload && c.fetched_at && (Date.now() - new Date(c.fetched_at).getTime()) < ttlMin * 60000) {
          return new Response(JSON.stringify({ ...c.payload, ok: true, cached: true, fetched_at: c.fetched_at }), { headers: { ...corsHeaders, "content-type": "application/json" } });
        }
      } catch { /* cache พลาด = ดึงสดต่อ */ }
    }

    const [overallRows, ageGenderRows, regionRows, placementRows, deviceRows, dailyRows] = await Promise.all([
      fetchInsights(ad_id, {
        ...rangeParams,
        fields: "objective,spend,impressions,reach,frequency,clicks,ctr,cpm,cpc,inline_link_clicks,actions",
      }),
      fetchInsights(ad_id, { ...rangeParams, breakdowns: "age,gender", fields: "impressions,spend,clicks,actions" }),
      fetchInsights(ad_id, { ...rangeParams, breakdowns: "region", fields: "impressions,spend,clicks,actions" }),
      fetchInsights(ad_id, {
        ...rangeParams,
        breakdowns: "publisher_platform,platform_position",
        fields: "impressions,spend,clicks,actions",
      }),
      fetchInsights(ad_id, { ...rangeParams, breakdowns: "impression_device", fields: "impressions,spend,clicks,actions" }),
      fetchInsights(ad_id, { ...rangeParams, time_increment: "1", fields: "spend,impressions,clicks,actions" }),
    ]);

    const o = overallRows[0] ?? {};
    const overall = buildOverall(o);

    // แยกผลตามช่วง (ก่อน/หลังการแก้) — คำนวณ overall ต่อ segment
    let segmentsOut: any[] | null = null;
    if (Array.isArray(segments) && segments.length) {
      segmentsOut = [];
      for (const s of segments.slice(0, 8)) {
        if (!s?.since || !s?.until) continue;
        const rows = await fetchInsights(ad_id, { time_range: JSON.stringify({ since: s.since, until: s.until }), fields: OVERALL_FIELDS });
        segmentsOut.push({ since: s.since, until: s.until, label: s.label ?? null, overall: buildOverall(rows[0] ?? {}) });
      }
    }

    const age = groupSum(ageGenderRows, "age");
    const gender = groupSum(ageGenderRows, "gender");
    const region = groupSum(regionRows, "region").slice(0, 12);
    const device = groupSum(deviceRows, "impression_device");
    const placement = placementRows
      .map((r) => ({
        key: `${r.publisher_platform ?? "?"} · ${r.platform_position ?? "?"}`,
        impressions: num(r.impressions),
        spend: num(r.spend),
        clicks: num(r.clicks),
        leads: leadsFromActions(r.actions),
        replies: repliesFromActions(r.actions),
      }))
      .sort((a, b) => b.impressions - a.impressions);

    const daily = dailyRows
      .map((r) => ({
        date: r.date_start,
        spend: num(r.spend),
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        leads: leadsFromActions(r.actions),
        // จำนวนทัก = "การเริ่มการสนทนา" (messaging_conversation_started) — ให้ตรงกับ "แชทเริ่ม" ในหน้าจัดการโฆษณา Meta
        conversations: sumActionsBy(r.actions, (t) => t.includes("messaging_conversation_started")),
        replies: repliesFromActions(r.actions),
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    // ---- ลูกค้าเปิดบัญชี + จำนวนคนที่ทักในเพจ ต่อวัน — roll-up ตามระดับ (โฆษณา → ชุดโฆษณา → แคมเปญ) ----
    // ad = นับจาก entry_ad_id ตรงตัว ; adset/campaign = ดึงรายชื่อโฆษณาลูกจาก Meta แล้วนับรวม
    //   account_opens_by_date = ลูกค้าเปิดบัญชี/วัน · page_chats_by_date = จำนวนคนที่ทักเข้าเพจ (นับจากแชทเพจจริง)/วัน
    const account_opens_by_date: Record<string, number> = {};
    const page_chats_by_date: Record<string, number> = {};
    // ตัด "วัน" ตามเวลาไทย (UTC+7) เริ่มวันที่ 00:00 น. — ให้ตรงกับวันของ Meta (date_start อิงเวลาบัญชีไทย)
    const thaiDay = (ts: string | null | undefined): string | null => {
      if (!ts) return null;
      const t = new Date(ts).getTime();
      if (isNaN(t)) return null;
      return new Date(t + 7 * 3600 * 1000).toISOString().slice(0, 10);
    };
    try {
      const lvl = typeof level === "string" ? level : "ad";
      let adIds: string[] = [String(ad_id)];
      if (lvl !== "ad") {
        const child = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${ad_id}/ads?fields=id&limit=500&access_token=${META_TOKEN}`)
          .then((r) => r.json()).catch(() => ({}));
        const ids = (child?.data ?? []).map((a: any) => String(a.id)).filter(Boolean);
        if (ids.length) adIds = ids;
      }
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: aoRows } = await admin.from("chat_customers")
        .select("account_opened_at")
        .in("entry_ad_id", adIds)
        .not("account_opened_at", "is", null);
      for (const r of aoRows ?? []) {
        const day = thaiDay(r.account_opened_at);
        if (day) account_opens_by_date[day] = (account_opens_by_date[day] || 0) + 1;
      }
      // จำนวนคนที่ทักในเพจ "ทักมาใหม่ครั้งแรกจากแอดนี้" ต่อวัน — นับแต่ละคนครั้งเดียว ตามวันที่เข้ามาครั้งแรก
      //   ใช้ created_at (วันที่แถวลูกค้าถูกสร้าง = ครั้งแรกที่ทักเข้ามา) · เวลาไทย เริ่ม 00:00 · ตัดลูกค้าเก่าที่ทักซ้ำออก
      const { data: pcRows } = await admin.from("chat_customers")
        .select("created_at")
        .in("entry_ad_id", adIds)
        .not("created_at", "is", null);
      for (const r of pcRows ?? []) {
        const day = thaiDay(r.created_at);
        if (day) page_chats_by_date[day] = (page_chats_by_date[day] || 0) + 1;
      }
    } catch (_e) { /* ไม่ให้กระทบแดชบอร์ดหลัก */ }

    const nowIso = new Date().toISOString();
    const result: Record<string, unknown> = { ok: true, generated_at: nowIso, date_preset: preset, objective: o.objective ?? null, overall, segments: segmentsOut, age, gender, region, placement, device, daily, account_opens_by_date, page_chats_by_date };
    // เก็บลง shared cache (เฉพาะโหมดปกติ ไม่ใช่ segments) — user อื่นเปิดตัวเดิม+ช่วงเดิมจะได้ของนี้เลย
    if (cacheable) {
      try {
        await cacheAdmin.from("ad_insights_cache").upsert({ cache_key: cacheKey, node_id: String(ad_id), level: lvlKey, range_key: rangeKey, payload: result, fetched_at: nowIso });
      } catch { /* เขียน cache พลาดไม่กระทบผลลัพธ์ */ }
    }
    return new Response(
      JSON.stringify({ ...result, cached: false, fetched_at: nowIso }),
      { headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
