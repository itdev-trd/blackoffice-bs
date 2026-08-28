import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { getLineConfig, lineApi } from "../_shared/line.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });

async function inspect(token: string) {
  try {
    const bot = await lineApi("/v2/bot/info", token);
    return { valid: true, bot };
  } catch (error) {
    return { valid: false, error: String(error) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { admin: true, setting: "line" });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const body = await req.json().catch(() => ({}));
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (body.action === "status") {
      const cfg = await getLineConfig();
      if (!cfg.accessToken || !cfg.channelSecret) return json({ ok: true, configured: false });
      const info = await inspect(cfg.accessToken);
      return json({ ok: true, configured: true, ...info, webhook_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/line-webhook` });
    }
    const channelSecret = String(body.channel_secret || "").trim();
    const accessToken = String(body.access_token || "").trim();
    if (!channelSecret || !accessToken) throw new Error("กรุณากรอก Channel secret และ Channel access token ให้ครบ");
    const info = await inspect(accessToken);
    if (!info.valid) throw new Error(`Channel access token ใช้ไม่ได้: ${info.error}`);
    const now = new Date().toISOString();
    const { error } = await admin.from("app_secrets").upsert([
      { key: "line_channel_secret", value: channelSecret, updated_at: now },
      { key: "line_channel_access_token", value: accessToken, updated_at: now },
    ]);
    if (error) throw error;
    return json({ ok: true, saved: true, configured: true, ...info, webhook_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/line-webhook` });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
