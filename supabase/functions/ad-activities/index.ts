// supabase/functions/ad-activities/index.ts
// ดึงประวัติการเปลี่ยนแปลง (change history) ของ node (campaign/adset/ad) ในช่วงวันที่กำหนด
// ใช้ Meta activities API (ระดับบัญชี) แล้วกรองเฉพาะ object_id = node
import { getMetaToken } from "../_shared/meta.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { canAccessMetaNodes } from "../_shared/meta-authorization.ts";

const GRAPH_VERSION = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { node_id, since, until } = await req.json();
    if (!node_id) throw new Error("ต้องส่ง node_id");
    const auth = await authorizeRequest(req, { tab: ["campaigns", "analyze"] });
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });
    const token = await getMetaToken();
    if (!token) throw new Error("ยังไม่ได้ตั้งค่า Meta access token");
    if (auth.permission && !(await canAccessMetaNodes(auth.permission, token, [node_id], GRAPH_VERSION))) {
      return new Response(JSON.stringify({ ok: false, error: "ไม่มีสิทธิ์เข้าถึงบัญชีโฆษณานี้" }), { status: 403, headers: { ...corsHeaders, "content-type": "application/json" } });
    }
    const base = `https://graph.facebook.com/${GRAPH_VERSION}`;

    // หา account id ของ node
    const meta = await (await fetch(`${base}/${node_id}?fields=account_id&access_token=${token}`)).json();
    if (meta?.error) throw new Error(meta.error.message || "อ่าน account_id ไม่ได้");
    const acct = meta.account_id ? `act_${String(meta.account_id).replace(/^act_/, "")}` : null;
    if (!acct) throw new Error("ไม่พบบัญชีของ node นี้");

    const range = since && until ? `&since=${since}&until=${until}` : "";
    const fields = "event_type,translated_event_type,event_time,actor_name,object_id,object_type,extra_data";
    const url = `${base}/${acct}/activities?fields=${fields}&limit=300${range}&access_token=${token}`;
    const data = await (await fetch(url)).json();
    if (data?.error) throw new Error(data.error.message || "ดึงประวัติไม่สำเร็จ (ต้องมีสิทธิ์ ads_read)");

    const events = (data?.data ?? [])
      .filter((e: any) => String(e.object_id) === String(node_id))
      .map((e: any) => {
        let extra: any = null;
        try { extra = e.extra_data ? JSON.parse(e.extra_data) : null; } catch { extra = e.extra_data ?? null; }
        return {
          time: e.event_time,
          type: e.event_type,
          label: e.translated_event_type || e.event_type,
          actor: e.actor_name || null,
          old_value: extra?.old_value ?? null,
          new_value: extra?.new_value ?? null,
        };
      });

    return new Response(JSON.stringify({ ok: true, events }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err instanceof Error ? err.message : err) }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
});
