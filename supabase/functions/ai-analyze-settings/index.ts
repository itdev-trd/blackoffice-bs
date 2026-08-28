// supabase/functions/ai-analyze-settings/index.ts
// เรียกจากหน้า "ตั้งค่า" (โหมด "ให้ AI วิเคราะห์") — รับสรุปธุรกิจ/สินค้าสั้นๆ จากแอดมิน
// แล้วให้ Claude วิเคราะห์และแนะนำค่า targeting / งบประมาณ / เกณฑ์ตัดสินใจ / โทนแบรนด์
// จากนั้น "เซฟเข้า settings table ทันที" โดยไม่ต้องรอ review (ตามที่ตกลงกันไว้)
//
// หมายเหตุ: ทำงานกับ settings แบบ global (คีย์เดียวทั้งระบบ) เหมือนโครงสร้างเดิมของระบบตอนนี้
// ยังไม่ใช่ per-page — ถ้าภายหลังเปลี่ยนเป็น multi-page ต้องมาแก้ฟังก์ชันนี้ให้รับ page identifier ด้วย
//
// Secrets ที่ต้องตั้งใน Edge Functions → Manage secrets:
//   ANTHROPIC_API_KEY   (ใช้เมื่อเลือก text_model = "claude")
//   IMAGE_API_KEY       (OpenAI API key — ใช้เมื่อเลือก text_model = "openai" ตัวเดียวกับที่ generate-ad-content ใช้)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPromptOverride, withOverride } from "../_shared/ai-prompts.ts";
import { authorizeRequest } from "../_shared/permissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a senior Facebook/Meta ads media buyer specializing in Thailand's trading/forex/gold rebate & financial-services niche.
Given a short business brief in Thai, recommend campaign settings AND produce a DETAILED media-buying playbook that a person could follow step-by-step inside Meta Ads Manager.

Rules:
- Be realistic for the Thai market and Meta's financial-services ad policy (no guaranteed-profit framing anywhere, including audience description).
- daily_budget_thb should be a reasonable starting/testing budget (not maxed out) — typically 200-1000 THB/day for a new campaign unless the brief clearly implies a larger scale.
- target_cpa_thb should be a plausible cost-per-lead for this niche in Thailand.
- age_min/age_max should be a sensible bracket for the described audience.
- target_audience_desc should be a concise Thai description usable elsewhere in the app (no profit guarantees).
- brand_voice should be a short Thai tone description matching the brief.
- product_name should be the specific product/broker/program name mentioned or clearly implied in the brief (e.g. "XM" → "XM Rebate Program"). If genuinely not inferable, use an empty string.
- offer should be a short Thai one-line summary of the core offer/promotion implied by the brief (no guaranteed-profit framing). If genuinely not inferable, use an empty string.

If the brief includes a "preferences" object, you MUST honor it:
- preferences.campaign_style: one of "auto","lead_form","chat","traffic","conversions". If not "auto", the rank-1 campaign recommendation AND launch_config.objective/conversion_location MUST match it (lead_form → OUTCOME_LEADS + Instant Form; chat → OUTCOME_ENGAGEMENT/messaging → ทักแชท Messenger/IG DM; traffic → OUTCOME_TRAFFIC + เว็บ/แลนดิ้ง; conversions → OUTCOME_SALES + เว็บ). If "auto", pick the best option and justify it.
- preferences.creative_format: one of "auto","image","video","mixed". If not "auto", analysis.ad_level.format_th and launch_config.creative_format MUST follow it (and bias placements accordingly, e.g. video → Reels/Stories).
- preferences.language: one of "auto","th","en","th_en","other". If not "auto", write the ad-copy guidance in that language direction, reflect it in analysis, and set launch_config.language to match.
Always explain in the Thai prose how the user's preferences shaped the recommendation.

