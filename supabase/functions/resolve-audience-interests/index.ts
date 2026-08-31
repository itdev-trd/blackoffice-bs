// supabase/functions/resolve-audience-interests/index.ts
// เรียกอัตโนมัติจากหน้า "สร้างคอนเทนต์" ตอนกดปุ่ม (ก่อนสร้าง copy/รูป) — แก้ปัญหาที่ระบบเดิมตั้ง targeting
// ใน Meta ให้แค่ "อายุ + ประเทศ" อย่างเดียว ไม่มี interests/behaviors เลย ทำให้กลุ่มเป้าหมายกว้างเกินไป
//
// หลักการทำงาน 2 ขั้น (ต้องทำแบบนี้เพราะ Meta ไม่รับ interest เป็นข้อความอิสระ ต้องเป็น numeric ID ที่มีอยู่จริงในระบบเขาเท่านั้น):
//   1) ให้ AI (Claude หรือ OpenAI) แปล target_audience_desc (ภาษาไทย) เป็นคำค้นภาษาอังกฤษสั้นๆ 3-6 คำ
//      ที่น่าจะ match กับ interest/behavior จริงบน Meta (เช่น "Forex trading", "Foreign exchange market", "Gold (investment)")
//   2) เอาคำค้นแต่ละคำไปยิง Meta Graph API endpoint `/search?type=adinterest` (targetingsearch) จริง
//      เพื่อดึง interest ID ที่มีอยู่จริงมาใช้ — ไม่เดา ID เอง กัน error ตอนสร้าง adset จริง
//
// ผลลัพธ์ถูกเซฟลง settings.campaign_defaults.interests (array ของ {id, name}) ให้ launch-campaign
// ไปดึงมาใส่ใน targeting.flexible_spec ตอนสร้าง adset จริง
//
// Secrets ที่ต้องตั้ง:
//   ANTHROPIC_API_KEY   (ใช้เมื่อเลือก text_model = "claude")
//   IMAGE_API_KEY       (ใช้เมื่อเลือก text_model = "openai")
//   META_ACCESS_TOKEN   (ใช้ยิง targetingsearch — token เดียวกับที่ launch-campaign/monitor-ads ใช้)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { getPromptOverride, withOverride } from "../_shared/ai-prompts.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { getOpenAIKey } from "../_shared/openai.ts";

let META_TOKEN = "";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH_VERSION = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)

const KEYWORD_SYSTEM_PROMPT = `You are a Facebook/Meta Ads targeting specialist for Thailand's trading/forex/gold rebate niche.
Given a Thai-language audience description, produce short ENGLISH search keywords that are likely to match real Meta "detailed targeting" interest or behavior categories (the kind you'd type into Meta Ads Manager's "Detailed Targeting" search box).

Decide the NUMBER of keywords yourself based on how narrow or broad the described audience is — do not default to a fixed count:
- A narrow/specific audience (e.g. "XM broker users specifically", "MT4/MT5 gold scalpers only") needs FEWER, more precise keywords (as few as 2) — adding vague extras would dilute targeting quality and waste budget on the wrong people.
- A broad/general audience (e.g. "anyone interested in trading or investing") warrants MORE keywords (up to 8) to adequately cover the different interest categories that make up that broader group.
- Think about it the way a real media buyer would: how many genuinely distinct, relevant interest categories does this audience actually break down into? Use that number, not an arbitrary default.

Rules:
- Keywords must be in English (Meta's interest taxonomy is English-only), short (1-4 words each), and specific enough to plausibly exist as real Meta interest categories.
- Cover a relevant mix depending on the audience: trading/finance-specific interests (e.g. "Forex trading", "Foreign exchange market", "Stock trading", "Gold (investment)", "Cryptocurrency"), plus platform/behavior signals if relevant (e.g. "MetaTrader", "Online trading").
- Do NOT invent overly specific or niche phrases unlikely to exist as a real ad interest category.
- Do NOT pad the list with redundant near-duplicate keywords just to hit a higher count.
Output ONLY valid JSON, no markdown fences:
{"keywords": ["...", "..."], "reasoning": "สั้นๆ เป็นภาษาไทยว่าทำไมถึงเลือกจำนวนคำค้นเท่านี้"}`;

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

