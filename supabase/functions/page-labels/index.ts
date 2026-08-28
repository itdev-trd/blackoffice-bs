// supabase/functions/page-labels/index.ts
// ทดสอบ/ดึง "ป้ายกำกับ" (custom labels) ของเพจจาก Meta Graph API
// body { page_id? } — ระบุเพจ (ไม่ใส่ = เพจแรก)
// คืน: รายชื่อป้าย (รวมชื่อซ้ำ) + ทดสอบดึงป้ายรายลูกค้า (reverse lookup) เพื่อยืนยันว่านับได้

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { getMetaPages } from "../_shared/meta-pages.ts";
import { authorizeRequest } from "../_shared/permissions.ts";

const GRAPH_VERSION = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function fetchJson(url: string) { const r = await fetch(url); return await r.json(); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));
    const onlyPage = body?.page_id ? String(body.page_id) : null;
    const auth = await authorizeRequest(req, { admin: true, setting: "synccfg", pageId: onlyPage });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const token = await getMetaToken();
    if (!token) throw new Error("ยังไม่ได้ตั้งค่า Meta access token (ตั้งได้ในหน้าตั้งค่า)");
    const base = `https://graph.facebook.com/${GRAPH_VERSION}`;
    const deadline = Date.now() + 120000;

    const pagesData = await getMetaPages(base, token);
    if (pagesData?.error) throw new Error(pagesData.error.message || "ดึงรายชื่อเพจไม่สำเร็จ");
    let pages = (pagesData?.data ?? []).filter((p: any) => p.access_token);
    if (onlyPage) pages = pages.filter((p: any) => p.id === onlyPage);
    else pages = pages.slice(0, 1);
    if (!pages.length) throw new Error("ไม่พบเพจ (เช็คสิทธิ์ token)");
    const page = pages[0];

    // 1) รายชื่อป้ายทั้งหมดของเพจ (รวมชื่อซ้ำเป็นรายการเดียว + นับจำนวน label object ต่อชื่อ + ธง ad_id)
    const lr = await fetchJson(`${base}/${page.id}/custom_labels?fields=page_label_name&limit=500&access_token=${page.access_token}`);
    const byName: Record<string, { name: string; objects: number; is_ad: boolean }> = {};
    for (const l of (lr?.data ?? [])) {
      const name = l.page_label_name || l.name || "(ไม่มีชื่อ)";
      const key = name;
      if (!byName[key]) byName[key] = { name, objects: 0, is_ad: /^ad_id\./i.test(name) };
      byName[key].objects++;
    }
    const labelNames = Object.values(byName).sort((a, b) => Number(b.is_ad) - Number(a.is_ad) || a.name.localeCompare(b.name));

    // 2) reverse lookup: ดึงป้ายของลูกค้าจริงสัก 8 คน (จากที่ซิงก์เก็บไว้) เพื่อยืนยันว่านับได้
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: custRows } = await admin.from("chat_customers").select("psid, customer_name").eq("page_id", page.id).not("psid", "is", null).limit(8);
    const sample: any[] = [];
    for (const c of custRows ?? []) {
      if (Date.now() > deadline) break;
      let names: string[] = [], err: string | null = null;
      try {
        const ur = await fetchJson(`${base}/${c.psid}/custom_labels?fields=page_label_name&limit=50&access_token=${page.access_token}`);
        if (ur?.error) err = ur.error.message || "อ่านป้ายรายคนไม่ได้";
        else names = (ur?.data ?? []).map((x: any) => x.page_label_name || x.name).filter(Boolean);
      } catch (e) { err = String(e instanceof Error ? e.message : e); }
      sample.push({ name: c.customer_name || c.psid, labels: names, error: err });
    }

    return json({ ok: true, page: page.name, page_id: page.id, label_names: labelNames, reverse_ok: sample.some((s) => !s.error), sample });
  } catch (err) {
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
