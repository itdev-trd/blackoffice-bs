// supabase/functions/block-customer/index.ts
// บล็อก/ปลดบล็อกแชทลูกค้า (สแปม) — ตั้ง blocked_at ผ่าน service role (client แก้เองไม่ได้ตาม RLS)
// body: { id: string, block: boolean, reason?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";

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

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || "").trim();
    const block = body?.block !== false;   // ค่าเริ่มต้น = บล็อก
    const reason = body?.reason ? String(body.reason).slice(0, 300) : null;
    if (!id) return json({ ok: false, error: "ไม่มีรหัสแชท" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // สิทธิ์ตอบแชทไม่ผูกกับเพจ — ใครเข้าหน้าตอบแชทได้ ก็ตอบได้ทุกเพจและทุก LINE OA
    const { data: row } = await admin.from("chat_customers").select("id, page_id").eq("id", id).maybeSingle();
    if (!row) return json({ ok: false, error: "ไม่พบแชทนี้" }, 404);

    const nowIso = new Date().toISOString();
    const patch = block
      ? { blocked_at: nowIso, blocked_by: auth.permission?.email || "unknown", blocked_reason: reason, unread: false, awaiting_reply: false, updated_at: nowIso }
      : { blocked_at: null, blocked_by: null, blocked_reason: null, updated_at: nowIso };
    const { error } = await admin.from("chat_customers").update(patch).eq("id", id);
    if (error) throw error;

    return json({ ok: true, id, blocked: block });
  } catch (err) {
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
