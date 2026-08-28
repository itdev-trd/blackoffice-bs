import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authorizeRequest } from "../_shared/permissions.ts";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

function allowedImageUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return null;
    if (!(host === "facebook.com" || host.endsWith(".facebook.com") || host === "fbcdn.net" || host.endsWith(".fbcdn.net"))) return null;
    return url;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = await authorizeRequest(req, { tab: "analyze" });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const body = await req.json().catch(() => ({}));
    const url = allowedImageUrl(String(body?.url || ""));
    if (!url) return json({ ok: false, error: "URL รูปไม่ถูกต้อง" }, 400);
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) return json({ ok: false, error: `โหลดรูปไม่สำเร็จ (${response.status})` }, 400);
    const contentType = String(response.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!contentType.startsWith("image/")) return json({ ok: false, error: "ไฟล์ที่ได้ไม่ใช่รูปภาพ" }, 400);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 5 * 1024 * 1024) return json({ ok: false, error: "รูปใหญ่เกิน 5MB" }, 400);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return json({ ok: true, content_type: contentType, base64: btoa(binary) });
  } catch (error) {
    return json({ ok: false, error: String(error instanceof Error ? error.message : error) }, 500);
  }
});
