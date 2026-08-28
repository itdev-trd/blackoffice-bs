// supabase/functions/ad-config-full/index.ts
// ดึงรายละเอียดการตั้งค่า "เต็มทั้งหมด" ของ node แบบลำดับชั้น (แคมเปญ + ชุดโฆษณา + โฆษณา)
// ไม่ตัดข้อมูล — ความสนใจมีเท่าไหร่ส่งคืนครบ
import { getMetaToken } from "../_shared/meta.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { canAccessMetaNodes } from "../_shared/meta-authorization.ts";

const GRAPH_VERSION = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const bTHB = (v: unknown) => (v ? Math.round(parseFloat(String(v)) / 100) : null);

function names(arr: any): string[] { return Array.isArray(arr) ? arr.map((x: any) => x?.name || x?.id).filter(Boolean) : []; }

function normCampaign(c: any) {
  if (!c) return null;
  return {
    id: c.id, name: c.name, status: c.effective_status || c.status,
    objective: c.objective, buying_type: c.buying_type || null, bid_strategy: c.bid_strategy || null,
    daily_budget_thb: bTHB(c.daily_budget), lifetime_budget_thb: bTHB(c.lifetime_budget),
    special_ad_categories: c.special_ad_categories || [],
  };
}
function normAdset(a: any) {
  if (!a) return null;
  const t = a.targeting || {};
  const geo = t.geo_locations || {};
  const interests: string[] = [];
  const behaviors: string[] = [];
  const demos: string[] = [];
  for (const spec of ([] as any[]).concat(t.flexible_spec || [], t)) {
    interests.push(...names(spec?.interests));
    behaviors.push(...names(spec?.behaviors));
    demos.push(...names(spec?.life_events), ...names(spec?.industries), ...names(spec?.work_positions), ...names(spec?.education_statuses));
  }
  return {
    id: a.id, name: a.name, status: a.effective_status || a.status,
    optimization_goal: a.optimization_goal || null, billing_event: a.billing_event || null,
    bid_thb: a.bid_amount ? bTHB(a.bid_amount) : null,
    daily_budget_thb: bTHB(a.daily_budget), lifetime_budget_thb: bTHB(a.lifetime_budget),
    start_time: a.start_time || null, end_time: a.end_time || null,
    age: [t.age_min ?? null, t.age_max ?? null],
    genders: t.genders ? t.genders.map((g: number) => (g === 1 ? "ชาย" : g === 2 ? "หญิง" : g)) : "ทุกเพศ",
    locales: t.locales || null,
    countries: geo.countries || [],
    regions: names(geo.regions),
    cities: names(geo.cities),
    interests: [...new Set(interests)],
    behaviors: [...new Set(behaviors)],
    demographics: [...new Set(demos)],
    custom_audiences: names(t.custom_audiences),
    excluded_custom_audiences: names(t.excluded_custom_audiences),
    placements: t.publisher_platforms
      ? { platforms: t.publisher_platforms, facebook_positions: t.facebook_positions || null, instagram_positions: t.instagram_positions || null, messenger_positions: t.messenger_positions || null, audience_network_positions: t.audience_network_positions || null, device_platforms: t.device_platforms || null }
      : "advantage_plus_auto",
    advantage_audience: t.targeting_automation?.advantage_audience ?? null,
  };
}
function normAd(ad: any) {
  if (!ad) return null;
  const cr = ad.creative || {};
  const oss = cr.object_story_spec || {};
  const link = oss.link_data || {};
  const vid = oss.video_data || {};
  const afs = cr.asset_feed_spec || {};
  const video_id = cr.video_id || vid.video_id || afs.videos?.[0]?.video_id || null;
  const isVideo = !!video_id || cr.object_type === "VIDEO" || (afs.videos?.length > 0);
  return {
    id: ad.id, name: ad.name, status: ad.effective_status || ad.status,
    headline: cr.title || link.name || vid.title || afs.titles?.[0]?.text || null,
    body: cr.body || link.message || vid.message || afs.bodies?.[0]?.text || null,
    description: link.description || vid.link_description || afs.descriptions?.[0]?.text || afs.link_urls?.[0]?.display_url || null,
    media_type: isVideo ? "video" : "image",
    video_id,
    story_id: cr.effective_object_story_id || null,
    video_url: null as string | null,
    image_url: cr.image_url || cr.thumbnail_url || link.picture || vid.image_url || null,
    cta: cr.call_to_action_type || link.call_to_action?.type || vid.call_to_action?.type || afs.call_to_action_types?.[0] || null,
    link: link.link || afs.link_urls?.[0]?.website_url || null,
    page_id: oss.page_id || null,
  };
}