For the "analysis" object, write ALL prose fields in Thai, be concrete and specific (name actual Meta options, real interest/behavior names, real placement names), and give clear reasoning for every recommendation. Do not be generic. Cover Advantage / Advantage+ toggles explicitly (Advantage+ Audience, Advantage detailed targeting expansion, Advantage+ Placements, Advantage+ Creative) with a clear ควรเปิด/ควรปิด verdict + why for this specific niche.

Output ONLY valid JSON, no markdown fences, matching exactly this schema:
{
  "campaign_defaults": {
    "daily_budget_thb": number,
    "age_min": number,
    "age_max": number
  },
  "optimization_thresholds": {
    "target_cpa_thb": number,
    "min_spend_before_judging_thb": number,
    "underperform_multiplier": number,
    "outperform_multiplier": number,
    "scale_up_pct": number
  },
  "brand_voice": {
    "brand_voice": "...",
    "target_audience_desc": "...",
    "product_name": "...",
    "offer": "..."
  },
  "analysis": {
    "summary": "สรุปภาพรวมกลยุทธ์ 2-3 ประโยค เป็นภาษาไทย",
    "campaign_recommendations": [
      {
        "rank": 1,
        "objective_th": "ชื่อวัตถุประสงค์แคมเปญภาษาไทย เช่น โอกาสในการขาย (Leads)",
        "meta_objective": "Meta objective key เช่น OUTCOME_LEADS / OUTCOME_TRAFFIC / OUTCOME_ENGAGEMENT / OUTCOME_SALES",
        "conversion_location_th": "จุดเก็บ conversion เช่น ฟอร์มโต้ตอบทันที (Instant Form) / เว็บไซต์ / Messenger",
        "why": "ทำไมถึงแนะนำอันดับนี้ เจาะจงกับ niche นี้",
        "best_for": "เหมาะกับสถานการณ์ไหน",
        "watchouts": "ข้อควรระวัง/ข้อเสีย"
      }
    ],
    "campaign_level": {
      "recommended_objective_th": "วัตถุประสงค์ที่เลือกใช้จริง (อันดับ 1)",
      "buying_type_th": "ประเภทการซื้อ เช่น ประมูล (Auction)",
      "special_ad_category_th": "หมวดโฆษณาพิเศษ — ระบุว่าต้องตั้งอะไรไหมสำหรับ financial services ในไทย",
      "budget_type_th": "งบระดับแคมเปญ (CBO/Advantage campaign budget) หรือ งบระดับชุดโฆษณา (ABO) + เหตุผล",
      "recommended_daily_budget_thb": number,
      "bid_strategy_th": "กลยุทธ์บิด เช่น ต้นทุนต่ำที่สุด (Highest volume) + เหตุผล",
      "ab_test_th": "แนะนำเรื่อง A/B test ระดับแคมเปญไหม",
      "notes": "หมายเหตุอื่นๆ ระดับแคมเปญ"
    },
    "adset_level": {
      "optimization_event_th": "กิจกรรมที่ปรับให้เหมาะสม เช่น ลีด (Lead)",
      "conversion_location_th": "ที่ตั้ง conversion",
      "advantage_audience_th": "Advantage+ Audience: ควรเปิดหรือปิด + เหตุผลเจาะจง niche",
      "advantage_detailed_targeting_expansion_th": "การขยายกลุ่มเป้าหมายอัตโนมัติ (detailed targeting expansion): ควรเปิด/ปิด + เหตุผล",
      "detailed_targeting": {
        "interests": ["ชื่อ interest จริงบน Meta"],
        "behaviors": ["ชื่อ behavior จริงบน Meta"],
        "notes": "วิธีจัดกลุ่ม/ซ้อน (narrow) targeting + เหตุผล"
      },
      "age_th": "ช่วงอายุ + เหตุผล",
      "gender_th": "เพศ + เหตุผล",
      "locations_th": "พื้นที่ + เหตุผล",
      "languages_th": "ภาษา + เหตุผล",
      "placements_recommendation_th": "Advantage+ Placements หรือ กำหนดเอง (Manual) — เลือกอันไหน + เหตุผล",
      "recommended_placements": ["รายการตำแหน่งจัดวางที่แนะนำถ้าเลือก Manual เช่น Facebook Feed, Instagram Feed, Reels, Stories"],
      "placements_to_avoid": ["ตำแหน่งที่ควรปิด/ระวัง + เหตุผลสั้นๆ ในวงเล็บ"],
      "schedule_th": "การตั้งเวลา/ช่วงเวลายิง + เหตุผล",
      "attribution_setting_th": "การตั้งค่า attribution เช่น คลิก 7 วัน/ดู 1 วัน + เหตุผล",
      "notes": "หมายเหตุอื่นๆ ระดับชุดโฆษณา"
    },
    "ad_level": {
      "format_th": "รูปแบบโฆษณา เช่น ภาพเดี่ยว/วิดีโอ/คอลเลกชัน/ภาพสไลด์ + เหตุผล",
      "advantage_plus_creative_th": "Advantage+ Creative (การปรับแต่งอัตโนมัติ): ควรเปิด/ปิดตัวไหนบ้าง + เหตุผล",
      "primary_text_tips_th": "แนวทางเขียนข้อความหลัก (primary text) + มุมที่ควรใช้",
      "headline_tips_th": "แนวทางพาดหัว (headline)",
      "description_tips_th": "แนวทางคำอธิบาย (description)",
      "cta_button_th": "ปุ่ม CTA ที่แนะนำ เช่น สมัครเลย/ดูข้อมูลเพิ่มเติม + เหตุผล",
      "destination_th": "ปลายทาง เช่น Instant Form/เว็บ/Messenger + เหตุผล",
      "creative_tips_th": "เคล็ดลับภาพ/วิดีโอสำหรับ niche นี้",
      "compliance_th": "ข้อควรระวังด้านนโยบายโฆษณาการเงินของ Meta ในไทย",
      "notes": "หมายเหตุอื่นๆ ระดับโฆษณา"
    },
    "testing_plan_th": "แผนทดสอบ + สเกล 1-2 สัปดาห์แรก อธิบายเป็นขั้นตอน",
    "kpis_th": "ตัวชี้วัดที่ต้องจับตา (CPL, CTR, CPM, hook rate ฯลฯ) พร้อมช่วงตัวเลขที่ควรได้ในไทย"
  },
  "launch_config": {
    "objective": "OUTCOME_LEADS",
    "conversion_location": "instant_form",
    "creative_format": "image",
    "language": "th",
    "image_aspect_ratio": "1:1",
    "copy_length": "medium",
    "advantage_audience": 0,
    "special_ad_categories": [],
    "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
    "default_cta": "LEARN_MORE",
    "advantage_plus_creative": false,
    "placements": {
      "mode": "advantage",
      "publisher_platforms": [],
      "facebook_positions": [],
      "instagram_positions": [],
      "audience_network_positions": [],
      "messenger_positions": []
    }
  },
  "rationale": "สรุปเหตุผลสั้นๆ เป็นภาษาไทย ว่าทำไมถึงแนะนำค่าตัวเลข (งบ/อายุ/CPA/เกณฑ์) เหล่านี้"
}
The campaign_recommendations array MUST contain exactly 3 items, ranked 1-3.

