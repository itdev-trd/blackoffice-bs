// supabase/functions/clear-chat-customers/index.ts
// ลบข้อมูลลูกค้าจากแชทในตาราง chat_customers (ผ่าน service role เพราะ RLS ไม่เปิด delete ให้ client)
// body {}                = ลบทั้งหมด (ทุกเพจ)
// body { page_id: "..." } = ลบเฉพาะเพจนั้น
// ต้องเป็นผู้ใช้ที่ล็อกอินเท่านั้น (ตรวจ JWT จาก Authorization header)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));
    const pageId = body?.page_id ? String(body.page_id) : null;
    const auth = await authorizeRequest(req, { admin: true, setting: "chat", pageId });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    if (body?.confirm !== "DELETE_CHAT_CUSTOMERS") {
      return json({ ok: false, error: "ต้องยืนยันการลบด้วย confirm=DELETE_CHAT_CUSTOMERS" }, 400);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let del = admin.from("chat_customers").delete();
    del = pageId ? del.eq("page_id", pageId) : del.neq("id", "__never__"); // ไม่มี filter = ลบทั้งหมด
    const { data, error } = await del.select("id");
    if (error) throw error;

    return json({ ok: true, deleted: data?.length ?? 0, scope: pageId ? "page" : "all" });
  } catch (err) {
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
