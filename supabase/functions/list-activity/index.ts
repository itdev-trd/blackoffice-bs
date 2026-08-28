// supabase/functions/list-activity/index.ts
// ดูประวัติการเข้าใช้งาน (เฉพาะ admin) + สรุปว่าใครใช้งานอยู่ (active ใน 15 นาทีล่าสุด)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { admin: true });
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });

    const body = await readJsonBody(req, 32 * 1024);
    const limit = Math.min(500, Math.max(20, Number(body?.limit) || 200));

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const emailFilter = body?.email ? String(body.email) : null; // เจาะดูราย user
    // ประวัติ: ไม่เอา heartbeat (สัญญาณชีพเงียบๆ ไว้นับเครื่องออนไลน์ ไม่ใช่กิจกรรมจริง)
    let hq = admin
      .from("activity_log")
      .select("id, email, event, detail, ip, location, device, created_at")
      .neq("event", "heartbeat")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (emailFilter) hq = hq.eq("email", emailFilter);
    const { data: rows, error } = await hq;
    if (error) throw error;

    // กำลังใช้งานอยู่ = มีกิจกรรม (รวม heartbeat) ภายใน 15 นาที — นับแยก "ต่อเครื่อง" (email + device_id)
    const cutoffIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: recent } = await admin
      .from("activity_log")
      .select("email, device_id, device, location, ip, created_at")
      .gte("created_at", cutoffIso)
      .neq("event", "logout")
      .order("created_at", { ascending: false })
      .limit(1000);
    const seen = new Set<string>();
    const devices: any[] = [];
    for (const r of recent ?? []) {
      if (!r.email) continue;
      const key = `${r.email}|${r.device_id || r.device || "?"}`; // แถวเก่าไม่มี device_id → ใช้ชนิดอุปกรณ์แทน
      if (seen.has(key)) continue;
      seen.add(key);
      devices.push({ email: r.email, last: r.created_at, device: r.device, location: r.location, ip: r.ip });
    }
    // จัดกลุ่มต่ออีเมล → { email, devices: [...] } เพื่อโชว์ "เมลนี้ออนไลน์กี่เครื่อง"
    const byEmail: Record<string, any[]> = {};
    for (const d of devices) (byEmail[d.email] = byEmail[d.email] || []).push(d);
    const active = Object.entries(byEmail).map(([email, devs]) => ({
      email, device_count: devs.length, devices: devs,
      last: devs[0].last, device: devs[0].device, location: devs[0].location, ip: devs[0].ip, // เผื่อ UI เดิม
    }));

    return new Response(JSON.stringify({ ok: true, rows: rows ?? [], active }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err instanceof Error ? err.message : err) }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
});
