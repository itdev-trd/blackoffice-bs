// supabase/functions/analyze-ads/index.ts
// เรียกจากหน้า "วิเคราะห์" ในเว็บแอป (ปุ่ม "วิเคราะห์ตอนนี้")
// - ดึง insight ล่าสุดจาก Meta ของแอดที่ลอนช์อยู่ (active + paused_auto) แบบสด ถ้าดึงไม่ได้ fallback เป็นค่าล่าสุดใน metrics_log
// - คำนวณ verdict ตามเกณฑ์เดียวกับ monitor-ads
// - จัดกลุ่มตามแคมเปญ (campaign_id) แล้วให้ AI สรุป "ผลเป็นยังไง + ควรทำอะไรต่อ" เป็นภาษาไทย ทั้งรายแอดและรายแคมเปญ
// - บันทึก snapshot ล่าสุดลง settings.ads_analysis เพื่อให้หน้าเว็บโหลดกลับมาแสดงได้แม้รีเฟรช
//
// หมายเหตุ: การวิเคราะห์ "อัตโนมัติตามที่ตั้งไว้" ทำโดย monitor-ads (pg_cron) ที่เขียน metrics_log + verdict ทุกรอบอยู่แล้ว
// ฟังก์ชันนี้คือการ "สั่งวิเคราะห์เดี๋ยวนี้" พร้อมคำอธิบายเชิงภาษาจาก AI
//
// Secrets ที่ต้องตั้ง:
//   META_ACCESS_TOKEN   (ถ้าไม่มี จะ fallback ใช้ค่าล่าสุดใน metrics_log แทน)
//   ANTHROPIC_API_KEY   (ใช้เมื่อ text_model = "claude")
//   IMAGE_API_KEY       (OpenAI key — ใช้เมื่อ text_model = "openai")

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { getPromptOverride, withOverride } from "../_shared/ai-prompts.ts";
import { authorizeRequest } from "../_shared/permissions.ts";

let META_TOKEN = "";
const GRAPH_VERSION = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function extractJson(text: string) {
  const trimmed = (text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("หา JSON ในคำตอบของโมเดลไม่เจอ");
  }
}

const AI_SYSTEM_PROMPT = `You are a senior Meta/Facebook ads performance analyst for Thailand's trading/forex/gold rebate niche.
You receive JSON with campaigns and their ads, including live metrics (spend, leads, cpa, ctr, cpm, impressions), each ad's verdict, and the target CPA.
For EACH ad, write:
- result_th: a concrete Thai sentence describing how the ad is performing, referencing its actual numbers vs the target CPA.
- recommendation_th: a concrete Thai next-action (e.g. หยุด / เพิ่มงบ / คงไว้ / เปลี่ยนครีเอทีฟ / รอเก็บข้อมูลเพิ่ม) with a brief reason.
For EACH campaign, write:
- summary_th: a Thai overview of how the campaign as a whole is doing.
- recommendation_th: the single most important next action for the campaign.
Some ads include conversations, replies, reply_rate (for messaging/chat ads) and a ghost_flagged/ghost_reason. A low reply_rate with many conversations = "แชทผี" (ghost chats: บอท/มิสคลิก/ทักแล้วเงียบ). If ghost_flagged is true or reply_rate is low, call it out in result_th and recommend an action (เช่น ตัด Audience Network, ปรับ targeting/ครีเอทีฟ, หรือหยุดแอด) in recommendation_th.
Be realistic and honest. If data is insufficient (low spend), say so instead of over-interpreting. No guaranteed-profit framing.
Output ONLY valid JSON, no markdown fences, exactly:
{
  "ads": [{ "id": "<ad_content id>", "result_th": "...", "recommendation_th": "..." }],
  "campaigns": [{ "campaign_id": "<campaign_id>", "summary_th": "...", "recommendation_th": "..." }]
}`;

