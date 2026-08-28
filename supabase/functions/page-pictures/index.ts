// supabase/functions/page-pictures/index.ts
// คืนรูปโปรไฟล์เพจเป็น map { page_id: url } ให้หน้าเว็บใช้
// แนวคิด: ดึงรูปจาก Meta "ครั้งเดียว" → อัปขึ้น Supabase Storage (bucket page-logos) → บันทึก URL ลง page_lead_config
//   หลังจากนั้นใช้ URL จาก DB/Storage ตลอด ไม่ต้องยิง Meta อีก (เสถียร ไม่หลุดเหมือน endpoint สาธารณะของ Meta)
//   รีเฟรชอัตโนมัติเมื่อเกิน REFRESH_DAYS วัน
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { getMetaPages } from "../_shared/meta-pages.ts";
import { authorizeRequest } from "../_shared/permissions.ts";

const GRAPH_BASE = "https://graph.facebook.com/v22.0";
const BUCKET = "page-logos";
const REFRESH_DAYS = 30;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const auth = await authorizeRequest(req, { tab: ["inbox", "chat"] });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const force = (await req.json().catch(() => ({})))?.force === true;

    // ค่าที่มีอยู่แล้วใน DB (ใช้ได้ทันที + เช็คว่าต้องรีเฟรชไหม)
    const { data: cfgRows } = await admin.from("page_lead_config").select("page_id, picture_url, picture_updated_at");
    const stored: Record<string, { url: string | null; at: string | null }> = {};
    for (const r of cfgRows ?? []) stored[String(r.page_id)] = { url: r.picture_url ?? null, at: r.picture_updated_at ?? null };

    const pics: Record<string, string> = {};
    for (const [pid, v] of Object.entries(stored)) if (v.url) pics[pid] = v.url;   // เริ่มจากที่เก็บไว้แล้ว

    // เพจไหนยังไม่มีรูปเก็บไว้ / เก่าเกิน REFRESH_DAYS → ดึงจาก Meta มาเก็บใหม่
    const token = await getMetaToken();
    if (token) {
      const pd = await getMetaPages(GRAPH_BASE, token, {});
      const staleMs = REFRESH_DAYS * 24 * 60 * 60 * 1000;
      for (const p of (pd?.data ?? [])) {
        const pid = String(p?.id || "");
        if (!pid) continue;
        const cur = stored[pid];
        const fresh = cur?.url && cur?.at && (Date.now() - new Date(cur.at).getTime()) < staleMs;
        if (fresh && !force) continue;   // มีรูปแล้วและยังไม่เก่า = ข้าม

        // แหล่งรูป: จาก field picture ของ /me/accounts ก่อน ไม่มีค่อยใช้ graph endpoint (ตามด้วย token)
        const srcUrl = p?.picture?.data?.url || `${GRAPH_BASE}/${pid}/picture?type=square&width=160&height=160&access_token=${token}`;
        try {
          const imgResp = await fetch(srcUrl);
          if (!imgResp.ok) continue;
          const bytes = new Uint8Array(await imgResp.arrayBuffer());
          if (!bytes.length) continue;
          const contentType = imgResp.headers.get("content-type") || "image/jpeg";
          const path = `${pid}.jpg`;
          const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
          if (up.error) continue;
          const pub = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
          // ใส่ ?v=timestamp กัน cache ค้างเมื่อรูปอัปเดต
          const finalUrl = `${pub}?v=${Date.now()}`;
          await admin.from("page_lead_config").update({ picture_url: finalUrl, picture_updated_at: new Date().toISOString() }).eq("page_id", pid);
          pics[pid] = finalUrl;
        } catch { /* เพจนี้ดึงรูปไม่ได้ก็ข้าม ใช้ของเดิม/ตัวย่อแทน */ }
      }
    }

    return json({ ok: true, pictures: pics });
  } catch (err) {
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 200);
  }
});
