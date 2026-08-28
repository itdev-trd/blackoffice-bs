// supabase/functions/snapshot-config/index.ts
// เก็บ snapshot การตั้งค่าปัจจุบันของ node (campaign/adset/ad) ลง ad_config_snapshots
// บันทึกเฉพาะเมื่อค่าเปลี่ยนจากเวอร์ชันล่าสุด (เทียบ hash) — เรียกตอนเปิดแดชบอร์ด
import { getMetaToken } from "../_shared/meta.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";

const GRAPH_VERSION = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha(s: string) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const budgetTHB = (v: unknown) => (v ? Math.round(parseFloat(String(v)) / 100) : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { admin: true, tab: "campaigns" });
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });

    const { node_id, level } = await req.json();
    if (!node_id || !level) throw new Error("ต้องส่ง node_id และ level");
    const token = await getMetaToken();
    if (!token) throw new Error("ยังไม่ได้ตั้งค่า Meta access token");
    const base = `https://graph.facebook.com/${GRAPH_VERSION}`;

    let config: any = {}; let summary = ""; let accountId: string | null = null;

    if (level === "adsets" || level === "adset") {
      const fields = "name,account_id,status,effective_status,optimization_goal,billing_event,bid_amount,daily_budget,lifetime_budget,targeting";
      const d = await (await fetch(`${base}/${node_id}?fields=${fields}&access_token=${token}`)).json();
      if (d?.error) throw new Error(d.error.message);
      accountId = d.account_id ?? null;
      const t = d.targeting || {};
      const interests = ([] as any[]).concat(...(t.flexible_spec || []).map((f: any) => f.interests || [])).map((i: any) => i.name).filter(Boolean);
      const geo = t.geo_locations || {};
      config = {
        name: d.name, status: d.effective_status || d.status,
        optimization_goal: d.optimization_goal, billing_event: d.billing_event,
        bid_amount: d.bid_amount ?? null,
        daily_budget_thb: budgetTHB(d.daily_budget), lifetime_budget_thb: budgetTHB(d.lifetime_budget),
        age: [t.age_min ?? null, t.age_max ?? null],
        genders: t.genders || null,
        locations: { countries: geo.countries || null, regions: (geo.regions || []).map((r: any) => r.name || r.key), cities: (geo.cities || []).map((c: any) => c.name || c.key) },
        interests,
        custom_audiences: (t.custom_audiences || []).map((a: any) => a.name || a.id),
        placements: t.publisher_platforms ? { platforms: t.publisher_platforms, facebook: t.facebook_positions || null, instagram: t.instagram_positions || null, devices: t.device_platforms || null } : "advantage_plus_auto",
      };
      const ageStr = config.age[0] ? `${config.age[0]}-${config.age[1] || "+"}` : "-";
      summary = `อายุ ${ageStr} · ${config.placements === "advantage_plus_auto" ? "จัดวางอัตโนมัติ" : "จัดวางเอง"} · งบ/วัน ${config.daily_budget_thb ?? "-"}฿ · ความสนใจ ${interests.length ? interests.slice(0, 3).join(", ") + (interests.length > 3 ? "…" : "") : "กว้าง"}`;
    } else if (level === "ads" || level === "ad") {
      const fields = "name,account_id,status,effective_status,creative{title,body,image_url,thumbnail_url,call_to_action_type,object_story_spec}";
      const d = await (await fetch(`${base}/${node_id}?fields=${fields}&access_token=${token}`)).json();
      if (d?.error) throw new Error(d.error.message);
      accountId = d.account_id ?? null;
      const cr = d.creative || {};
      const link = cr.object_story_spec?.link_data || {};
      config = {
        name: d.name, status: d.effective_status || d.status,
        headline: cr.title || link.name || null,
        body: cr.body || link.message || null,
        description: link.description || null,
        image_url: cr.image_url || cr.thumbnail_url || link.picture || null,
        cta: cr.call_to_action_type || link.call_to_action?.type || null,
        link: link.link || null,
      };
      summary = `${config.headline ? "หัวข้อ: " + config.headline + " · " : ""}${config.body ? String(config.body).slice(0, 60) : ""}`;
    } else {
      const d = await (await fetch(`${base}/${node_id}?fields=name,account_id,status,effective_status,objective,bid_strategy,daily_budget,lifetime_budget&access_token=${token}`)).json();
      if (d?.error) throw new Error(d.error.message);
      accountId = d.account_id ?? null;
      config = { name: d.name, status: d.effective_status || d.status, objective: d.objective, bid_strategy: d.bid_strategy, daily_budget_thb: budgetTHB(d.daily_budget), lifetime_budget_thb: budgetTHB(d.lifetime_budget) };
      summary = `${d.objective || ""}`;
    }

    const hash = await sha(JSON.stringify(config));
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: latest } = await admin.from("ad_config_snapshots").select("hash").eq("node_id", node_id).order("captured_at", { ascending: false }).limit(1).maybeSingle();

    let stored = false;
    if (!latest || latest.hash !== hash) {
      await admin.from("ad_config_snapshots").insert({ node_id, node_level: level, account_id: accountId, hash, config, summary });
      stored = true;
    }
    return new Response(JSON.stringify({ ok: true, stored }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err instanceof Error ? err.message : err) }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
});
