// supabase/functions/score-ad-assets/index.ts
// เรียกจากหน้า "รออนุมัติ" — ให้ AI ประเมินคะแนน (0-100) + เหตุผลสั้นๆ ของ copy และ/หรือ image
// ที่ยังเป็น pending_approval แล้วเซฟกลับเข้า ad_copies.ai_score / ad_images.ai_score
// แอดมินยังต้องเลือกและกดอนุมัติเองเสมอ — ฟังก์ชันนี้แค่ "จัดอันดับให้ดูง่ายขึ้น" ไม่ได้ตัดสินใจแทน
//
// Secrets ที่ต้องตั้งใน Edge Functions → Manage secrets:
//   ANTHROPIC_API_KEY   (ใช้เมื่อเลือก text_model = "claude")
//   IMAGE_API_KEY       (OpenAI API key — ใช้เมื่อเลือก text_model = "openai")
//
// หมายเหตุ: ให้คะแนนรูปจากภาพจริงไม่ได้ในเวอร์ชันนี้ (ไม่ได้ส่ง image ไปให้โมเดล vision) —
// ให้คะแนนรูปจาก image_prompt ที่ใช้สร้างแทน เป็นการประเมินเชิง concept ไม่ใช่คุณภาพภาพจริง

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPromptOverride, withOverride } from "../_shared/ai-prompts.ts";
import { authorizeRequest } from "../_shared/permissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a senior Facebook ads media buyer reviewing draft ad assets for a Thailand trading/forex rebate business.
You will receive two lists: "copies" (ad copy variants) and "image_concepts" (image prompts used to generate creative images).
Score each item independently from 0-100 on likely ad performance (clarity, persuasiveness, policy safety, fit for Thai financial-services audience — no guaranteed-profit claims allowed anywhere).
Give a short Thai rationale (1 sentence) per item.
Output ONLY valid JSON, no markdown fences, matching exactly this schema:
{
  "copy_scores": [{"id": "...", "score": number, "rationale": "..."}],
  "image_scores": [{"id": "...", "score": number, "rationale": "..."}]
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

async function scoreWithClaude(payload: unknown, sys: string = SYSTEM_PROMPT) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 3000,
      system: sys,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    }),
  });
  if (!resp.ok) throw new Error(`Claude API error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return extractJson(data.content[0].text);
}

async function scoreWithOpenAI(payload: unknown, sys: string = SYSTEM_PROMPT) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${Deno.env.get("IMAGE_API_KEY")}`,
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
    const textModel = body.text_model === "claude" ? "claude" : "openai";
    const sysPrompt = withOverride(SYSTEM_PROMPT, await getPromptOverride("score_ad_assets"));

    // ถ้าไม่ส่ง copy_ids/image_ids มา -> เอาทุกอันที่ pending_approval และยังไม่เคยให้คะแนน
    const [{ data: copies }, { data: images }] = await Promise.all([
      body.copy_ids?.length
        ? supabaseAdmin.from("ad_copies").select("*").in("id", body.copy_ids)
        : supabaseAdmin.from("ad_copies").select("*").eq("status", "pending_approval").is("ai_score", null),
      body.image_ids?.length
        ? supabaseAdmin.from("ad_images").select("*").in("id", body.image_ids)
        : supabaseAdmin.from("ad_images").select("*").eq("status", "pending_approval").is("ai_score", null),
    ]);

    if (!copies?.length && !images?.length) {
      return new Response(JSON.stringify({ ok: true, scored_copies: 0, scored_images: 0 }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

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

    const result = textModel === "openai" ? await scoreWithOpenAI(payload, sysPrompt) : await scoreWithClaude(payload, sysPrompt);

    const now = new Date().toISOString();
    const copyUpdates = (result.copy_scores || []).map((s: { id: string; score: number; rationale: string }) =>
      supabaseAdmin
        .from("ad_copies")
        .update({ ai_score: s.score, ai_rationale: s.rationale, scored_at: now })
        .eq("id", s.id)
    );
    const imageUpdates = (result.image_scores || []).map((s: { id: string; score: number; rationale: string }) =>
      supabaseAdmin
        .from("ad_images")
        .update({ ai_score: s.score, ai_rationale: s.rationale, scored_at: now })
        .eq("id", s.id)
    );
    await Promise.all([...copyUpdates, ...imageUpdates]);

    return new Response(
      JSON.stringify({
        ok: true,
        scored_copies: (result.copy_scores || []).length,
        scored_images: (result.image_scores || []).length,
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