async function runClaude(payload: unknown, sys: string = AI_SYSTEM_PROMPT) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 4000,
      system: sys,
      messages: [{ role: "user", content: `Campaigns & ads:\n${JSON.stringify(payload)}` }],
    }),
  });
  if (!resp.ok) throw new Error(`Claude API error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return extractJson(data.content?.[0]?.text ?? "");
}

async function runOpenAI(payload: unknown, sys: string = AI_SYSTEM_PROMPT) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${Deno.env.get("IMAGE_API_KEY")}`,
    },
    body: JSON.stringify({
      model: "gpt-5",
      // gpt-5 เป็น reasoning model — ใช้ max_completion_tokens และเผื่อ budget ให้พอ
      max_completion_tokens: 10000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Campaigns & ads:\n${JSON.stringify(payload)}` },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  const choice = data.choices?.[0];
  const rawText = choice?.message?.content ?? "";
  if (!rawText) throw new Error(`OpenAI ส่งเนื้อหาว่าง (finish_reason=${choice?.finish_reason ?? "?"})`);
  return extractJson(rawText);
}

function computeVerdict(spend: number, cpa: number | null, cfg: Record<string, number>) {
  const target = cfg.target_cpa_thb ?? 150;
  if (spend < (cfg.min_spend_before_judging_thb ?? 200)) return "insufficient_data";
  if (cpa === null || cpa > target * (cfg.underperform_multiplier ?? 1.5)) return "underperform";
  if (cpa < target * (cfg.outperform_multiplier ?? 0.7)) return "outperform";
  return "on_target";
}

// ดึง insight สดจาก Meta สำหรับแอดหนึ่งตัว — คืน null ถ้าดึงไม่ได้/ไม่มี token
async function fetchMetaInsight(adId: string) {
  const token = META_TOKEN;
  if (!token || !adId) return null;
  try {
    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/${adId}` +
      `?fields=effective_status,insights.date_preset(today){spend,impressions,reach,clicks,ctr,cpm,actions}` +
      `&access_token=${token}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data?.error) return null;
    const insight = data?.insights?.data?.[0] ?? {};
    const spend = parseFloat(insight.spend || "0");
    const actions: { action_type: string; value: string }[] = insight.actions || [];
    const leadAction = actions.find(
      (a) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
    );
    const leads = leadAction ? parseFloat(leadAction.value) : 0;
    const sumBy = (matcher: (t: string) => boolean) =>
      actions.filter((a) => matcher(a.action_type)).reduce((s, a) => s + parseFloat(a.value || "0"), 0);
    const conversations = sumBy((t) => t.includes("messaging_conversation_started"));
    const replies = sumBy((t) => t.includes("messaging_user_depth_2_message_send"));
    return {
      spend,
      leads,
      cpa: leads > 0 ? spend / leads : null,
      impressions: parseFloat(insight.impressions || "0"),
      reach: parseFloat(insight.reach || "0"),
      clicks: parseFloat(insight.clicks || "0"),
      ctr: insight.ctr ? parseFloat(insight.ctr) : null,
      cpm: insight.cpm ? parseFloat(insight.cpm) : null,
      conversations,
      replies,
      reply_rate: conversations > 0 ? replies / conversations : null,
      effective_status: data?.effective_status ?? null,
    };
  } catch (_e) {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const auth = await authorizeRequest(req, { admin: true, tab: "analyze" });
    if (!auth.ok) {
      return new Response(JSON.stringify({ ok: false, error: auth.error }), {
        status: auth.status,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    META_TOKEN = await getMetaToken();

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const textModel = body.text_model === "claude" ? "claude" : "openai";
    const sysPrompt = withOverride(AI_SYSTEM_PROMPT, await getPromptOverride("analyze_ads"));
    const useAI = body.use_ai !== false; // ค่าเริ่มต้นเปิด AI narrative

    // เกณฑ์ตัดสิน
    const { data: settingsRows } = await supabaseAdmin
      .from("settings")
      .select("key, value")
      .eq("key", "optimization_thresholds");
    const cfg = settingsRows?.[0]?.value ?? {
      target_cpa_thb: 150,
      min_spend_before_judging_thb: 200,
      underperform_multiplier: 1.5,
      outperform_multiplier: 0.7,
    };

    // แอดที่ลอนช์อยู่
    const { data: ads, error: adsErr } = await supabaseAdmin
      .from("ad_content")
      .select("*")
      .in("status", ["active", "paused_auto"]);
    if (adsErr) throw adsErr;

    if (!ads || ads.length === 0) {
      const empty = { generated_at: new Date().toISOString(), source: "none", campaigns: [] };
      await supabaseAdmin
        .from("settings")
        .upsert({ key: "ads_analysis", value: empty, updated_at: new Date().toISOString() });
      return new Response(JSON.stringify({ ok: true, ...empty }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    // ค่าล่าสุดใน metrics_log ต่อแอด (ใช้ fallback ถ้าดึง Meta ไม่ได้)
    const { data: recentMetrics } = await supabaseAdmin
      .from("metrics_log")
      .select("*")
      .in("ad_content_id", ads.map((a) => a.id))
      .order("checked_at", { ascending: false });
    const latestDbByAd: Record<string, any> = {};
    (recentMetrics || []).forEach((m) => {
      if (!latestDbByAd[m.ad_content_id]) latestDbByAd[m.ad_content_id] = m;
    });

    let usedMeta = false;
    const now = new Date().toISOString();

    // ดึง insight ต่อแอดแบบขนาน
    const perAd = await Promise.all(
      ads.map(async (row) => {
        const live = await fetchMetaInsight(row.ad_id);
        let metrics;
        if (live) {
          usedMeta = true;
          metrics = {
            spend: live.spend,
            leads: live.leads,
            cpa: live.cpa,
            impressions: live.impressions,
            ctr: live.ctr,
            cpm: live.cpm,
            conversations: live.conversations,
            replies: live.replies,
            reply_rate: live.reply_rate,
          };
          // บันทึกลง metrics_log เพื่อสร้างประวัติ
          const verdict = computeVerdict(live.spend, live.cpa, cfg);
          await supabaseAdmin.from("metrics_log").insert({
            ad_content_id: row.id,
            spend: live.spend,
            leads: live.leads,
            cpa: live.cpa,
            verdict,
          });
        } else {
          const db = latestDbByAd[row.id];
          metrics = {
            spend: db?.spend ?? null,
            leads: db?.leads ?? null,
            cpa: db?.cpa ?? null,
            impressions: null,
            ctr: null,
            cpm: null,
            conversations: row.conversations ?? null,
            replies: row.replies ?? null,
            reply_rate: row.reply_rate ?? null,
          };
        }
        const verdict = computeVerdict(metrics.spend ?? 0, metrics.cpa ?? null, cfg);
        return {
          id: row.id,
          headline: row.headline,
          campaign_id: row.campaign_id || "ungrouped",
          adset_id: row.adset_id || null,
          ad_id: row.ad_id || null,
          status: row.status,
          launch_mode: row.launch_mode || null,
          daily_budget_thb: row.daily_budget_thb ?? null,
          scale_suggested: !!row.scale_suggested,
          suggested_budget_thb: row.suggested_budget_thb ?? null,
          ghost_flagged: !!row.ghost_flagged,
          ghost_reason: row.ghost_reason ?? null,
          metrics,
          verdict,
        };
      })
    );

    // จัดกลุ่มตามแคมเปญ
    const campaignMap: Record<string, any> = {};
    for (const ad of perAd) {
      const key = ad.campaign_id;
      if (!campaignMap[key]) {
        campaignMap[key] = {
          campaign_id: key,
          launch_mode: ad.launch_mode,
          ads: [],
          totals: { spend: 0, leads: 0, cpa: null as number | null },
        };
      }
      campaignMap[key].ads.push(ad);
      campaignMap[key].totals.spend += ad.metrics.spend ?? 0;
      campaignMap[key].totals.leads += ad.metrics.leads ?? 0;
    }
    const campaigns = Object.values(campaignMap).map((c: any) => {
      c.totals.cpa = c.totals.leads > 0 ? c.totals.spend / c.totals.leads : null;
      return c;
    });

    // AI narrative
    let aiByAd: Record<string, any> = {};
    let aiByCampaign: Record<string, any> = {};
    let aiError: string | null = null;
    if (useAI) {
      try {
        const payload = {
          target_cpa_thb: cfg.target_cpa_thb ?? 150,
          campaigns: campaigns.map((c: any) => ({
            campaign_id: c.campaign_id,
            launch_mode: c.launch_mode,
            totals: c.totals,
            ads: c.ads.map((a: any) => ({
              id: a.id,
              headline: a.headline,
              adset_id: a.adset_id,
              status: a.status,
              daily_budget_thb: a.daily_budget_thb,
              ...a.metrics,
              verdict: a.verdict,
              ghost_flagged: a.ghost_flagged,
              ghost_reason: a.ghost_reason,
            })),
          })),
        };
        const parsed = textModel === "openai" ? await runOpenAI(payload, sysPrompt) : await runClaude(payload, sysPrompt);
        (parsed.ads || []).forEach((x: any) => {
          if (x?.id) aiByAd[x.id] = x;
        });
        (parsed.campaigns || []).forEach((x: any) => {
          if (x?.campaign_id) aiByCampaign[x.campaign_id] = x;
        });
      } catch (e) {
        aiError = String(e);
        console.error("analyze-ads AI narrative failed:", e);
      }
    }

    // ผสม AI narrative เข้ากับผลตัวเลข
    const enrichedCampaigns = campaigns.map((c: any) => ({
      ...c,
      summary_th: aiByCampaign[c.campaign_id]?.summary_th ?? null,
      recommendation_th: aiByCampaign[c.campaign_id]?.recommendation_th ?? null,
      ads: c.ads.map((a: any) => ({
        ...a,
        result_th: aiByAd[a.id]?.result_th ?? null,
        recommendation_th: aiByAd[a.id]?.recommendation_th ?? null,
      })),
    }));

    const result = {
      generated_at: now,
      source: usedMeta ? "meta" : "db",
      ai: useAI ? (aiError ? "failed" : "ok") : "off",
      ai_error: aiError,
      campaigns: enrichedCampaigns,
    };

    await supabaseAdmin
      .from("settings")
      .upsert({ key: "ads_analysis", value: result, updated_at: now });

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
