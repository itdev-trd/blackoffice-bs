// supabase/functions/prefetch-insights/index.ts
// ดึงรีพอร์ต ads ล่วงหน้ามาเก็บ shared cache (ตามที่ตั้งใน settings.insights_prefetch)
//   seed: สร้างคิวงานจาก targets × ranges (เรียกจาก cron ตี 1)  · drain: ทยอยดึงทีละก้อน (cron ทุก ~15 นาที)
//   ทยอยดึง + เช็ค rate guard — ใกล้เต็มก็พัก ค้างคิวไว้ทำต่อรอบหน้า
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { getMetaBackgroundGuard } from "../_shared/meta-rate.ts";

const STATE_KEY = "insights_prefetch_state";
const BATCH = 8;                 // จำนวนงานต่อรอบ (แต่ละงาน = ad-insights 1 ครั้ง ~6 Meta call)
const DELAY_MS = 400;            // หน่วงระหว่างงาน กันยิงรัว
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rangeBody = (r: any) => typeof r === "string" ? { date_preset: r } : (r?.since && r?.until ? { time_range: { since: r.since, until: r.until } } : { date_preset: "last_30d" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const auth = await authorizeRequest(req, { admin: true, allowService: true });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const body = await req.json().catch(() => ({}));
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: cfgRow } = await admin.from("settings").select("value").eq("key", "insights_prefetch").maybeSingle();
    const cfg: any = cfgRow?.value || {};
    if (cfg.enabled !== true) return json({ ok: true, skipped: "ปิดอยู่" });

    const { data: stRow } = await admin.from("settings").select("value").eq("key", STATE_KEY).maybeSingle();
    const state: any = stRow?.value || {};
    let queue: any[] = Array.isArray(state.queue) ? state.queue : [];

    // seed: สร้างคิวใหม่จาก targets × ranges (เรียกจาก cron ตี 1 หรือกดเอง body.seed=true)
    if (body?.seed === true) {
      const targets: any[] = Array.isArray(cfg.targets) ? cfg.targets : [];
      const ranges: any[] = Array.isArray(cfg.ranges) && cfg.ranges.length ? cfg.ranges : ["yesterday"];
      queue = [];
      for (const t of targets) for (const r of ranges) queue.push({ node_id: String(t.id), level: t.level || "ad", range: r });
      await admin.from("settings").upsert({ key: STATE_KEY, value: { queue, seeded_at: new Date().toISOString(), total: queue.length }, updated_at: new Date().toISOString() });
    }

    if (!queue.length) return json({ ok: true, done: true, remaining: 0 });

    // เช็ค rate guard ก่อน — ใกล้เต็มก็พัก ไม่ดึงรอบนี้
    const guard = await getMetaBackgroundGuard(admin);
    if (guard.blocked) return json({ ok: true, paused: "rate_guard", until: guard.until, remaining: queue.length });

    const sb = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let done = 0;
    const errors: string[] = [];
    while (queue.length && done < BATCH) {
      // ระหว่างทำก็เช็ค guard ซ้ำ — ถ้าใกล้เต็มระหว่างรอบให้หยุด
      if ((await getMetaBackgroundGuard(admin)).blocked) break;
      const item = queue.shift();
      try {
        const resp = await fetch(`${sb}/functions/v1/ad-insights`, {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${svc}` },
          body: JSON.stringify({ ad_id: item.node_id, level: item.level, ...rangeBody(item.range), force: true }),
        });
        const r = await resp.json().catch(() => ({}));
        if (!r?.ok) errors.push(`${item.node_id}: ${r?.error || resp.status}`);
      } catch (e) {
        errors.push(`${item.node_id}: ${String(e instanceof Error ? e.message : e)}`);
      }
      done++;
      if (queue.length) await sleep(DELAY_MS);
    }

    await admin.from("settings").upsert({ key: STATE_KEY, value: { ...state, queue, last_run: new Date().toISOString(), total: state.total ?? undefined }, updated_at: new Date().toISOString() });
    return json({ ok: true, processed: done, remaining: queue.length, errors: errors.slice(0, 5) });
  } catch (err) {
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
