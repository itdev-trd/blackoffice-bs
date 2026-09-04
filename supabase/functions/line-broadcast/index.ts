import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { getLineConfig, lineApi } from "../_shared/line.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MAX_TEXT_LENGTH = 5000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });

function messageFor(text: string) {
  return { messages: [{ type: "text", text }] };
}

async function writeActivity(email: string | undefined, status: string, detail: Record<string, unknown>) {
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await admin.from("activity_log").insert({ email, event: "line.broadcast", detail: { status, ...detail } });
  } catch (error) {
    console.error("Unable to write broadcast activity", error);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { admin: true, setting: "line" });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "status");
    const cfg = await getLineConfig();
    if (!cfg.accessToken) return json({ ok: true, configured: false, error: "ยังไม่ได้ตั้งค่า Channel access token" });

    if (action === "status") {
      const bot = await lineApi("/v2/bot/info", cfg.accessToken);
      return json({ ok: true, configured: true, bot });
    }

    const text = String(body?.text || "").trim();
    if (!text) return json({ ok: false, error: "กรุณาระบุข้อความ" }, 400);
    if (text.length > MAX_TEXT_LENGTH) return json({ ok: false, error: `ข้อความยาวเกิน ${MAX_TEXT_LENGTH} ตัวอักษร` }, 400);

    const payload = messageFor(text);
    await lineApi("/v2/bot/message/validate/broadcast", cfg.accessToken, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (action === "validate") return json({ ok: true, validated: true });
    if (action !== "send") return json({ ok: false, error: "ไม่รู้จักคำสั่งนี้" }, 400);

    const result = await lineApi("/v2/bot/message/broadcast", cfg.accessToken, { method: "POST", headers: { "content-type": "application/json", "X-Line-Retry-Key": crypto.randomUUID() }, body: JSON.stringify(payload) });
    await writeActivity(auth.user?.email, "sent", { length: text.length, preview: text.slice(0, 120) });
    return json({ ok: true, sent: true, result });
  } catch (error) {
    console.error(error);
    await writeActivity(undefined, "failed", { error: error instanceof Error ? error.message : String(error) });
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
