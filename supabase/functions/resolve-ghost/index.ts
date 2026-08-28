// supabase/functions/resolve-ghost/index.ts
// เรียกจากเว็บแอปเมื่อแอดมินตัดสินแอดที่ถูกปักธง "แชทผี" (ghost_flagged = true)
//   action "pause"   -> หยุดแอดบน Meta จริง แล้วเคลียร์ธง (ยืนยันว่าเป็นแชทผีจริง)
//   action "dismiss" -> คงแอดไว้ เคลียร์ธงเฉยๆ (ไม่ใช่แชทผี / ยอมรับได้)
// นี่คือ gate ของโหมด "alert" — ระบบจะไม่หยุดแอดเองจนกว่าแอดมินจะกดยืนยันที่นี่

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { authorizeRequest } from "../_shared/permissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH_VERSION = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const auth = await authorizeRequest(req, { admin: true, tab: "campaigns" });
    if (!auth.ok) {
      return new Response(JSON.stringify({ ok: false, error: auth.error }), {
        status: auth.status,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const { ad_content_id, action } = await req.json();
    if (!ad_content_id) throw new Error("ต้องส่ง ad_content_id");

    const { data: row, error: rowErr } = await supabaseAdmin
      .from("ad_content")
      .select("*")
      .eq("id", ad_content_id)
      .single();
    if (rowErr || !row) throw new Error("ไม่พบแอดนี้");

    if (action === "pause") {
      if (!row.ad_id) throw new Error("แอดนี้ไม่มี ad_id ให้หยุด");
      const META_TOKEN = await getMetaToken();
      const resp = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${row.ad_id}?access_token=${META_TOKEN}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "PAUSED" }) }
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(`Meta API error: ${JSON.stringify(data)}`);

      await supabaseAdmin
        .from("ad_content")
        .update({
          status: "paused_auto",
          ghost_flagged: false,
          notes: `หยุดเพราะยืนยันว่าเป็นแชทผี (${row.ghost_reason ?? "manual"}) เมื่อ ${new Date().toISOString()}`,
        })
        .eq("id", ad_content_id);

      return new Response(JSON.stringify({ ok: true, status: "paused" }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    // dismiss = ไม่ใช่แชทผี คงแอดไว้ เคลียร์ธง
    await supabaseAdmin
      .from("ad_content")
      .update({ ghost_flagged: false, ghost_reason: null })
      .eq("id", ad_content_id);

    return new Response(JSON.stringify({ ok: true, status: "dismissed" }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
