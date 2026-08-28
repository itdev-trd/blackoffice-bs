// supabase/functions/apply-ad-change/index.ts
// นำการเปลี่ยนแปลงที่ AI แนะนำ (หรือผู้ใช้สั่งเอง) ไปใช้กับ Meta — ทีละรายการที่ผู้ใช้กดอนุมัติเท่านั้น
// รองรับ action: pause | resume | set_budget | exclude_audience_network
// นี่เป็น gate เดียวที่แตะบัญชีจริง — ต้องมีการกดอนุมัติจาก UI เสมอ ไม่มีการเรียกอัตโนมัติ
//
// Secrets: META_ACCESS_TOKEN

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { authorizeRequest } from "../_shared/permissions.ts";

const GRAPH_VERSION = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ACTIONS = ["pause", "resume", "set_budget", "exclude_audience_network"];

async function metaPost(id: string, body: Record<string, unknown>, token: string) {
  const resp = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${id}?access_token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Meta API error: ${JSON.stringify(data)}`);
  return data;
}
async function metaGet(url: string) {
  const resp = await fetch(url);
  const data = await resp.json();
  if (data?.error) throw new Error(data.error.message || "Meta error");
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { admin: true, tab: "campaigns" });
    if (!auth.ok) {
      return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });
    }
    const token = await getMetaToken();
    if (!token) throw new Error("ยังไม่ได้ตั้งค่า Meta access token (ตั้งได้ในหน้าตั้งค่า)");

    const { action, target_type, target_id, value } = await req.json();
    if (!ALLOWED_ACTIONS.includes(action)) throw new Error("action ไม่ถูกต้อง");
    if (!target_id) throw new Error("ต้องส่ง target_id");

    if (action === "pause" || action === "resume") {
      // ใช้ได้กับ campaign / adset / ad
      const status = action === "pause" ? "PAUSED" : "ACTIVE";
      await metaPost(target_id, { status }, token);
      return new Response(JSON.stringify({ ok: true, applied: action, target_id, status }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    if (action === "set_budget") {
      const thb = Math.round(Number(value));
      if (!thb || thb <= 0) throw new Error("value (งบ/วัน เป็นบาท) ไม่ถูกต้อง");
      // ตั้งงบที่ระดับ adset (หน่วยเป็นสตางค์)
      await metaPost(target_id, { daily_budget: thb * 100 }, token);
      return new Response(JSON.stringify({ ok: true, applied: "set_budget", target_id, daily_budget_thb: thb }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    if (action === "exclude_audience_network") {
      // อ่าน targeting ปัจจุบันของ adset แล้วเอา audience_network ออก (ถ้าไม่มี publisher_platforms = ระบุใหม่เฉพาะที่ไม่ใช่ AN)
      const cur = await metaGet(`https://graph.facebook.com/${GRAPH_VERSION}/${target_id}?fields=targeting&access_token=${token}`);
      const targeting = cur?.targeting ?? {};
      const platforms: string[] = Array.isArray(targeting.publisher_platforms)
        ? targeting.publisher_platforms.filter((p: string) => p !== "audience_network")
        : ["facebook", "instagram", "messenger"];
      const newTargeting = { ...targeting, publisher_platforms: platforms.length ? platforms : ["facebook", "instagram"] };
      // ลบ audience_network_positions ออกด้วย ถ้ามี
      delete newTargeting.audience_network_positions;
      await metaPost(target_id, { targeting: newTargeting }, token);
      return new Response(JSON.stringify({ ok: true, applied: "exclude_audience_network", target_id, publisher_platforms: newTargeting.publisher_platforms }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    throw new Error("action ไม่รองรับ");
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
});
