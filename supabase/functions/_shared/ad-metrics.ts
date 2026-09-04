// supabase/functions/_shared/ad-metrics.ts
// ตัวชี้วัดโฆษณา — ที่เดียวสำหรับ list-campaigns / list-children เพื่อให้ทุกชั้นของตารางเลขตรงกัน
//
// ทำไมต้องมีไฟล์นี้: เดิมสองฟังก์ชันคำนวณแยกกัน (LEAD_TYPES ไม่เท่ากันด้วย) แล้วฝั่งหน้าเว็บ
// เดาเองว่าคอลัมน์ "ผลลัพธ์" ควรโชว์อะไร โดยไล่ลำดับตายตัว leads > conversations > link_clicks
// ผลคือแคมเปญที่ซื้อ "บทสนทนา" ถูกแสดงเป็น "ลีด" — วัดจริงกับ Ads Manager: ของเรา 222 ลีด
// แต่ Meta รายงาน 386 บทสนทนา ทำให้ต้นทุน/ผลลัพธ์เพี้ยนตาม (฿42.04 แทนที่จะเป็น ฿24.18)
//
// Meta ไม่มีฟิลด์ "results" ให้ดึงตรงๆ — คอลัมน์ผลลัพธ์ใน Ads Manager คือ action ที่ตรงกับ
// optimization_goal ของชุดโฆษณา จึงต้องดึง optimization_goal มาแล้วแมปเอง

export const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);

export function sumActions(actions: any[], match: (t: string) => boolean) {
  return (actions || []).filter((a) => match(String(a?.action_type || ""))).reduce((s, a) => s + num(a.value), 0);
}

// ชนิดผลลัพธ์ที่รองรับ — key ใช้ภายใน, label คือสิ่งที่แอดมินเห็น
const RESULT_DEFS: Record<string, { label: string; match: (t: string) => boolean }> = {
  conversations: { label: "บทสนทนา", match: (t) => t.includes("messaging_conversation_started") },
  leads:         { label: "ลีด",      match: (t) => t === "lead" || t === "onsite_conversion.lead_grouped" || t === "offsite_conversion.fb_pixel_lead" },
  link_clicks:   { label: "คลิกลิงก์", match: (t) => t === "link_click" },
  landing_views: { label: "ดูแลนดิ้ง", match: (t) => t === "landing_page_view" },
  page_likes:    { label: "ถูกใจเพจ",  match: (t) => t === "like" },
  engagement:    { label: "การมีส่วนร่วม", match: (t) => t === "post_engagement" },
  video_views:   { label: "ดูวิดีโอ",  match: (t) => t === "video_view" || t.includes("video_thruplay") },
  purchases:     { label: "การซื้อ",   match: (t) => t === "purchase" || t === "offsite_conversion.fb_pixel_purchase" },
  app_installs:  { label: "ติดตั้งแอป", match: (t) => t === "app_install" || t === "mobile_app_install" },
};

// optimization_goal ของชุดโฆษณา = ตัวบอกตรงที่สุดว่า Meta นับอะไรเป็น "ผลลัพธ์"
const GOAL_TO_RESULT: Record<string, string> = {
  CONVERSATIONS: "conversations",
  LEAD_GENERATION: "leads",
  QUALITY_LEAD: "leads",
  QUALITY_CALL: "leads",
  LINK_CLICKS: "link_clicks",
  LANDING_PAGE_VIEWS: "landing_views",
  PAGE_LIKES: "page_likes",
  POST_ENGAGEMENT: "engagement",
  EVENT_RESPONSES: "engagement",
  THRUPLAY: "video_views",
  VIDEO_VIEWS: "video_views",
  OFFSITE_CONVERSIONS: "purchases",
  VALUE: "purchases",
  APP_INSTALLS: "app_installs",
};