"launch_config" is a MACHINE-READABLE version of your recommendation that the app will apply automatically when launching ads. It MUST use ONLY these exact enum values (not Thai, not free text):
- objective: one of "OUTCOME_LEADS","OUTCOME_ENGAGEMENT","OUTCOME_TRAFFIC","OUTCOME_SALES","OUTCOME_AWARENESS". Must match preferences.campaign_style when it is not "auto".
- conversion_location: one of "instant_form","messaging","website","calls". (lead_form→instant_form, chat→messaging, traffic/conversions→website)
- creative_format: one of "image","video","mixed". Must match preferences.creative_format when not "auto".
- image_aspect_ratio: one of "1:1","4:5","2:3","3:2","1.91:1". Recommend the best ratio for the chosen placements/format (feed → 1:1 or 4:5; Reels/Stories → 2:3; video wide → 1.91:1). This becomes the default image size in the content generator.
- copy_length: one of "short","medium","long". Recommend based on the campaign style/audience (e.g. chat/impulse → short; lead form with education needed → medium/long). This becomes the default copy length in the content generator.
- language: one of "th","en","th_en","other". Must match preferences.language when not "auto".
- advantage_audience: 0 (off = respect manual targeting) or 1 (on = let Meta expand). Must be consistent with analysis.adset_level.advantage_audience_th.
- special_ad_categories: array. For Thailand forex/gold rebate this is normally [] (empty). Only use a value if the offer truly falls under Meta's special categories (allowed: "CREDIT","EMPLOYMENT","HOUSING","ISSUES_ELECTIONS_POLITICS","FINANCIAL_PRODUCTS_SERVICES"). When unsure use [].
- bid_strategy: one of "LOWEST_COST_WITHOUT_CAP","LOWEST_COST_WITH_BID_CAP","COST_CAP". Prefer "LOWEST_COST_WITHOUT_CAP" for a new/testing campaign.
- default_cta: a Meta CTA enum string, e.g. "LEARN_MORE","SIGN_UP","GET_QUOTE","SUBSCRIBE","CONTACT_US","APPLY_NOW","GET_OFFER". Pick the best fit.
- advantage_plus_creative: boolean — whether to enable standard creative enhancements.
- placements.mode: "advantage" (automatic/Advantage+ placements) or "manual". If "manual", fill publisher_platforms and the *_positions arrays using ONLY Meta enums:
    publisher_platforms: subset of ["facebook","instagram","audience_network","messenger"]
    facebook_positions: subset of ["feed","video_feeds","story","reels","marketplace","search","facebook_reels"]
    instagram_positions: subset of ["stream","story","reels","explore","explore_home","profile_feed"]
    audience_network_positions: subset of ["classic","rewarded_video"]
    messenger_positions: subset of ["messenger_home","story"]
  If mode is "advantage", leave those arrays empty. Keep placements consistent with analysis.adset_level.placements_recommendation_th.`;

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

async function analyzeWithClaude(brief: Record<string, unknown>, sys: string = SYSTEM_PROMPT) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 8000,
      system: sys,
      messages: [{ role: "user", content: `Business brief:\n${JSON.stringify(brief)}` }],
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Claude API error: ${resp.status} ${t}`);
  }

  const data = await resp.json();
  const rawText = data.content[0].text;
  try {
    return extractJson(rawText);
  } catch {
    throw new Error("Claude ไม่ได้ตอบเป็น JSON ที่ถูกต้อง: " + rawText.slice(0, 300));
  }
}

