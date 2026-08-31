// supabase/functions/analyze-brand-ci/index.ts
// เรียกจากหน้า "ตั้งค่า" ตอนกด "ให้ AI สกัดสไตล์จากภาพ" — รับ URL ภาพตัวอย่าง CI ที่แอดมินอัปโหลดไว้
// ส่งให้ AI (เลือกได้ระหว่าง Claude หรือ OpenAI GPT-5 — ทั้งคู่รองรับ vision) ดูภาพแล้วสกัดออกมาเป็น
// คำอธิบายสี/ฟอนต์/สไตล์เป็นข้อความสั้นๆ ภาษาไทย
// ไม่ได้เซฟลง settings ให้อัตโนมัติ — ส่งข้อความกลับไปให้หน้าเว็บเติมในช่องให้แอดมินตรวจ/แก้ก่อนกด "บันทึกตั้งค่า" เอง
//
// Secrets ที่ต้องตั้งใน Edge Functions → Manage secrets:
//   ANTHROPIC_API_KEY   (ใช้เมื่อเลือก model = "claude")
//   IMAGE_API_KEY       (OpenAI API key — ใช้เมื่อเลือก model = "openai")

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPromptOverride, withOverride } from "../_shared/ai-prompts.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { getOpenAIKey } from "../_shared/openai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a brand/graphic design analyst. You will be shown a reference image (a poster, brochure, or past ad creative from a brand).
Extract a concise Thai-language style description that another AI image generator can use as a style guide when creating NEW ad creatives for the same brand.
Cover: dominant color palette (be specific with color names/tones), typography feel (bold/thin, modern/classic, rounded/sharp), overall mood (e.g. premium, playful, corporate, minimal), composition style (e.g. lots of white space, dense/busy, centered focal point), and any recurring visual motifs (gradients, geometric shapes, photography style vs illustration, etc).
Keep it to 2-4 sentences, written in Thai, dense with concrete descriptive detail (not vague adjectives like "สวยงาม" or "ทันสมัย" alone — always pair with specifics).
Output ONLY the style description text, no preamble, no markdown, no JSON wrapper.`;

async function fetchImageAsBase64(imageUrl: string) {
  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) throw new Error(`โหลดภาพจาก ${imageUrl} ไม่สำเร็จ: ${imgResp.status}`);
  const contentType = imgResp.headers.get("content-type") || "image/png";
  const buf = new Uint8Array(await imgResp.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  const base64 = btoa(binary);
  return { base64, contentType };
}

async function analyzeWithClaude(imageUrl: string, sys: string = SYSTEM_PROMPT) {
  const { base64, contentType } = await fetchImageAsBase64(imageUrl);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 500,
      system: sys,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: contentType, data: base64 } },
            { type: "text", text: "วิเคราะห์สไตล์ CI ของภาพนี้" },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) throw new Error(`Claude API error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return data.content?.[0]?.text?.trim() ?? "";
}

async function analyzeWithOpenAI(imageUrl: string, sys: string = SYSTEM_PROMPT) {
  const { base64, contentType } = await fetchImageAsBase64(imageUrl);

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await getOpenAIKey()}`,
    },
    body: JSON.stringify({
      model: "gpt-5",
      messages: [
        { role: "system", content: sys },
        {
          role: "user",
          content: [
            { type: "text", text: "วิเคราะห์สไตล์ CI ของภาพนี้" },
            { type: "image_url", image_url: { url: `data:${contentType};base64,${base64}` } },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const auth = await authorizeRequest(req, { admin: true, setting: "brand" });
    if (!auth.ok) {
      return new Response(JSON.stringify({ ok: false, error: auth.error }), {
        status: auth.status,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const { image_url, text_model } = await req.json();
    if (!image_url) throw new Error("ต้องส่ง image_url ของภาพตัวอย่าง CI ที่อัปโหลดไว้แล้ว");
    const model = text_model === "claude" ? "claude" : "openai";
    const sysPrompt = withOverride(SYSTEM_PROMPT, await getPromptOverride("analyze_brand_ci"));

    const styleDescription = model === "openai" ? await analyzeWithOpenAI(image_url, sysPrompt) : await analyzeWithClaude(image_url, sysPrompt);
    if (!styleDescription) throw new Error(`${model === "openai" ? "OpenAI" : "Claude"} ไม่ได้ตอบข้อความสไตล์กลับมา`);

    return new Response(JSON.stringify({ ok: true, style_description: styleDescription, model_used: model }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
      status: 500,
    });
  }
});
