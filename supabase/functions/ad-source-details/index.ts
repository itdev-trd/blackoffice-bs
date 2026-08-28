// supabase/functions/ad-source-details/index.ts
// รับ { ad_ids: string[] } → คืนรายละเอียดแอดแต่ละตัว: ชื่อแคมเปญ/ชุดโฆษณา/โฆษณา + รูป/วิดีโอ
import { getMetaToken } from "../_shared/meta.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { cacheGet, cacheSet } from "../_shared/meta-cache.ts";

const GRAPH = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)
const CACHE_TTL_MS = 10 * 60 * 1000;          // L1 ในหน่วยความจำ (ต่อ isolate)
const AD_SRC_TTL_MS = 24 * 60 * 60 * 1000;    // L2 ใน DB ข้ามเครื่อง/isolate — ชื่อแอด/ครีเอทีฟเปลี่ยนช้า
const adCache = new Map<string, { at: number; value: Record<string, unknown> }>();
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
async function gj(url: string) { const r = await fetch(url); return await r.json().catch(() => ({})); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const auth = await authorizeRequest(req, { tab: ["inbox", "chat"] });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const body = await req.json().catch(() => ({}));
    const adIds: string[] = Array.isArray(body?.ad_ids) ? body.ad_ids.map(String).filter(Boolean).slice(0, 20) : [];
    if (!adIds.length) return json({ ok: true, ads: [] });
    const token = await getMetaToken();
    if (!token) throw new Error("ยังไม่ได้ตั้งค่า Meta access token");
    const base = `https://graph.facebook.com/${GRAPH}`;

    const ads = await Promise.all(adIds.map(async (adId) => {
      try {
        const cached = adCache.get(adId);
        if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
        // L2: cache กลางใน DB (ข้ามเครื่อง/isolate) — แอดเดิมถูกเปิดซ้ำในหลายพันแชท/หลายเครื่อง
        const db = await cacheGet(`adsrc:${adId}`, AD_SRC_TTL_MS);
        if (db?.payload) { adCache.set(adId, { at: Date.now(), value: db.payload }); return db.payload; }
        const fields = "name,effective_status,adset{name},campaign{name},creative{id,thumbnail_url,image_url,video_id,object_type}";
        const a = await gj(`${base}/${adId}?fields=${encodeURIComponent(fields)}&access_token=${token}`);
        if (a?.error) return { ad_id: adId, error: a.error.message || "ดึงข้อมูลแอดไม่ได้" };
        const cr = a.creative || {};
        let media_type = cr.video_id ? "video" : "image";
        let media_url: string | null = cr.image_url || cr.thumbnail_url || null;
        let thumb_url: string | null = cr.thumbnail_url || cr.image_url || null;
        if (cr.video_id) {
          const v = await gj(`${base}/${cr.video_id}?fields=source,picture&access_token=${token}`);
          if (!v?.error) { media_url = v.source || media_url; thumb_url = v.picture || thumb_url; }
        }
        const value = {
          ad_id: adId,
          name: a.name || null,
          adset_name: a.adset?.name || null,
          campaign_name: a.campaign?.name || null,
          status: a.effective_status || null,
          media_type, media_url, thumb_url,
        };
        adCache.set(adId, { at: Date.now(), value });
        if (adCache.size > 200) adCache.delete(adCache.keys().next().value!);
        cacheSet(`adsrc:${adId}`, adId, "adsrc", "-", value).catch(() => {});   // เขียน L2 แบบไม่รอ
        return value;
      } catch (e) {
        return { ad_id: adId, error: String(e instanceof Error ? e.message : e) };
      }
    }));

    return json({ ok: true, ads });
  } catch (err) {
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 200);
  }
});
