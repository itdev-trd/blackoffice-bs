// supabase/functions/analyze-campaigns/index.ts
// วิเคราะห์แคมเปญที่ผู้ใช้เลือกจากบัญชี Meta (นอกเหนือจากแอดที่ลอนช์ผ่านแอปนี้)
// - ดึง insight ระดับแคมเปญ + รายชื่อ ad set (เพื่อให้ apply budget / ตัด AN ได้ด้วย id จริง)
// - ให้ AI สรุปผล + เสนอ "การเปลี่ยนแปลงที่แนะนำ" (recommended_changes) เป็นรายการ ให้ผู้ใช้กดอนุมัติทีละอัน
//
// Secrets: META_ACCESS_TOKEN, ANTHROPIC_API_KEY (claude), IMAGE_API_KEY (openai)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { getPromptOverride, withOverride } from "../_shared/ai-prompts.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { getOpenAIKey } from "../_shared/openai.ts";
import { canAccessMetaNodes } from "../_shared/meta-authorization.ts";

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
function sumActionsBy(actions: { action_type: string; value: string }[] | undefined, m: (t: string) => boolean) {
  return (actions || []).filter((a) => m(a.action_type)).reduce((s, a) => s + num(a.value), 0);
}

function extractJson(text: string) {
  const t = (text || "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const mt = t.match(/\{[\s\S]*\}/);
    if (mt) return JSON.parse(mt[0]);
    throw new Error("หา JSON ไม่เจอ");
  }
}

const AI_SYSTEM = `You are a senior Meta ads analyst for Thailand's trading/forex/gold rebate niche.
You receive selected campaigns with insight metrics and their ad sets (id, name, daily_budget_thb, has_audience_network).
For EACH campaign, write result_th (ผลเป็นยังไง อ้างอิงตัวเลขจริง) and recommendation_th (คำแนะนำภาพรวม, ภาษาไทย).
Also produce recommended_changes: a list of concrete, safe actions the user can approve one-by-one. Each change:
{ "target_type": "campaign"|"adset", "target_id": "<real id from input>", "action": "pause"|"resume"|"set_budget"|"exclude_audience_network", "value": <number for set_budget in THB, else null>, "label_th": "สั้นๆ", "reason_th": "เหตุผล" }
Rules for changes:
- Only reference target_id values that appear in the input.
- pause/resume target campaign or adset. set_budget & exclude_audience_network target an adset only.
- Only suggest exclude_audience_network for an adset where has_audience_network is true.
- Be conservative: suggest changes only when the data clearly supports them. It is fine to return an empty changes list.
Output ONLY valid JSON:
{ "campaigns": [{ "campaign_id": "...", "result_th": "...", "recommendation_th": "...", "recommended_changes": [ ... ] }] }`;

async function runClaude(payload: unknown, sys: string = AI_SYSTEM) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 5000, system: sys, messages: [{ role: "user", content: JSON.stringify(payload) }] }),
  });
  if (!resp.ok) throw new Error(`Claude API error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return extractJson(data.content?.[0]?.text ?? "");
}
async function runOpenAI(payload: unknown, sys: string = AI_SYSTEM) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await getOpenAIKey()}` },
    body: JSON.stringify({
      model: "gpt-5",
      max_completion_tokens: 8000,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: sys }, { role: "user", content: JSON.stringify(payload) }],
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  const c = data.choices?.[0];
  if (!c?.message?.content) throw new Error(`OpenAI ส่งเนื้อหาว่าง (finish_reason=${c?.finish_reason ?? "?"})`);
  return extractJson(c.message.content);
}

