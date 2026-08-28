// supabase/functions/analyze-dashboard/index.ts
// ให้ AI วิเคราะห์ "รายชิ้น" (แคมเปญ/ชุดโฆษณา/โฆษณา) จากตัวเลข + breakdown ที่ frontend ดึงมาแล้ว
// รับ: { headline, objective, overall, age, gender, region, placement, device, text_model }
// คืน: { ok, result_th, recommendation_th }
//
// Secrets: ANTHROPIC_API_KEY (claude), IMAGE_API_KEY (openai)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPromptOverride, withOverride } from "../_shared/ai-prompts.ts";
import { authorizeRequest } from "../_shared/permissions.ts";

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
You receive ONE ad/adset/campaign with its overall metrics and breakdowns (age, gender, region, placement, device) for a period.
Notes on metrics:
- "leads" = Meta lead-form conversions only (chat campaigns usually show 0).
- "replies" = "ตอบกลับจริง": conversations where the customer sent >= 2 messages (filters people who just tapped a button then went silent). This is the real lead signal for chat/messaging campaigns.
- reply_rate = replies / conversations; it can exceed 100% because returning users continue older threads, so treat >100% simply as "very engaged".
Analyze where the real results come from (which age/gender/region/placement/device over-index for leads or replies vs impressions), spot waste (high spend low result, high frequency = fatigue, low reply_rate = ghost chats), and give concrete next actions.
Output ONLY valid JSON in Thai:
{ "result_th": "สรุปผลของชิ้นนี้ 2-4 ประโยค — เด่น/ด้อยตรงไหน ลีดจริงมาจากกลุ่ม/พื้นที่/ตำแหน่งไหน", "recommendation_th": "ควรทำอะไรต่อแบบเจาะจง (ปรับ targeting ไปกลุ่มไหน ตัด placement ไหน สเกลหรือหยุด ฯลฯ)" }`;

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
    headers: { "content-type": "application/json", authorization: `Bearer ${Deno.env.get("IMAGE_API_KEY")}` },
    body: JSON.stringify({ model: "gpt-5", max_completion_tokens: 8000, reasoning_effort: "low", response_format: { type: "json_object" }, messages: [{ role: "system", content: sys }, { role: "user", content: JSON.stringify(payload) }] }),
  });
  if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  const c = data.choices?.[0];
  if (!c?.message?.content) throw new Error(`OpenAI ส่งเนื้อหาว่าง (finish_reason=${c?.finish_reason ?? "?"})`);
  return extractJson(c.message.content);
}

// ตัด breakdown ให้เหลือ top N ต่อมิติ เพื่อลดขนาด payload
const topN = (arr: unknown, n = 8) => (Array.isArray(arr) ? arr.slice(0, n) : []);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { tab: ["analyze", "overview", "campaigns"] });
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });

    const body = await req.json();
    const { headline, objective, overall, age, gender, region, placement, device, text_model } = body ?? {};
    if (!overall) throw new Error("ต้องส่งข้อมูล overall");
    const payload = {
      headline: headline ?? "",
      objective: objective ?? null,
      overall,
      breakdowns: {
        age: topN(age),
        gender: topN(gender, 3),
        region: topN(region),
        placement: topN(placement),
        device: topN(device),
      },
    };
    const sysPrompt = withOverride(SYS, await getPromptOverride("analyze_dashboard"));
    const parsed = text_model === "claude" ? await runClaude(payload, sysPrompt) : await runOpenAI(payload, sysPrompt);

    return new Response(JSON.stringify({ ok: true, ...parsed }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
});