async function analyzeWithOpenAI(brief: Record<string, unknown>, sys: string = SYSTEM_PROMPT) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${Deno.env.get("IMAGE_API_KEY")}`,
    },
    body: JSON.stringify({
      model: "gpt-5",
      // gpt-5 เป็น reasoning model — ต้องใช้ max_completion_tokens (ไม่ใช่ max_tokens)
      // และต้องเผื่อ budget ให้พอสำหรับ output ที่ยาวขึ้น ไม่งั้นเนื้อหาจะถูกตัด/ว่าง แล้ว parse JSON พัง
      max_completion_tokens: 12000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Business brief:\n${JSON.stringify(brief)}` },
      ],
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`OpenAI API error: ${resp.status} ${t}`);
  }

  const data = await resp.json();
  const choice = data.choices?.[0];
  const rawText = choice?.message?.content ?? "";
  if (!rawText) {
    throw new Error(
      `OpenAI ส่งเนื้อหาว่าง (finish_reason=${choice?.finish_reason ?? "?"}). ` +
        `มักเกิดจาก output ยาวเกิน budget — ลองใหม่อีกครั้ง หรือสลับไปใช้ Claude`
    );
  }
  try {
    return extractJson(rawText);
  } catch {
    throw new Error("OpenAI ไม่ได้ตอบเป็น JSON ที่ถูกต้อง: " + rawText.slice(0, 300));
  }
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

    const auth = await authorizeRequest(req, { admin: true, setting: "general" });
    if (!auth.ok) {
      return new Response(JSON.stringify({ ok: false, error: auth.error }), {
        status: auth.status,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const brief = await req.json();
    if (!brief.business_desc) {
      throw new Error("ต้องกรอกคำอธิบายธุรกิจ/สินค้าก่อนให้ AI วิเคราะห์");
    }
    const textModel = brief.text_model === "claude" ? "claude" : "openai";
    const sysPrompt = withOverride(SYSTEM_PROMPT, await getPromptOverride("analyze_settings"));

    const parsed =
      textModel === "openai" ? await analyzeWithOpenAI(brief, sysPrompt) : await analyzeWithClaude(brief, sysPrompt);

    // ดึงค่า campaign_defaults เดิม แล้ว merge เฉพาะ field ที่ AI แนะนำ
    // (ไม่แตะ page_id / ad_account_id / pixel_id / audience_id / landing_url ที่เป็นข้อมูลบัญชีจริง ต้องกรอกเองเท่านั้น)
    const { data: existingRows } = await supabaseAdmin
      .from("settings")
      .select("key, value")
      .in("key", ["campaign_defaults"]);
    const existingCampaignDefaults = existingRows?.find((r) => r.key === "campaign_defaults")?.value ?? {};

    const mergedCampaignDefaults = {
      ...existingCampaignDefaults,
      daily_budget_thb: parsed.campaign_defaults?.daily_budget_thb ?? existingCampaignDefaults.daily_budget_thb,
      age_min: parsed.campaign_defaults?.age_min ?? existingCampaignDefaults.age_min,
      age_max: parsed.campaign_defaults?.age_max ?? existingCampaignDefaults.age_max,
    };

    // เก็บผลวิเคราะห์ละเอียด (playbook) ไว้ใน settings ด้วย เพื่อให้หน้าเว็บโหลดกลับมาแสดงได้แม้รีเฟรช
    const analysisRecord = {
      ...(parsed.analysis ?? {}),
      launch_config: parsed.launch_config ?? null, // ค่าที่พร้อมนำไปใช้จริงตอนลอนช์ (กดปุ่ม "เซ็ต ads ตาม AI")
      preferences: brief.preferences ?? null, // ตัวเลือกที่แอดมินเลือกก่อนวิเคราะห์ (ไว้ prefill รอบหน้า)
      business_desc: brief.business_desc,
      generated_at: new Date().toISOString(),
    };

    const now = new Date().toISOString();
    const { error: upsertError } = await supabaseAdmin.from("settings").upsert([
      { key: "campaign_defaults", value: mergedCampaignDefaults, updated_at: now },
      { key: "optimization_thresholds", value: parsed.optimization_thresholds, updated_at: now },
      { key: "brand_voice", value: parsed.brand_voice, updated_at: now },
      { key: "ai_analysis", value: analysisRecord, updated_at: now },
    ]);
    if (upsertError) throw upsertError;

    return new Response(
      JSON.stringify({
        ok: true,
        applied: {
          campaign_defaults: mergedCampaignDefaults,
          optimization_thresholds: parsed.optimization_thresholds,
          brand_voice: parsed.brand_voice,
        },
        analysis: analysisRecord,
        launch_config: parsed.launch_config ?? null,
        rationale: parsed.rationale || "",
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
