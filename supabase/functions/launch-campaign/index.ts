// supabase/functions/launch-campaign/index.ts
// เรียกจากเว็บแอปตอนแอดมินยืนยันลอนช์ในหน้า "รออนุมัติ"
// รับ pairs (array ของ {copy_id, image_id}) + mode:
//   "separate_campaigns"       -> วนสร้าง Campaign->AdSet->Ad แยกกันทีละคู่ (งบ/แคมเปญแยกอิสระ)
//   "single_campaign_multi_ad" -> สร้าง Campaign->AdSet เดียว แล้ววน AdCreative->Ad หลายตัวในนั้น (แข่งกันเองในงบเดียว)
// ทุกคู่ที่ลอนช์สำเร็จจะถูกบันทึกเป็นแถวใหม่ใน ad_content (status=active) — copy/image ต้นทางถูกมาร์กเป็น used
//
// Secrets ที่ต้องตั้ง:
//   META_ACCESS_TOKEN   (System User long-lived token ที่มีสิทธิ์ ads_management)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { authorizeRequest } from "../_shared/permissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH_VERSION = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)
let META_TOKEN_VALUE = "";
const META_TOKEN = () => META_TOKEN_VALUE;

async function metaPost(path: string, body: Record<string, unknown>) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${path}?access_token=${META_TOKEN()}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Meta API error on ${path}: ${JSON.stringify(data)}`);
  return data;
}

// enum ที่อนุญาตสำหรับ placements — ใช้กรองค่าจาก launch_config กันค่าเพี้ยนทำให้ Meta ปฏิเสธ
const ALLOWED_PLATFORMS = ["facebook", "instagram", "audience_network", "messenger"];
const ALLOWED_POSITIONS: Record<string, string[]> = {
  facebook_positions: ["feed", "video_feeds", "story", "reels", "marketplace", "search", "facebook_reels"],
  instagram_positions: ["stream", "story", "reels", "explore", "explore_home", "profile_feed"],
  audience_network_positions: ["classic", "rewarded_video"],
  messenger_positions: ["messenger_home", "story"],
};

// สร้างส่วน placements แบบ manual จาก launch_config (คืน {} ถ้าเป็น advantage หรือข้อมูลไม่พอ -> Meta จัด placements ให้เอง)
function buildManualPlacements(launchCfg: Record<string, any> | null) {
  const p = launchCfg?.placements;
  if (!p || p.mode !== "manual") return {};
  const platforms = (Array.isArray(p.publisher_platforms) ? p.publisher_platforms : []).filter((x: string) =>
    ALLOWED_PLATFORMS.includes(x)
  );
  if (platforms.length === 0) return {}; // ข้อมูลไม่พอ -> fallback advantage placements
  const out: Record<string, unknown> = { publisher_platforms: platforms };
  for (const key of Object.keys(ALLOWED_POSITIONS)) {
    const platformKey = key.replace("_positions", ""); // facebook_positions -> facebook
    if (!platforms.includes(platformKey)) continue;
    const vals = (Array.isArray(p[key]) ? p[key] : []).filter((x: string) => ALLOWED_POSITIONS[key].includes(x));
    if (vals.length > 0) out[key] = vals;
  }
  return out;
}

function buildTargeting(cfg: Record<string, any>, launchCfg: Record<string, any> | null, ghostCfg: Record<string, any> | null) {
  // interests ที่ resolve-audience-interests เซฟไว้ล่วงหน้า (ยิง Meta targetingsearch จริงมาแล้ว ไม่ใช่ข้อความเดา)
  // ใส่เป็น flexible_spec เพื่อจำกัดกลุ่มเป้าหมายตามความสนใจ/พฤติกรรม ไม่ใช่แค่อายุ+ประเทศเหมือนเดิม
  const interests: { id: string; name?: string }[] = Array.isArray(cfg.interests) ? cfg.interests : [];
  const flexibleSpec =
    interests.length > 0 ? { flexible_spec: [{ interests: interests.map((i) => ({ id: i.id })) }] } : {};

  // Meta บังคับให้ระบุสถานะฟีเจอร์ "กลุ่มเป้าหมาย Advantage" ตรงๆ ตั้งแต่ปี 2024 เป็นต้นมา
  // ค่าเริ่มต้น 0 (ปิด) เพื่อคุม targeting เอง — แต่ถ้า launch_config สั่งเปิด (1) ก็ใช้ตามนั้น
  const advantageAudience = launchCfg?.advantage_audience === 1 ? 1 : 0;
  let placements = buildManualPlacements(launchCfg); // {} = advantage placements (Meta จัดให้เอง)

  // ป้องกันแชทผี: ตัด Audience Network ออก (แหล่งมิสคลิก/บอทอันดับ 1)
  // ถ้าเดิมเป็น advantage placements (Meta จัดเอง) ต้องสลับเป็น manual โดยระบุแพลตฟอร์มที่เหลือ เพื่อ "ไม่รวม" AN
  const excludeAN = ghostCfg?.enabled !== false && ghostCfg?.exclude_audience_network !== false;
  if (excludeAN) {
    const current = placements as Record<string, any>;
    if (current.publisher_platforms) {
      // manual อยู่แล้ว -> เอา audience_network ออก
      const filtered = current.publisher_platforms.filter((p: string) => p !== "audience_network");
      placements = { ...current, publisher_platforms: filtered.length ? filtered : ["facebook", "instagram"] };
      delete (placements as Record<string, any>).audience_network_positions;
    } else {
      // advantage placements -> บังคับ manual เฉพาะแพลตฟอร์มที่ไม่ใช่ AN
      placements = { publisher_platforms: ["facebook", "instagram", "messenger"] };
    }
  }

  return cfg.audience_id
    ? {
        custom_audiences: [{ id: cfg.audience_id }],
        geo_locations: { countries: ["TH"] },
        targeting_automation: { advantage_audience: advantageAudience },
        ...placements,
        ...flexibleSpec,
      }
    : {
        geo_locations: { countries: ["TH"] },
        age_min: cfg.age_min || 22,
        age_max: cfg.age_max || 55,
        targeting_automation: { advantage_audience: advantageAudience },
        ...placements,
        ...flexibleSpec,
      };
}

function buildPromotedObject(cfg: Record<string, any>) {
  // objective OUTCOME_LEADS ต้องมี promoted_object เสมอ ห้ามปล่อยว่าง
  // มี pixel_id -> วัดผล lead จาก pixel event บนหน้า landing page
  // ไม่มี pixel_id -> fallback เป็น page_id เพื่อใช้ Instant Form (แบบฟอร์มลีดในเพจ) แทน
  if (!cfg.pixel_id && !cfg.page_id) {
    throw new Error("ต้องตั้งค่า pixel_id หรือ page_id อย่างน้อยหนึ่งอย่างในหน้า 'ตั้งค่า' ก่อนลอนช์แคมเปญ");
  }
  return cfg.pixel_id ? { pixel_id: cfg.pixel_id, custom_event_type: "LEAD" } : { page_id: cfg.page_id };
}

// optimization_goal ต้องตรงกับชนิดของ promoted_object เสมอ ไม่งั้น Meta ตอบ
// OAuthException code 100 "ไม่สามารถใช้เป้าหมายประสิทธิภาพได้"
// - promoted_object เป็น pixel_id (วัดผลจาก landing page ภายนอก) -> ต้องใช้ OFFSITE_CONVERSIONS
// - promoted_object เป็น page_id (Instant Form ในเพจ) -> ใช้ LEAD_GENERATION ได้
function buildOptimizationGoal(cfg: Record<string, any>) {
  return cfg.pixel_id ? "OFFSITE_CONVERSIONS" : "LEAD_GENERATION";
}

// special_ad_categories: อนุญาตเฉพาะค่าที่ Meta รับได้ ถ้า config ว่าง/เพี้ยน -> [] (ปลอดภัยสุดสำหรับ niche นี้)
const ALLOWED_SPECIAL_CATEGORIES = [
  "CREDIT",
  "EMPLOYMENT",
  "HOUSING",
  "ISSUES_ELECTIONS_POLITICS",
  "FINANCIAL_PRODUCTS_SERVICES",
];
function sanitizeSpecialCategories(launchCfg: Record<string, any> | null) {
  const raw = launchCfg?.special_ad_categories;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x: string) => ALLOWED_SPECIAL_CATEGORIES.includes(x));
}

async function createCampaign(actAccount: string, name: string, launchCfg: Record<string, any> | null) {
  return metaPost(`${actAccount}/campaigns`, {
    name: `AI-Gen | ${name}`,
    objective: "OUTCOME_LEADS",
    status: "PAUSED",
    special_ad_categories: sanitizeSpecialCategories(launchCfg),
    // budget ของแคมเปญนี้อยู่ที่ระดับ adset ไม่ใช่ Campaign Budget Optimization
    is_adset_budget_sharing_enabled: false,
  });
}

async function createAdset(
  actAccount: string,
  campaignId: string,
  name: string,
  dailyBudgetThb: number,
  targeting: Record<string, unknown>,
  promotedObject: Record<string, unknown>,
  optimizationGoal: string,
  launchCfg: Record<string, any> | null
) {
  // ใช้ bid_strategy จาก config เฉพาะแบบไม่ต้องมีวงเงินบิด (WITHOUT_CAP) เท่านั้น
  // แบบ COST_CAP / BID_CAP ต้องมี bid_amount ด้วย ถ้าไม่มีจะทำให้ Meta ปฏิเสธ -> fallback เป็นค่าปลอดภัยเดิม
  const bidStrategy =
    launchCfg?.bid_strategy === "LOWEST_COST_WITHOUT_CAP" ? "LOWEST_COST_WITHOUT_CAP" : "LOWEST_COST_WITHOUT_CAP";
  return metaPost(`${actAccount}/adsets`, {
    name: `AdSet | ${name}`,
    campaign_id: campaignId,
    daily_budget: dailyBudgetThb * 100,
    billing_event: "IMPRESSIONS",
    optimization_goal: optimizationGoal,
    bid_strategy: bidStrategy,
    targeting,
    promoted_object: promotedObject,
    status: "PAUSED",
  });
}

async function createCreativeAndAd(
  actAccount: string,
  adsetId: string,
  cfg: Record<string, any>,
  copy: { headline: string; primary_text: string; description: string; cta: string },
  imageUrl: string | null,
  launchCfg: Record<string, any> | null
) {
  // CTA: ใช้ของ copy ก่อน ถ้าไม่มีค่อย fallback เป็น default_cta ที่ AI แนะนำ แล้วค่อย LEARN_MORE
  const ctaType = copy.cta || launchCfg?.default_cta || "LEARN_MORE";
  // Advantage+ creative (standard enhancements) — ใส่เฉพาะเมื่อ config เปิดไว้
  const creativeEnhancements =
    launchCfg?.advantage_plus_creative === true
      ? { degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: "OPT_IN" } } } }
      : {};

  const creative = await metaPost(`${actAccount}/adcreatives`, {
    name: `Creative | ${copy.headline}`,
    object_story_spec: {
      page_id: cfg.page_id,
      link_data: {
        message: copy.primary_text,
        link: cfg.landing_url || "https://example.com",
        picture: imageUrl || undefined,
        name: copy.headline,
        description: copy.description,
        call_to_action: { type: ctaType },
      },
    },
    ...creativeEnhancements,
  });

  const ad = await metaPost(`${actAccount}/ads`, {
    name: `Ad | ${copy.headline}`,
    adset_id: adsetId,
    creative: { creative_id: creative.id },
    status: "ACTIVE",
  });

  return { creative, ad };
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

    const auth = await authorizeRequest(req, { admin: true, tab: ["review", "campaigns"] });
    if (!auth.ok) {
      return new Response(JSON.stringify({ ok: false, error: auth.error }), {
        status: auth.status,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    META_TOKEN_VALUE = await getMetaToken();

    const body = await req.json();

    // ----- action === "reject": ปฏิเสธ copy และ/หรือ image เดี่ยวๆ (ไม่ต้องจับคู่) -----
    if (body.action === "reject") {
      const { copy_id, image_id } = body;
      if (!copy_id && !image_id) throw new Error("ต้องส่ง copy_id หรือ image_id อย่างน้อยหนึ่งอย่างเพื่อปฏิเสธ");
      if (copy_id) await supabaseAdmin.from("ad_copies").update({ status: "rejected" }).eq("id", copy_id);
      if (image_id) await supabaseAdmin.from("ad_images").update({ status: "rejected" }).eq("id", image_id);
      return new Response(JSON.stringify({ ok: true, status: "rejected" }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    // ----- action === "launch": จับคู่ copy+image แล้วยิงจริงตาม mode -----
    const pairs: { copy_id: string; image_id: string; daily_budget_thb?: number }[] = body.pairs || [];
    const mode: "separate_campaigns" | "single_campaign_multi_ad" = body.mode === "single_campaign_multi_ad"
      ? "single_campaign_multi_ad"
      : "separate_campaigns";
    if (!pairs.length) throw new Error("ต้องส่ง pairs อย่างน้อย 1 คู่ (copy_id + image_id)");

    const { data: settingsRows } = await supabaseAdmin
      .from("settings")
      .select("key, value")
      .in("key", ["campaign_defaults", "launch_config", "ghost_protection"]);
    const cfg = settingsRows?.find((s) => s.key === "campaign_defaults")?.value ?? {};
    // launch_config = ค่าที่ AI แนะนำและแอดมินกด "เซ็ต ads ตาม AI" ไว้ (ถ้าไม่มี = ใช้ค่า default เดิม ไม่กระทบการลอนช์)
    const launchCfg = settingsRows?.find((s) => s.key === "launch_config")?.value ?? null;
    // ghost_protection = ตั้งค่าป้องกันแชทผี (ตัด Audience Network ฯลฯ)
    const ghostCfg = settingsRows?.find((s) => s.key === "ghost_protection")?.value ?? null;

    if (!cfg.ad_account_id || !cfg.page_id) {
      throw new Error("ยังตั้งค่า ad_account_id / page_id ไม่ครบในหน้า 'ตั้งค่า' ของเว็บแอป");
    }
    const actAccount = `act_${cfg.ad_account_id}`;
    const defaultDailyBudget = cfg.daily_budget_thb || 300;
    const targeting = buildTargeting(cfg, launchCfg, ghostCfg);
    const promotedObject = buildPromotedObject(cfg);
    const optimizationGoal = buildOptimizationGoal(cfg);

    // ดึงข้อมูล copy/image ที่เลือกไว้ทั้งหมดในครั้งเดียว
    const copyIds = [...new Set(pairs.map((p) => p.copy_id))];
    const imageIds = [...new Set(pairs.map((p) => p.image_id))];
    const [{ data: copies, error: copiesErr }, { data: images, error: imagesErr }] = await Promise.all([
      supabaseAdmin.from("ad_copies").select("*").in("id", copyIds),
      supabaseAdmin.from("ad_images").select("*").in("id", imageIds),
    ]);
    if (copiesErr) throw copiesErr;
    if (imagesErr) throw imagesErr;
    const copyById = new Map((copies || []).map((c) => [c.id, c]));
    const imageById = new Map((images || []).map((im) => [im.id, im]));

    const launchGroupId = crypto.randomUUID();
    const insertedRows: unknown[] = [];

    if (mode === "separate_campaigns") {
      // แต่ละคู่ = แคมเปญของตัวเอง งบแยกอิสระ เทียบผลกันตรงๆ ได้ง่าย
      for (const pair of pairs) {
        const copy = copyById.get(pair.copy_id);
        const image = imageById.get(pair.image_id);
        if (!copy) throw new Error(`ไม่พบ copy id ${pair.copy_id}`);
        const dailyBudgetThb = pair.daily_budget_thb || defaultDailyBudget;

        const campaign = await createCampaign(actAccount, copy.headline, launchCfg);
        const adset = await createAdset(actAccount, campaign.id, copy.headline, dailyBudgetThb, targeting, promotedObject, optimizationGoal, launchCfg);
        const { ad } = await createCreativeAndAd(actAccount, adset.id, cfg, copy, image?.image_url ?? null, launchCfg);

        const { data: row, error: insertErr } = await supabaseAdmin
          .from("ad_content")
          .insert({
            product: copy.product,
            headline: copy.headline,
            primary_text: copy.primary_text,
            description: copy.description,
            cta: copy.cta,
            image_url: image?.image_url ?? null,
            image_prompt: image?.image_prompt ?? null,
            status: "active",
            campaign_id: campaign.id,
            adset_id: adset.id,
            ad_id: ad.id,
            daily_budget_thb: dailyBudgetThb,
            copy_id: copy.id,
            image_id: image?.id ?? null,
            launch_group_id: launchGroupId,
            launch_mode: mode,
            reviewed_by: auth.user?.id ?? null,
            reviewed_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (insertErr) throw insertErr;
        insertedRows.push(row);
      }
    } else {
      // single_campaign_multi_ad: แคมเปญ+adset เดียว หลาย ad แข่งกันเองในงบก้อนเดียว
      const firstCopy = copyById.get(pairs[0].copy_id);
      if (!firstCopy) throw new Error(`ไม่พบ copy id ${pairs[0].copy_id}`);
      const totalDailyBudget = body.daily_budget_thb || defaultDailyBudget;

      const campaign = await createCampaign(actAccount, `${firstCopy.headline} (multi-ad)`, launchCfg);
      const adset = await createAdset(actAccount, campaign.id, `${firstCopy.headline} (multi-ad)`, totalDailyBudget, targeting, promotedObject, optimizationGoal, launchCfg);

      for (const pair of pairs) {
        const copy = copyById.get(pair.copy_id);
        const image = imageById.get(pair.image_id);
        if (!copy) throw new Error(`ไม่พบ copy id ${pair.copy_id}`);
        const { ad } = await createCreativeAndAd(actAccount, adset.id, cfg, copy, image?.image_url ?? null, launchCfg);

        const { data: row, error: insertErr } = await supabaseAdmin
          .from("ad_content")
          .insert({
            product: copy.product,
            headline: copy.headline,
            primary_text: copy.primary_text,
            description: copy.description,
            cta: copy.cta,
            image_url: image?.image_url ?? null,
            image_prompt: image?.image_prompt ?? null,
            status: "active",
            campaign_id: campaign.id,
            adset_id: adset.id,
            ad_id: ad.id,
            daily_budget_thb: totalDailyBudget,
            copy_id: copy.id,
            image_id: image?.id ?? null,
            launch_group_id: launchGroupId,
            launch_mode: mode,
            reviewed_by: auth.user?.id ?? null,
            reviewed_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (insertErr) throw insertErr;
        insertedRows.push(row);
      }
    }

    // มาร์ก copy/image ต้นทางที่ใช้ไปแล้วว่า "used" (ยังอยู่ในระบบ ใช้ซ้ำได้อีกถ้าต้องการ)
    await Promise.all([
      supabaseAdmin.from("ad_copies").update({ status: "used" }).in("id", copyIds),
      supabaseAdmin.from("ad_images").update({ status: "used" }).in("id", imageIds),
    ]);

    return new Response(
      JSON.stringify({ ok: true, launch_group_id: launchGroupId, mode, launched: insertedRows.length, rows: insertedRows }),
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
