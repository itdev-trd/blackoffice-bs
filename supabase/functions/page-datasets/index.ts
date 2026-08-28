// supabase/functions/page-datasets/index.ts
// ดึง (หรือสร้าง) Dataset ID ของ Conversion Leads ให้ทุกเพจ แล้วเก็บลง page_lead_config.dataset_id
//
// อ้างอิงเอกสาร Meta (Conversions API for Business Messaging):
//   POST /{PAGE_ID}/dataset  → คืน dataset_id ที่ผูกกับเพจนั้น
//   ถ้าเพจนั้นมี dataset อยู่แล้ว จะคืนตัวเดิม (ไม่สร้างซ้ำ) — เรียกซ้ำได้ปลอดภัย
//   ข้อกำหนด: 1 เพจ ผูกได้กับ 1 dataset เท่านั้น
//
// ต้องมีสิทธิ์ page_events บน token (ถ้ามี pages_messaging ระดับสูงอยู่แล้ว Meta จะอนุมัติให้อัตโนมัติเมื่อขอ)
//
// body {}              → ทำทุกเพจที่เปิด sync
// body { page_id }     → ทำเพจเดียว
// deploy: supabase functions deploy page-datasets

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { getMetaPages } from "../_shared/meta-pages.ts";
import { authorizeRequest } from "../_shared/permissions.ts";

const GRAPH_VERSION = "v22.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const base = `https://graph.facebook.com/${GRAPH_VERSION}`;

    const pagesData = await getMetaPages(base, token, { mustIncludePageId: onlyPage || undefined });
    if (pagesData?.error) throw new Error(pagesData.error.message || "ดึงรายชื่อเพจไม่สำเร็จ");
    let pages = (pagesData?.data ?? []).filter((p: any) => p.access_token);
    if (onlyPage) pages = pages.filter((p: any) => p.id === onlyPage);
    if (!pages.length) throw new Error("ไม่พบเพจ (เช็คสิทธิ์ token)");

    const results: any[] = [];
    let okCount = 0;
    for (const p of pages) {
      try {
        // POST คืน dataset เดิมถ้ามีอยู่แล้ว — ไม่สร้างซ้ำ
        const r = await fetch(`${base}/${p.id}/dataset?access_token=${encodeURIComponent(token)}`, { method: "POST" });
        const j = await r.json().catch(() => ({}));
        const dsId = j?.id ? String(j.id) : null;
        if (dsId) {
          await admin.from("page_lead_config").upsert(
            { page_id: p.id, page_name: p.name, dataset_id: dsId, updated_at: new Date().toISOString() },
            { onConflict: "page_id" },
          );
          okCount++;
          results.push({ page: p.name, page_id: p.id, dataset_id: dsId, ok: true });
        } else {
          const msg = j?.error?.error_user_msg || j?.error?.message || "ไม่ได้ dataset id กลับมา";
          // code 200/10/294 = สิทธิ์ไม่พอ (มัก = ยังไม่ได้ page_events)
          const perm = /permission|page_events|access/i.test(String(msg));
          results.push({ page: p.name, page_id: p.id, ok: false, error: perm ? `${msg} (น่าจะยังไม่มีสิทธิ์ page_events)` : msg });
        }
      } catch (e) {
        results.push({ page: p.name, page_id: p.id, ok: false, error: String(e instanceof Error ? e.message : e) });
      }
    }

    const failed = results.filter((r) => !r.ok);
    return json({
      ok: true,
      total: results.length,
      success: okCount,
      failed: failed.length,
      results,
      hint: failed.length && failed.every((f) => /page_events|permission/i.test(String(f.error)))
        ? "ทุกเพจติดเรื่องสิทธิ์ — ต้องขอ page_events (Advanced Access) ในหน้าแอปที่ developers.facebook.com → สิทธิ์การอนุญาตและฟีเจอร์"
        : null,
    });
  } catch (err) {
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) });
  }
});
