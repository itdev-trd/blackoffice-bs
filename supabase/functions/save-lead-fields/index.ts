// supabase/functions/save-lead-fields/index.ts
// แอดมินป้อนข้อมูลลูกค้าเองจากหน้าตอบแชท → บันทึกลง chat_customers + มาร์ค manual_data (ล็อกไม่ให้ AI แก้)
// body: { id, trade_id?, username?, phone?, email? }  (ค่าว่าง = ล้างค่า)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const clean = (v: unknown) => { const s = String(v ?? "").trim(); return s ? s.slice(0, 200) : null; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const auth = await authorizeRequest(req, { tab: ["inbox", "chat"] });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || "").trim();
    if (!id) return json({ ok: false, error: "ไม่มีรหัสแชท" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: row } = await admin.from("chat_customers").select("id, page_id, psid, source, entry_ad_id").eq("id", id).maybeSingle();
    if (!row) return json({ ok: false, error: "ไม่พบแชทนี้" }, 404);
    // สิทธิ์ตอบแชทไม่ผูกกับเพจ — ใครเข้าหน้าตอบแชทได้ ก็ตอบได้ทุกเพจและทุก LINE OA

    // DM ที่แอดมินเริ่มจากคอมเมนต์ Ads อาจได้ entry_ad_id แล้ว แต่ source เดิมยังเป็น null
    // ตรวจ referral ฝั่ง server ก่อนบันทึก เพื่อไม่เชื่อ ad id ที่ส่งมาจาก client
    if (body?.action === "mark_ad_source") {
      let entryAdId = clean(row.entry_ad_id);
      if (!entryAdId && row.psid) {
        const { data: referral } = await admin.from("chat_referrals").select("ad_id")
          .eq("page_id", row.page_id).eq("psid", row.psid).not("ad_id", "is", null)
          .order("received_at", { ascending: false }).limit(1).maybeSingle();
        entryAdId = clean(referral?.ad_id);
      }
      if (!entryAdId) return json({ ok: false, error: "ไม่พบข้อมูลโฆษณาที่ตรวจสอบได้" }, 400);
      const nowIso = new Date().toISOString();
      const { error } = await admin.from("chat_customers").update({ source: "ad", entry_ad_id: entryAdId, updated_at: nowIso }).eq("id", id);
      if (error) throw error;
      return json({ ok: true, id, source: "ad", entry_ad_id: entryAdId });
    }

    // เก็บชื่อโฆษณาที่หน้าตอบแชท resolve ได้ (ad_id -> ad name) ไว้แสดงในหน้าฐานข้อมูล
    if (body?.action === "save_ad_name") {
      const adName = clean(body?.ad_name);
      const adId = clean(body?.ad_id);
      const nowIso = new Date().toISOString();
      const patch: Record<string, unknown> = { updated_at: nowIso };
      if (adName) patch.entry_ad_name = adName;
      if (adId && !clean(row.entry_ad_id)) { patch.entry_ad_id = adId; patch.source = "ad"; }
      const { error } = await admin.from("chat_customers").update(patch).eq("id", id);
      if (error) throw error;
      return json({ ok: true, id, entry_ad_name: adName || null });
    }

    const nowIso = new Date().toISOString();
    const trade_id = clean(body?.trade_id);
    const username = clean(body?.username);
    const phone = clean(body?.phone);
    const email = clean(body?.email)?.toLowerCase() ?? null;
    const by = auth.permission?.email || "unknown";

    const patch: Record<string, unknown> = {
      trade_id, username, phone, email,
      manual_data: true, manual_data_by: by, manual_data_at: nowIso,
      // แอดมินยืนยันข้อมูลเอง = ปิดคิว AI (ไม่ต้องจัด/ตรวจซ้ำข้อมูลชุดนี้)
      classified_by: "manual", needs_ai: false, needs_verify: false,
      updated_at: nowIso,
    };
    const { error } = await admin.from("chat_customers").update(patch).eq("id", id);
    if (error) throw error;

    return json({ ok: true, id, trade_id, username, phone, email, manual_data_by: by, manual_data_at: nowIso });
  } catch (err) {
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
