// supabase/functions/analyze-compare/index.ts
// ให้ AI สรุปการเปรียบเทียบหลายแอด/แคมเปญ (จากตัวเลขที่ frontend ดึงมาแล้ว)
// รับ items: [{ headline, overall:{spend,impressions,reach,leads,cpl,ctr,cpm,cpc,clicks,frequency,reply_rate} }]
// คืน: { summary_th, winner_th, recommendation_th }
//
// Secrets: ANTHROPIC_API_KEY (claude), IMAGE_API_KEY (openai)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPromptOverride, withOverride } from "../_shared/ai-prompts.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { getOpenAIKey } from "../_shared/openai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function extractJson(text: string) {
  const t = (text || "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("หา JSON ไม่เจอ");
  }
}

const SYS = `You are a senior Meta ads analyst for Thailand's forex/gold rebate niche.
You receive several ads/campaigns with their metrics for the same period. Compare them.
Consider: leads & CPL first (lower CPL is better), then CTR (higher better), CPM/CPC (lower better), frequency (too high = ad fatigue), reply_rate for chat ads.
Output ONLY valid JSON in Thai:
{ "summary_th": "สรุปภาพรวมว่าตัวไหนเด่น/ด้อยอย่างไร 2-4 ประโยค", "winner_th": "ตัวที่คุ้มที่สุดตอนนี้ + เหตุผลสั้นๆ", "recommendation_th": "ควรทำอะไรต่อ (สเกลตัวไหน หยุดตัวไหน ปรับอะไร)" }`;

async function runClaude(payload: unknown, sys: string = SYS) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 2000, system: sys, messages: [{ role: "user", content: JSON.stringify(payload) }] }),
  });
  if (!resp.ok) throw new Error(`Claude API error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return extractJson(data.content?.[0]?.text ?? "");
}
async function runOpenAI(payload: unknown, sys: string = SYS) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await getOpenAIKey()}` },
    body: JSON.stringify({ model: "gpt-5", max_completion_tokens: 8000, reasoning_effort: "low", response_format: { type: "json_object" }, messages: [{ role: "system", content: sys }, { role: "user", content: JSON.stringify(payload) }] }),
  });
  if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  const c = data.choices?.[0];
  if (!c?.message?.content) throw new Error(`OpenAI ส่งเนื้อหาว่าง (finish_reason=${c?.finish_reason ?? "?"})`);
  return extractJson(c.message.content);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { tab: ["analyze", "overview", "campaigns"] });
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });

    const { items, text_model } = await req.json();
    if (!Array.isArray(items) || items.length < 2) throw new Error("ต้องมีอย่างน้อย 2 รายการเพื่อเปรียบเทียบ");
    const sysPrompt = withOverride(SYS, await getPromptOverride("analyze_compare"));
    const parsed = text_model === "claude" ? await runClaude({ items }, sysPrompt) : await runOpenAI({ items }, sysPrompt);

    return new Response(JSON.stringify({ ok: true, ...parsed }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
});