const AD_CR = "creative{title,body,image_url,thumbnail_url,call_to_action_type,object_type,video_id,effective_object_story_id,object_story_spec,asset_feed_spec}";
const ADSET_F = "id,name,effective_status,optimization_goal,billing_event,bid_amount,daily_budget,lifetime_budget,start_time,end_time,targeting";
const CAMP_F = "id,name,effective_status,objective,buying_type,bid_strategy,daily_budget,lifetime_budget,special_ad_categories";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { node_id, level } = await req.json();
    if (!node_id) throw new Error("ต้องส่ง node_id");
    const auth = await authorizeRequest(req, { tab: ["campaigns", "analyze"] });
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });
    const token = await getMetaToken();
    if (!token) throw new Error("ยังไม่ได้ตั้งค่า Meta access token");
    if (auth.permission && !(await canAccessMetaNodes(auth.permission, token, [node_id], GRAPH_VERSION))) {
      return new Response(JSON.stringify({ ok: false, error: "ไม่มีสิทธิ์เข้าถึงบัญชีโฆษณานี้" }), { status: 403, headers: { ...corsHeaders, "content-type": "application/json" } });
    }
    const base = `https://graph.facebook.com/${GRAPH_VERSION}`;
    const get = async (fields: string) => await (await fetch(`${base}/${node_id}?fields=${encodeURIComponent(fields)}&access_token=${token}`)).json();

    let campaign = null, adsets: any[] = [];
    if (level === "ads" || level === "ad") {
      const d = await get(`id,name,effective_status,${AD_CR},adset{${ADSET_F},campaign{${CAMP_F}}}`);
      if (d?.error) throw new Error(d.error.message);
      campaign = normCampaign(d.adset?.campaign);
      adsets = [{ ...normAdset(d.adset), ads: [normAd(d)] }];
    } else if (level === "adsets" || level === "adset") {
      const d = await get(`${ADSET_F},campaign{${CAMP_F}},ads.limit(50){id,name,effective_status,${AD_CR}}`);
      if (d?.error) throw new Error(d.error.message);
      campaign = normCampaign(d.campaign);
      adsets = [{ ...normAdset(d), ads: (d.ads?.data ?? []).map(normAd) }];
    } else {
      const d = await get(`${CAMP_F},adsets.limit(50){${ADSET_F},ads.limit(50){id,name,effective_status,${AD_CR}}}`);
      if (d?.error) throw new Error(d.error.message);
      campaign = normCampaign(d);
      adsets = (d.adsets?.data ?? []).map((a: any) => ({ ...normAdset(a), ads: (a.ads?.data ?? []).map(normAd) }));
    }

    // ดึงสื่อจริง: วิดีโอที่มี video_id → เอา source; โฆษณาที่ใช้โพสต์เดิม → อ่าน attachments เพื่อหาวิดีโอ
    const allAds: any[] = [];
    for (const a of adsets) for (const ad of a.ads || []) if (ad) allAds.push(ad);
    await Promise.all(allAds.slice(0, 25).map(async (ad) => {
      try {
        if (ad.video_id) {
          const v = await (await fetch(`${base}/${ad.video_id}?fields=source,picture&access_token=${token}`)).json();
          if (!v?.error) { ad.video_url = v.source || null; if (!ad.image_url && v.picture) ad.image_url = v.picture; }
        } else if (ad.story_id) {
          // โฆษณาที่ใช้โพสต์เดิม — อ่านโพสต์เพื่อดูว่าเป็นวิดีโอไหม + ดึง source
          const p = await (await fetch(`${base}/${ad.story_id}?fields=attachments{media_type,media{source,image},subattachments{media_type,media{source,image}}}&access_token=${token}`)).json();
          if (!p?.error) {
            const atts = p.attachments?.data ?? [];
            const collect = (a: any) => [a, ...((a?.subattachments?.data) ?? [])];
            const flat = atts.flatMap(collect);
            const v = flat.find((a: any) => a?.media_type === "video" && a?.media?.source);
            if (v) { ad.media_type = "video"; ad.video_url = v.media.source; if (!ad.image_url) ad.image_url = v.media?.image?.src || null; }
            else if (!ad.image_url) { const img = flat.find((a: any) => a?.media?.image?.src); if (img) ad.image_url = img.media.image.src; }
          }
        }
      } catch { /* ข้ามถ้าดึงไม่ได้ */ }
    }));

    return new Response(JSON.stringify({ ok: true, campaign, adsets }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err instanceof Error ? err.message : err) }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
});