// ไม่มี optimization_goal (ระดับแคมเปญที่ดึง adsets ไม่ได้) ค่อยเดาจาก objective
const OBJECTIVE_TO_RESULT: Record<string, string> = {
  OUTCOME_LEADS: "leads",
  OUTCOME_ENGAGEMENT: "conversations",
  OUTCOME_TRAFFIC: "link_clicks",
  OUTCOME_SALES: "purchases",
  OUTCOME_AWARENESS: "engagement",
  OUTCOME_APP_PROMOTION: "app_installs",
  LEAD_GENERATION: "leads",
  MESSAGES: "conversations",
  LINK_CLICKS: "link_clicks",
  POST_ENGAGEMENT: "engagement",
  PAGE_LIKES: "page_likes",
  CONVERSIONS: "purchases",
};

/**
 * เลือกชนิดผลลัพธ์ที่ Meta ใช้นับ
 * @param goals optimization_goal ของชุดโฆษณาที่เกี่ยวข้อง (ระดับแคมเปญอาจมีหลายอัน)
 * @param objective objective ของแคมเปญ ใช้เมื่อไม่มี goal
 */
export function pickResultType(goals: string[] | null | undefined, objective?: string | null): string | null {
  for (const g of goals || []) {
    const hit = GOAL_TO_RESULT[String(g || "").toUpperCase()];
    if (hit) return hit;   // ชุดโฆษณาในแคมเปญเดียวกันแทบทั้งหมดใช้เป้าหมายเดียวกัน เอาตัวแรกที่รู้จัก
  }
  return OBJECTIVE_TO_RESULT[String(objective || "").toUpperCase()] || null;
}

export function buildMetrics(o: any, opts: { goals?: string[] | null; objective?: string | null } = {}) {
  const spend = num(o?.spend);
  const actions = o?.actions || [];

  // นับทุกชนิดไว้เลย เพื่อให้หน้าเว็บสลับมุมมองได้โดยไม่ต้องยิง Meta ใหม่
  const counts: Record<string, number> = {};
  for (const [key, def] of Object.entries(RESULT_DEFS)) counts[key] = sumActions(actions, def.match);

  const replies = sumActions(actions, (t) => t.includes("messaging_user_depth_2_message_send"));
  const inlineLinks = num(o?.inline_link_clicks);
  if (!counts.link_clicks) counts.link_clicks = inlineLinks;   // บางบัญชีไม่คืน action link_click

  let resultType = pickResultType(opts.goals, opts.objective);
  // เป้าหมายบอกว่านับ X แต่ X เป็นศูนย์ ขณะที่ชนิดอื่นมีเลข = ข้อมูลไม่สอดคล้อง
  // ปล่อยให้เป็นศูนย์ตามจริงดีกว่าเดาไปทางอื่น จะได้ตรงกับที่เห็นใน Ads Manager
  if (resultType && !(resultType in counts)) resultType = null;

  const resultValue = resultType ? counts[resultType] : null;
  const resultLabel = resultType ? RESULT_DEFS[resultType].label : null;

  return {
    spend,
    impressions: num(o?.impressions),
    reach: num(o?.reach),
    frequency: num(o?.frequency),
    clicks: num(o?.clicks),
    link_clicks: counts.link_clicks,
    ctr: num(o?.ctr),
    cpm: num(o?.cpm),
    cpc: num(o?.cpc),
    leads: counts.leads,
    cpl: counts.leads > 0 ? spend / counts.leads : null,
    conversations: counts.conversations,
    replies,
    reply_rate: counts.conversations > 0 ? replies / counts.conversations : null,
    page_likes: counts.page_likes,
    engagement: counts.engagement,
    video_views: counts.video_views,
    purchases: counts.purchases,
    landing_views: counts.landing_views,
    // คอลัมน์ "ผลลัพธ์" / "ต้นทุนต่อผลลัพธ์" ให้ backend ตัดสินที่เดียว หน้าเว็บแค่แสดง
    result_type: resultType,
    result_label: resultLabel,
    result_value: resultValue,
    result_cost: resultValue && resultValue > 0 ? spend / resultValue : null,
  };
}
