// AI วิเคราะห์ฐานข้อมูลลูกค้าถูกยกเลิกแล้ว
// คง endpoint แบบ no-op ชั่วคราว เพื่อให้ cron/ไคลเอนต์เวอร์ชันเก่าไม่ล้มและไม่เขียนข้อมูลลูกค้า
import { authorizeRequest } from "../_shared/permissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
  const auth = await authorizeRequest(req, { admin: true, setting: "synccfg", allowService: true });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  return json({ ok: true, disabled: true, processed: 0, message: "AI customer database classification is disabled" });
});
