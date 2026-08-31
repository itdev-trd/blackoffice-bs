import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type LineConfig = { channelSecret: string; accessToken: string };

export async function getLineConfig(): Promise<LineConfig> {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data } = await admin.from("app_secrets").select("key,value").in("key", ["line_channel_secret", "line_channel_access_token"]);
  const values = new Map((data || []).map((r: any) => [String(r.key), String(r.value || "")]));
  return {
    channelSecret: values.get("line_channel_secret") || Deno.env.get("LINE_CHANNEL_SECRET") || "",
    accessToken: values.get("line_channel_access_token") || Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") || "",
  };
}

export async function lineApi(path: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.line.me${path}`, {
    ...init,
    signal: init.signal || AbortSignal.timeout(12_000),
    headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`LINE API ${response.status} ${path}: ${data?.message || JSON.stringify(data)}`);
  return data;
}
