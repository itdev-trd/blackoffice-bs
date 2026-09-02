// supabase/functions/detect-chat-origin/index.ts
// เติม "ประเทศ/ภาษา" ให้ลูกค้าที่ระบุจากข้อความไม่ได้ โดยใช้ประเทศเป้าหมายของแอดที่เขาทักเข้ามา
//
// ทำไมต้องมี: ลูกค้าจำนวนมากส่งมาแต่สติกเกอร์/รูป/พิมพ์ผิด ตรวจภาษาจากข้อความจึงล้ม
// แต่ถ้าเขาทักมาจากแอด เรารู้อยู่แล้วว่าแอดนั้นยิงไปประเทศไหน — ใช้เป็นหลักฐานแทนได้
//
// หลักการที่ยึด:
//   - เติมเฉพาะแถวที่ยังไม่มีประเทศ หรือมีแต่เป็น "ระบุไม่ได้" — ห้ามทับค่าที่แอดมิน/AI ระบุไว้แน่ชัด
//   - แอดที่ยิงหลายประเทศ = สรุปไม่ได้ ข้ามไป ดีกว่าเดาผิด
//   - ดึง targeting ทีละแอดที่ไม่ซ้ำ (ลูกค้า 100 คนจากแอดเดียว = ยิง Meta ครั้งเดียว)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";

const GRAPH_BASE = "https://graph.facebook.com/v22.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ค่าที่ถือว่า "ยังไม่รู้จริง" — ทับได้
const VAGUE = ["", "ไม่ทราบ", "ไม่พบข้อมูลประเทศ", "ภาษาอังกฤษ (ยังระบุประเทศไม่ได้)"];

// ประเทศเป้าหมายของแอด -> ชื่อไทย + ภาษาที่ใช้ตอบ (ให้ตรงกับที่ระบบแปลใช้อยู่)
const COUNTRY: Record<string, { name: string; lang: string }> = {
  TH: { name: "ประเทศไทย", lang: "Thai" },
  LA: { name: "ลาว", lang: "Lao" },
  KH: { name: "กัมพูชา", lang: "Khmer" },
  MM: { name: "เมียนมา", lang: "Burmese" },
  VN: { name: "เวียดนาม", lang: "Vietnamese" },
  MY: { name: "มาเลเซีย", lang: "Bahasa Malaysia" },
  ID: { name: "อินโดนีเซีย", lang: "Bahasa Indonesia" },
  PH: { name: "ฟิลิปปินส์", lang: "Tagalog" },
  SG: { name: "สิงคโปร์", lang: "English" },
  TW: { name: "ไต้หวัน", lang: "Chinese" },
  HK: { name: "ฮ่องกง", lang: "Chinese" },
  CN: { name: "จีน", lang: "Chinese" },
  IN: { name: "อินเดีย", lang: "English" },
  AU: { name: "ออสเตรเลีย", lang: "English" },
  GB: { name: "สหราชอาณาจักร", lang: "English" },
  US: { name: "สหรัฐอเมริกา", lang: "English" },
};

async function fetchJson(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  return await r.json().catch(() => ({}));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

  try {
    const body = await readJsonBody(req, 32 * 1024);
    const dryRun = body?.dry_run === true;
    const auth = await authorizeRequest(req, { admin: true, setting: "synccfg", allowService: true });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const token = await getMetaToken();
    if (!token) return json({ ok: false, error: "ยังไม่ได้ตั้งค่า Meta access token" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // แถวที่ต้องช่วย: มาจากแอด + ยังไม่รู้ประเทศจริง
    const { data: rows, error: qErr } = await admin
      .from("chat_customers")
      .select("id, entry_ad_id, country, cust_lang")
      .not("entry_ad_id", "is", null)
      .neq("entry_ad_id", "")
      .or(VAGUE.map((v) => (v === "" ? "country.is.null" : `country.eq.${v}`)).join(","))
      .limit(2000);
    if (qErr) return json({ ok: false, error: qErr.message }, 500);

    const targets = rows ?? [];
    if (targets.length === 0) return json({ ok: true, candidates: 0, updated: 0, ads_checked: 0, note: "ไม่มีแถวที่ต้องเติม" });

    // ยิง Meta ทีละแอดที่ไม่ซ้ำเท่านั้น
    const adIds = [...new Set(targets.map((r) => String(r.entry_ad_id)))];
    const adCountry: Record<string, { name: string; lang: string } | null> = {};
    let adsChecked = 0;
    const skipped: Record<string, string> = {};

    for (const adId of adIds) {
      const res = await fetchJson(
        `${GRAPH_BASE}/${adId}?fields=adset{targeting{geo_locations}}&access_token=${token}`
      );
      adsChecked++;
      if (res?.error) { adCountry[adId] = null; skipped[adId] = res.error.message || "อ่าน targeting ไม่ได้"; continue; }
      const geo = res?.adset?.targeting?.geo_locations ?? {};
      // รวมทุกแหล่งที่บอกประเทศได้ (countries ตรงๆ / เมืองหรือภูมิภาคที่มี country ติดมา)
      const codes = new Set<string>();
      for (const c of geo.countries ?? []) codes.add(String(c).toUpperCase());
      for (const g of [...(geo.cities ?? []), ...(geo.regions ?? []), ...(geo.zips ?? [])]) {
        if (g?.country) codes.add(String(g.country).toUpperCase());
      }
      // ยิงหลายประเทศ = ไม่รู้ว่าลูกค้าคนนี้มาจากอันไหน ข้ามดีกว่าเดา
      if (codes.size !== 1) {
        adCountry[adId] = null;
        skipped[adId] = codes.size === 0 ? "แอดไม่ระบุประเทศ" : `แอดยิง ${codes.size} ประเทศ สรุปไม่ได้`;
        continue;
      }
      const code = [...codes][0];
      adCountry[adId] = COUNTRY[code] ?? { name: code, lang: "English" };
    }

    // เขียนกลับ — จัดกลุ่มตามแอดเพื่อ update ทีเดียวต่อแอด ไม่วน update รายคน
    let updated = 0;
    const byResult: Record<string, number> = {};
    for (const adId of adIds) {
      const hit = adCountry[adId];
      if (!hit) continue;
      const ids = targets.filter((r) => String(r.entry_ad_id) === adId).map((r) => r.id);
      if (ids.length === 0) continue;
      byResult[hit.name] = (byResult[hit.name] || 0) + ids.length;
      if (dryRun) { updated += ids.length; continue; }
      const { error: uErr } = await admin
        .from("chat_customers")
        .update({ country: hit.name, cust_lang: hit.lang, country_source: "ad_targeting", updated_at: new Date().toISOString() })
        .in("id", ids);
      if (!uErr) updated += ids.length;
    }

    return json({
      ok: true,
      dry_run: dryRun,
      candidates: targets.length,
      ads_checked: adsChecked,
      updated,
      by_country: byResult,
      skipped_ads: skipped,
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
