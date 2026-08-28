// Historical comment backfill is intentionally disabled.
// Ad comments are accepted only from Meta webhook events after a page is selected in Inbox.
import { authorizeRequest } from "../_shared/permissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "content-type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await authorizeRequest(req, { admin: true, setting: "synccfg", allowService: true });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  return json({
    ok: false,
    disabled: true,
    error: "ปิดการดึงคอมเมนต์ย้อนหลังแล้ว ระบบรับเฉพาะคอมเมนต์โฆษณาแบบเรียลไทม์จากเพจที่เลือกในหน้าตอบแชท",
  });
});
