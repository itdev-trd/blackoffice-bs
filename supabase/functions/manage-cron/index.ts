// supabase/functions/manage-cron/index.ts
// จัดการงานอัตโนมัติ (cron) ผ่านแอป (เฉพาะ admin) — list / save (เปิด-ปิด + ตั้งความถี่)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { errorResponse, readJsonBody } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { admin: true });
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { action, key, cron_expr, enabled } = await readJsonBody(req, 32 * 1024);

    if (action === "list") {
      const { data: cfg, error } = await admin.from("scheduled_jobs").select("*").order("label");
      if (error) throw error;
      let stateMap: Record<string, any> = {};
      try {
        const { data: state } = await admin.rpc("app_list_cron");
        for (const s of state ?? []) stateMap[s.jobname] = s;
      } catch { /* pg_cron อาจยังไม่เปิด */ }
      const rows = (cfg ?? []).map((c: any) => ({ ...c, ...(stateMap[c.jobname] || {}) }));
      return new Response(JSON.stringify({ ok: true, rows }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    if (action === "save") {
      if (!key) throw new Error("ต้องระบุ key");
      const { data: job } = await admin.from("scheduled_jobs").select("*").eq("key", key).maybeSingle();
      if (!job) throw new Error("ไม่พบงานนี้");
      const expr = String(cron_expr || job.cron_expr).trim();
      if (!/^[\d*/,\s-]{1,40}$/.test(expr)) throw new Error("รูปแบบความถี่ (cron) ไม่ถูกต้อง");
      const en = enabled !== false;
      await admin.from("scheduled_jobs").update({ cron_expr: expr, enabled: en, updated_at: new Date().toISOString() }).eq("key", key);
      // body ของแต่ละงานเก็บไว้ในตาราง (scheduled_jobs.body_json) — งานอย่าง "ดึงแชทล่าสุด" ต้องส่ง
      // {"job":"recent"} ถ้า hardcode '{}' ให้ทุกงาน การแก้ความถี่จาก UI จะเปลี่ยนงานนั้นเป็นซิงก์เต็มทันที
      // TradingView sync ต้องระบุ action=sync ชัดเจน เพราะคำขอจาก service role ที่ไม่มี action จะถูกตีความเป็นงาน expire
      const bodyRaw = String(job.body_json || "").trim() || (job.key === "tv_sync" ? '{"action":"sync"}' : "{}");
      // กัน SQL injection ผ่านค่าในตาราง: ต้องเป็น JSON object ล้วนและไม่มี quote เดี่ยว
      let body = "{}";
      try {
        const parsed = JSON.parse(bodyRaw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = JSON.stringify(parsed);
      } catch { body = "{}"; }
      if (body.includes("'")) body = "{}";
      const command = `select net.http_post(url:='${SUPABASE_URL}/functions/v1/${job.function_name}', headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ${SERVICE_KEY}'), body:='${body}'::jsonb);`;
      const { error } = await admin.rpc("app_set_cron", { p_jobname: job.jobname, p_schedule: expr, p_command: command, p_enabled: en });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    throw new Error("action ไม่ถูกต้อง");
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
