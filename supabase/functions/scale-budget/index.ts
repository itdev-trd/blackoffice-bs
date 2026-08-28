// supabase/functions/scale-budget/index.ts
// เรียกจากเว็บแอปตอนแอดมินกด "อนุมัติเพิ่มงบ" บนการ์ดที่ scale_suggested = true
// นี่คือ gate เดียวที่อนุญาตให้เงินไหลออกเพิ่ม — ต้องมีคนกดอนุมัติเสมอ ไม่มีทางเรียกอัตโนมัติได้จากที่อื่น

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { authorizeRequest } from "../_shared/permissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH_VERSION = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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

    const { ad_content_id, approve } = await req.json();
    const { data: row, error: rowErr } = await supabaseAdmin
      .from("ad_content")
      .select("*")
      .eq("id", ad_content_id)
      .single();
    if (rowErr || !row) throw new Error("ไม่พบแถวนี้");

    if (!approve) {
      await supabaseAdmin
        .from("ad_content")
        .update({ scale_suggested: false, suggested_budget_thb: null })
        .eq("id", ad_content_id);
      return new Response(JSON.stringify({ ok: true, status: "skipped" }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const newBudget = row.suggested_budget_thb;
    if (!newBudget || !row.adset_id) throw new Error("ไม่มีค่างบที่เสนอ หรือไม่มี adset_id");
    const META_TOKEN = await getMetaToken();

    const resp = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${row.adset_id}?access_token=${META_TOKEN}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ daily_budget: newBudget * 100 }),
      }
    );
    const data = await resp.json();
    if (!resp.ok) throw new Error(`Meta API error: ${JSON.stringify(data)}`);

    await supabaseAdmin
      .from("ad_content")
      .update({
        daily_budget_thb: newBudget,
        scale_suggested: false,
        suggested_budget_thb: null,
        notes: `scaled up to ${newBudget} thb/day via approval on ${new Date().toISOString()}`,
      })
      .eq("id", ad_content_id);

    return new Response(JSON.stringify({ ok: true, status: "scaled", new_budget: newBudget }), {
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