async function getKeywordsFromClaude(audienceDesc: string, sys: string = KEYWORD_SYSTEM_PROMPT): Promise<{ keywords: string[]; reasoning: string }> {
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
      messages: [{ role: "user", content: `Audience description (Thai):\n${audienceDesc}` }],
    }),
  });
  if (!resp.ok) throw new Error(`Claude API error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  const parsed = extractJson(data.content[0].text);
  return { keywords: parsed.keywords || [], reasoning: parsed.reasoning || "" };
}

async function getKeywordsFromOpenAI(audienceDesc: string, sys: string = KEYWORD_SYSTEM_PROMPT): Promise<{ keywords: string[]; reasoning: string }> {
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
        { role: "user", content: `Audience description (Thai):\n${audienceDesc}` },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  const parsed = extractJson(data.choices?.[0]?.message?.content ?? "");
  return { keywords: parsed.keywords || [], reasoning: parsed.reasoning || "" };
}

type MetaInterest = { id: string; name: string; audience_size_lower_bound?: number; audience_size_upper_bound?: number };

// ยิง Meta targetingsearch จริงต่อ 1 คำค้น — คืน candidate ตัวแรกที่ดูสมเหตุสมผลที่สุด (audience size ไม่เล็กเกินไป)
async function searchMetaInterest(keyword: string): Promise<MetaInterest | null> {
  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/search` +
    `?type=adinterest&q=${encodeURIComponent(keyword)}&limit=5` +
    `&access_token=${META_TOKEN}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (!resp.ok || data?.error) {
    console.error(`targetingsearch failed for "${keyword}":`, data?.error || data);
    return null;
  }
  const candidates: MetaInterest[] = data?.data || [];
  if (candidates.length === 0) return null;
  // เลือกตัวแรกที่ Meta คืนมา (เรียงตามความเกี่ยวข้องอยู่แล้วโดย default จาก API นี้)
  return candidates[0];
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

    const auth = await authorizeRequest(req, { admin: true, tab: "generate" });
    if (!auth.ok) {
      return new Response(JSON.stringify({ ok: false, error: auth.error }), {
        status: auth.status,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    META_TOKEN = await getMetaToken();
    const body = await req.json();
    const audienceDesc = String(body.target_audience_desc || "").trim();
    if (!audienceDesc) throw new Error("ต้องส่ง target_audience_desc มาด้วย");
    const textModel = body.text_model === "claude" ? "claude" : "openai";
    const sysPrompt = withOverride(KEYWORD_SYSTEM_PROMPT, await getPromptOverride("resolve_audience_interests"));

    // ขั้นที่ 1: ให้ AI แปลเป็นคำค้นภาษาอังกฤษ — AI เป็นผู้ตัดสินใจเองว่าควรใช้กี่คำ ตามความกว้าง/แคบของกลุ่มเป้าหมายที่อธิบายมา
    const { keywords, reasoning } =
      textModel === "openai" ? await getKeywordsFromOpenAI(audienceDesc, sysPrompt) : await getKeywordsFromClaude(audienceDesc, sysPrompt);
    if (!keywords.length) throw new Error("AI ไม่ได้แนะนำคำค้นกลับมาเลย");

    // ขั้นที่ 2: ยิง Meta targetingsearch จริงทีละคำ (ขนานกันได้ เพราะเป็นแค่ GET request เบาๆ)
    const results = await Promise.all(keywords.map((k: string) => searchMetaInterest(k)));
    const interests = results.filter((r): r is MetaInterest => r !== null);
    // ตัดตัวซ้ำ (บาง keyword อาจ match interest เดียวกัน)
    const uniqueInterests = Array.from(new Map(interests.map((i) => [i.id, i])).values());

    if (uniqueInterests.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          keywords_tried: keywords,
          reasoning,
          interests: [],
          warning: "ไม่พบ interest ที่ตรงกับคำค้นเลยบน Meta — จะใช้ targeting แบบอายุ+ประเทศเท่านั้นแทน",
        }),
        { headers: { ...corsHeaders, "content-type": "application/json" }, status: 200 }
      );
    }

    // เซฟผลลัพธ์เข้า settings.campaign_defaults.interests ทันที ให้ launch-campaign เอาไปใช้ตอนสร้าง adset จริง
    const { data: existingRows } = await supabaseAdmin
      .from("settings")
      .select("value")
      .eq("key", "campaign_defaults")
      .maybeSingle();
    const existingCampaignDefaults = existingRows?.value ?? {};
    const mergedCampaignDefaults = {
      ...existingCampaignDefaults,
      interests: uniqueInterests.map((i) => ({ id: i.id, name: i.name })),
    };
    await supabaseAdmin
      .from("settings")
      .upsert([{ key: "campaign_defaults", value: mergedCampaignDefaults, updated_at: new Date().toISOString() }]);

    return new Response(
      JSON.stringify({
        ok: true,
        keywords_tried: keywords,
        reasoning,
        interests: uniqueInterests,
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