async function fetchJson(url: string) {
  const resp = await fetch(url);
  const data = await resp.json();
  if (data?.error) throw new Error(data.error.message || "Meta error");
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const token = await getMetaToken();
    if (!token) throw new Error("ยังไม่ได้ตั้งค่า Meta access token (ตั้งได้ในหน้าตั้งค่า)");

    const { campaign_ids, date_preset, time_range, text_model, use_ai } = await req.json();
    if (!Array.isArray(campaign_ids) || campaign_ids.length === 0) throw new Error("ต้องส่ง campaign_ids อย่างน้อย 1 รายการ");
    const auth = await authorizeRequest(req, { tab: ["analyze", "overview"] });
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });
    if (auth.permission && !(await canAccessMetaNodes(auth.permission, token, campaign_ids, GRAPH_VERSION))) {
      return new Response(JSON.stringify({ ok: false, error: "มีแคมเปญที่อยู่นอกบัญชีโฆษณาที่ได้รับอนุญาต" }), { status: 403, headers: { ...corsHeaders, "content-type": "application/json" } });
    }
    // รองรับช่วงวันกำหนดเอง (time_range) หรือ preset
    const rangeQs =
      time_range && time_range.since && time_range.until
        ? `time_range=${encodeURIComponent(JSON.stringify({ since: time_range.since, until: time_range.until }))}`
        : `date_preset=${typeof date_preset === "string" ? date_preset : "last_30d"}`;
    const preset = typeof date_preset === "string" ? date_preset : "custom";
    const useAI = use_ai !== false;
    const model = text_model === "claude" ? "claude" : "openai";
    const sysPrompt = withOverride(AI_SYSTEM, await getPromptOverride("analyze_campaigns"));

    const campaigns = await Promise.all(
      campaign_ids.slice(0, 20).map(async (cid: string) => {
        // ข้อมูลแคมเปญ + insight + adsets พร้อมกัน
        const [meta, insightData, adsetData] = await Promise.all([
          fetchJson(`https://graph.facebook.com/${GRAPH_VERSION}/${cid}?fields=name,status,effective_status,objective,daily_budget&access_token=${token}`),
          fetchJson(`https://graph.facebook.com/${GRAPH_VERSION}/${cid}/insights?${rangeQs}&fields=spend,impressions,reach,frequency,clicks,ctr,cpm,cpc,inline_link_clicks,actions&access_token=${token}`),
          fetchJson(`https://graph.facebook.com/${GRAPH_VERSION}/${cid}/adsets?fields=id,name,status,daily_budget,targeting{publisher_platforms}&limit=50&access_token=${token}`),
        ]);
        const o = insightData?.data?.[0] ?? {};
        const leads = leadsFromActions(o.actions);
        const spend = num(o.spend);
        const conversations = sumActionsBy(o.actions, (t) => t.includes("messaging_conversation_started"));
        const replies = sumActionsBy(o.actions, (t) => t.includes("messaging_user_depth_2_message_send"));
        const adsets = (adsetData?.data ?? []).map((s: Record<string, any>) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          daily_budget_thb: s.daily_budget ? Math.round(num(s.daily_budget) / 100) : null,
          has_audience_network: (s.targeting?.publisher_platforms ?? []).includes("audience_network"),
        }));
        return {
          campaign_id: cid,
          name: meta.name,
          status: meta.status,
          effective_status: meta.effective_status,
          objective: meta.objective,
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
            leads,
            cpl: leads > 0 ? spend / leads : null,
            conversations,
            replies,
            reply_rate: conversations > 0 ? replies / conversations : null,
          },
          adsets,
        };
      })
    );

    let aiByCampaign: Record<string, any> = {};
    let aiError: string | null = null;
    if (useAI) {
      try {
        const payload = {
          campaigns: campaigns.map((c) => ({
            campaign_id: c.campaign_id,
            name: c.name,
            status: c.status,
            objective: c.objective,
            ...c.metrics,
            adsets: c.adsets,
          })),
        };
        const parsed = model === "openai" ? await runOpenAI(payload, sysPrompt) : await runClaude(payload, sysPrompt);
        (parsed.campaigns || []).forEach((x: any) => {
          if (x?.campaign_id) aiByCampaign[x.campaign_id] = x;
        });
      } catch (e) {
        aiError = String(e);
        console.error("analyze-campaigns AI failed:", e);
      }
    }

    const result = campaigns.map((c) => ({
      ...c,
      result_th: aiByCampaign[c.campaign_id]?.result_th ?? null,
      recommendation_th: aiByCampaign[c.campaign_id]?.recommendation_th ?? null,
      recommended_changes: aiByCampaign[c.campaign_id]?.recommended_changes ?? [],
    }));

    return new Response(
      JSON.stringify({ ok: true, generated_at: new Date().toISOString(), date_preset: preset, ai: useAI ? (aiError ? "failed" : "ok") : "off", ai_error: aiError, campaigns: result }),
      { headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
});
