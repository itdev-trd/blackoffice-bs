// supabase/functions/ai-suggest-pairing/index.ts
// เรียกจากหน้า "รออนุมัติ" หลังแอดมินติ๊กเลือก copy หลายอัน + image หลายอันไว้แล้ว
// ให้ AI แนะนำว่าควรจับคู่ copy ไหนกับ image ไหน และควรลอนช์เป็น
//   "separate_campaigns"          = แต่ละคู่แยกเป็นคนละแคมเปญ (เทียบผลกันตรงๆ งบใครงบมัน)
//   "single_campaign_multi_ad"    = รวมเป็นแคมเปญเดียว หลาย ad แข่งกันเองใน adset เดียว (ให้ Meta หมุนงบให้ตัวที่ดีอัตโนมัติ)
// เป็นแค่คำแนะนำ — แอดมินเป็นคนกดยืนยันจริงตอนลอนช์ (ผ่าน launch-campaign)
//
// Secrets ที่ต้องตั้งใน Edge Functions → Manage secrets:
//   ANTHROPIC_API_KEY   (ใช้เมื่อเลือก text_model = "claude")
//   IMAGE_API_KEY       (OpenAI API key — ใช้เมื่อเลือก text_model = "openai")

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPromptOverride, withOverride } from "../_shared/ai-prompts.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { getOpenAIKey } from "../_shared/openai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a senior Facebook ads media buyer for a Thailand trading/forex rebate business.
Given a list of ad copies and a list of image concepts (both already approved by a human), recommend:
1. Which copy should pair with which image (a "pair" = one ad). You may reuse an image across multiple copies or vice versa if it makes sense with what's given — but try to produce one pair per copy when counts allow, prioritizing best thematic/tone fit.
2. Whether these pairs should launch as "separate_campaigns" (independent campaigns, each with its own budget — good for a true head-to-head test with separate budget control) or "single_campaign_multi_ad" (one campaign/adset, multiple ads competing for the same budget — good when you just want Meta's algorithm to find the best performer fast without splitting budget).
Give a short Thai rationale for the mode recommendation, and a short Thai reason per pair.
Output ONLY valid JSON, no markdown fences, matching exactly this schema:
{
  "pairs": [{"copy_id": "...", "image_id": "...", "reason": "..."}],
  "suggested_mode": "separate_campaigns" | "single_campaign_multi_ad",
  "mode_rationale": "..."
}`;

function extractJson(text: string) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("หา JSON ในคำตอบของโมเดลไม่เจอ: " + trimmed.slice(0, 300));
  }
}

async function suggestWithClaude(payload: unknown, sys: string = SYSTEM_PROMPT) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 2000,
      system: sys,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    }),
  });
  if (!resp.ok) throw new Error(`Claude API error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return extractJson(data.content[0].text);
}

async function suggestWithOpenAI(payload: unknown, sys: string = SYSTEM_PROMPT) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await getOpenAIKey()}`,
    },
    body: JSON.stringify({
      model: "gpt-5",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return extractJson(data.choices?.[0]?.message?.content ?? "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const auth = await authorizeRequest(req, { admin: true, tab: "review" });
    if (!auth.ok) {
      return new Response(JSON.stringify({ ok: false, error: auth.error }), {
        status: auth.status,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const body = await req.json();
    const copyIds: string[] = body.copy_ids || [];
    const imageIds: string[] = body.image_ids || [];
    if (!copyIds.length || !imageIds.length) {
      throw new Error("ต้องเลือกอย่างน้อย 1 copy และ 1 รูป ก่อนขอคำแนะนำการจับคู่");
    }
    const textModel = body.text_model === "claude" ? "claude" : "openai";
    const sysPrompt = withOverride(SYSTEM_PROMPT, await getPromptOverride("suggest_pairing"));

    const [{ data: copies }, { data: images }] = await Promise.all([
      supabaseAdmin.from("ad_copies").select("*").in("id", copyIds),
      supabaseAdmin.from("ad_images").select("*").in("id", imageIds),
    ]);

    const payload = {
      copies: (copies || []).map((c) => ({
        id: c.id,
        headline: c.headline,
        primary_text: c.primary_text,
        description: c.description,
        cta: c.cta,
      })),
      image_concepts: (images || []).map((im) => ({ id: im.id, image_prompt: im.image_prompt })),
    };

    const result = textModel === "openai" ? await suggestWithOpenAI(payload, sysPrompt) : await suggestWithClaude(payload, sysPrompt);

    // เก็บคำแนะนำไว้ตรวจสอบย้อนหลัง (ไม่ block response ถ้าบันทึกไม่สำเร็จ)
    const { data: savedRow, error: saveError } = await supabaseAdmin
      .from("ai_pairing_suggestions")
      .insert({
        // auth.user มาจาก authorizeRequest ด้านบน — เดิมอ้าง userData ที่ไม่มีการประกาศไว้
        // ทำให้ throw ReferenceError ตอนบันทึก ซึ่งเกิดหลังเรียก AI ไปแล้ว (เสียโทเคนเปล่าและ request ล้ม)
        requested_by: auth.user?.id ?? null,
        input_copy_ids: copyIds,
        input_image_ids: imageIds,
        suggested_pairs: result.pairs,
        suggested_mode: result.suggested_mode,
        mode_rationale: result.mode_rationale,
        model_used: textModel,
      })
      .select()
      .single();
    if (saveError) console.error("save ai_pairing_suggestions failed:", saveError);

    return new Response(
      JSON.stringify({
        ok: true,
        suggestion_id: savedRow?.id ?? null,
        pairs: result.pairs,
        suggested_mode: result.suggested_mode,
        mode_rationale: result.mode_rationale,
      }),
      { headers: { ...corsHeaders, "content-type": "application/json" }, status: 200 }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
      status: 500,
    });
  }
});
