// supabase/functions/push-lead-status/index.ts
// ส่งสถานะลูกค้า (ที่โมเดลใหญ่ตรวจซ้ำแล้ว: classified_by='ai-verify') ไป Meta Conversion Leads (CAPI)
// - ส่งเฉพาะรายที่ยังไม่เคยส่งสำเร็จ (meta_push_status != 'success')  → กันส่งซ้ำ
// - รายที่ส่งแล้วล้มเหลวจะยังเข้าเงื่อนไข ให้กดส่งซ้ำได้
// ต้องตั้ง Dataset ID ใน settings.chat_sync_config.meta_dataset_id

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { authorizeRequest } from "../_shared/permissions.ts";

const GRAPH_VERSION = "v22.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
// map สถานะภายใน → event name ที่ Conversions API for Business Messaging "รองรับจริง"
// รายชื่อที่รองรับตามเอกสาร Meta: Purchase, LeadSubmitted, InitiateCheckout, AddToCart, ViewContent,
//   OrderCreated, OrderShipped, OrderDelivered, OrderCanceled, OrderReturned, CartAbandoned,
//   QualifiedLead, RatingProvided, ReviewProvided
// ⚠️ "Lead" เฉยๆ ไม่อยู่ในรายชื่อ — ของเดิมส่ง "Lead" สำหรับ 3 สถานะ ซึ่ง Meta ไม่รับ
const STAGE_EVENT: Record<string, string> = {
  converted: "Purchase",        // ให้ข้อมูลติดต่อ/เปิดบัญชีแล้ว = คอนเวอร์ชั่นจริง
  qualified: "QualifiedLead",   // คุยแล้วสนใจจริง แต่ยังไม่ให้ข้อมูล
  new: "LeadSubmitted",         // เพิ่งทักเข้ามา
  // disqualified: ไม่ส่ง — การส่ง event บวกให้ลีดขยะจะสอนอัลกอริทึมผิดทาง
  // ทำให้ Meta ไปหาคนแบบเดียวกันมาอีก (ยิ่งได้ลีดคุณภาพต่ำ)
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { admin: true, setting: "synccfg", allowService: true });
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "content-type": "application/json" } });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = await getMetaToken();
    if (!token) throw new Error("ยังไม่ได้ตั้งค่า Meta access token");

    const { data: cfgRow } = await admin.from("settings").select("value").eq("key", "chat_sync_config").maybeSingle();
    const fallbackDataset = (cfgRow?.value as any)?.meta_dataset_id || null;   // ค่ากลางแบบเดิม (ใช้เป็นตัวสำรอง)

    // ---- Dataset "รายเพจ" ----
    // เอกสาร Meta: 1 เพจผูกได้กับ 1 dataset เท่านั้น → ต้องส่ง event ของแต่ละเพจเข้า dataset ของเพจนั้น
    // ของเดิมใช้ dataset เดียวรวมทุกเพจ ซึ่งผิดโครงสร้างเมื่อมีหลายเพจ
    const { data: pageCfgs } = await admin.from("page_lead_config").select("page_id, page_name, dataset_id");
    const dsByPage: Record<string, string> = {};
    const pageNameById: Record<string, string> = {};
    for (const c of pageCfgs ?? []) {
      if (c.dataset_id) dsByPage[c.page_id] = String(c.dataset_id);
      if (c.page_name) pageNameById[c.page_id] = c.page_name;
    }
    if (Object.keys(dsByPage).length === 0 && !fallbackDataset) {
      return new Response(JSON.stringify({
        ok: false, reason: "no_dataset",
        error: `ยังไม่มี Dataset ID ของเพจไหนเลย — กดปุ่ม "ดึง Dataset ของทุกเพจ" ในหน้าตั้งค่าการซิงก์แชท ระบบจะดึงให้อัตโนมัติจาก Meta (1 เพจ = 1 dataset)`,
      }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const ids: string[] | null = Array.isArray(body?.ids) && body.ids.length ? body.ids.map(String) : null;
    const limit = Math.min(200, Math.max(1, Number(body?.limit) || 100));

    // ---- ตรวจ dataset ที่จะใช้ก่อน (pre-flight) ----
    // เดิม: ถ้า Dataset ID ผิด จะยิงไป 100 ครั้งแล้วมาร์ก 100 แถวเป็น "ล้มเหลว" ทั้งที่ผิดที่ค่าตั้งค่าตัวเดียว
    // ทำให้ข้อมูลเสียและหาสาเหตุยาก — เช็คก่อน แล้วตัดเฉพาะ dataset ที่ใช้ไม่ได้ออก ไม่แตะข้อมูลสักแถว
    const badDataset: Record<string, string> = {};
    const checked = new Set<string>();
    for (const ds of [...new Set([...Object.values(dsByPage), ...(fallbackDataset ? [fallbackDataset] : [])])]) {
      if (checked.has(ds)) continue;
      checked.add(ds);
      const chk = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${ds}?fields=id,name&access_token=${encodeURIComponent(token)}`);
      const cj = await chk.json().catch(() => ({}));
      if (cj?.error) badDataset[ds] = String(cj.error.message || "ใช้ไม่ได้");
    }
    // ถ้า dataset ใช้ไม่ได้ "ทุกตัว" → หยุดทันที ไม่ต้องยิงให้เสียเวลาและไม่มาร์กแถวไหนว่าล้มเหลว
    if (checked.size > 0 && Object.keys(badDataset).length === checked.size) {
      const first = Object.entries(badDataset)[0];
      return new Response(JSON.stringify({
        ok: false, reason: "bad_dataset",
        error: `Dataset ใช้ไม่ได้ทั้งหมด — Meta ตอบว่า: ${first[1]}
Dataset ที่ลอง: ${first[0]}
วิธีแก้ที่แนะนำ: กดปุ่ม "ดึง Dataset ของทุกเพจ" ในหน้าตั้งค่าการซิงก์แชท ให้ระบบดึง dataset ที่ถูกต้องของแต่ละเพจมาเอง (ต้องมีสิทธิ์ page_events)`,
        bad_datasets: badDataset,
      }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    // เลือกรายที่ตรวจซ้ำแล้ว + ยังไม่เคยส่งสำเร็จ (null หรือ failed)
    const COLS = "id, page_id, psid, stage, classified_by, meta_push_status, meta_push_stage, last_message_at";
    let query = admin.from("chat_customers")
      .select(COLS)
      .eq("classified_by", "ai-verify")
      .not("psid", "is", null)
      // ยังไม่เคยส่ง (NULL) หรือส่งแล้วล้มเหลว (failed) — ข้ามที่ success แล้ว
      .or("meta_push_status.is.null,meta_push_status.eq.failed");
    if (ids) query = query.in("id", ids);
    const { data: firstRows, error: qErr } = await query.limit(limit);
    if (qErr) throw qErr;
    const rows: any[] = firstRows ?? [];
    // เติมรายที่ "เคยส่งสำเร็จแล้วแต่สถานะเปลี่ยน" (เช่น qualified → converted หลัง verify รอบใหม่) — เดิมส่งครั้งเดียวจบ อัปเกรดสถานะไม่เคยถึง Meta
    if (!ids && rows.length < limit) {
      for (const s of ["converted", "qualified", "new", "disqualified"]) {
        if (rows.length >= limit) break;
        const { data: more } = await admin.from("chat_customers")
          .select(COLS)
          .eq("classified_by", "ai-verify").not("psid", "is", null)
          .eq("meta_push_status", "success").eq("stage", s).neq("meta_push_stage", s)
          .limit(limit - rows.length);
        for (const m of more ?? []) if (!rows.some((x) => x.id === m.id)) rows.push(m);
      }
    }
    if (rows.length === 0) {
      // debug: บอกว่าทำไมไม่มีรายการให้ส่ง — แยก "ส่งครบแล้ว" (ปกติ) ออกจาก "ติดปัญหา" ให้ชัด
      const cnt = async (b: (q: any) => any) => (await b(admin.from("chat_customers").select("id", { count: "exact", head: true }))).count ?? 0;
      const verified = await cnt((q) => q.eq("classified_by", "ai-verify"));
      const withPsid = await cnt((q) => q.eq("classified_by", "ai-verify").not("psid", "is", null));
      const pushable = await cnt((q) => q.eq("classified_by", "ai-verify").not("psid", "is", null).or("meta_push_status.is.null,meta_push_status.eq.failed"));
      const alreadyPushed = await cnt((q) => q.eq("meta_push_status", "success"));
      const lastFailed = await cnt((q) => q.eq("meta_push_status", "failed"));
      // reason: บอกสาเหตุเป็นคำ ให้หน้าเว็บเอาไปแสดงตรงๆ ได้เลย
      let reason = "all_sent";
      if (verified === 0) reason = "no_verified";            // ยังไม่มีรายที่ AI ใหญ่ตรวจ
      else if (withPsid === 0) reason = "no_psid";           // มีแต่ไม่มี psid (ซิงก์ไม่ครบ)
      return new Response(JSON.stringify({
        ok: true, eligible: 0, success: 0, failed: 0, done: true, reason,
        debug: { verified, withPsid, pushable, alreadyPushed, lastFailed, dataset_set: Object.keys(dsByPage).length > 0 || !!fallbackDataset },
      }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    let success = 0, failed = 0, skipped = 0;
    const errors: string[] = [];
    const now = new Date().toISOString();
    const nowSec = Math.floor(Date.now() / 1000);

    for (const r of rows) {
      const eventName = STAGE_EVENT[r.stage];
      // ไม่มีใน map (disqualified) = ไม่ส่ง — มาร์กเป็น skipped กันวนกลับมาเลือกซ้ำทุกรอบ
      if (!eventName) {
        skipped++;
        await admin.from("chat_customers").update({
          meta_push_status: "skipped", meta_push_stage: r.stage, meta_push_error: null, meta_push_at: now,
        }).eq("id", r.id);
        continue;
      }
      // เลือก dataset ของ "เพจนั้น" (1 เพจ = 1 dataset) ไม่มีก็ใช้ค่ากลางเป็นตัวสำรอง
      const ds = dsByPage[r.page_id] || fallbackDataset;
      if (!ds || badDataset[ds]) {
        failed++;
        const why = !ds
          ? `เพจ "${pageNameById[r.page_id] || r.page_id}" ยังไม่มี Dataset ID — กด "ดึง Dataset ของทุกเพจ" ในหน้าตั้งค่า`
          : `Dataset ของเพจนี้ใช้ไม่ได้: ${badDataset[ds]}`;
        if (errors.length < 3 && !errors.includes(why)) errors.push(why);
        await admin.from("chat_customers").update({
          meta_push_status: "failed", meta_push_stage: r.stage, meta_push_error: why.slice(0, 300), meta_push_at: now,
        }).eq("id", r.id);
        continue;
      }
      // event_time = เวลาที่เกิดจริง (ข้อความล่าสุดของลูกค้า) ไม่ใช่เวลากดส่ง — แม่นต่อ attribution
      // Meta รับย้อนหลังไม่เกิน 7 วัน จึง clamp ไว้ในกรอบ [now-6.9วัน, now]
      const msgSec = r.last_message_at ? Math.floor(new Date(r.last_message_at).getTime() / 1000) : nowSec;
      const eventTime = Math.max(nowSec - Math.floor(6.9 * 86400), Math.min(nowSec, msgSec));
      const payload = {
        data: [{
          event_name: eventName,
          event_time: eventTime,
          event_id: `${r.id}:${r.stage}`, // dedup กันส่งซ้ำตอน retry/กดซ้ำ (สถานะเดิมส่งกี่ครั้ง Meta นับครั้งเดียว)
          action_source: "business_messaging",
          messaging_channel: "messenger",
          user_data: { page_id: r.page_id, page_scoped_user_id: r.psid },
        }],
        partner_agent: "ai-ads-automation",   // ตามที่เอกสาร Meta แนะนำให้ระบุผู้ส่ง
      };
      let ok = false, errMsg = "";
      try {
        const resp = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${ds}/events?access_token=${encodeURIComponent(token)}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
        });
        const j = await resp.json();
        if (resp.ok && !j?.error && (j?.events_received >= 1 || j?.events_received === undefined)) ok = true;
        else errMsg = j?.error?.error_user_msg || j?.error?.message || `HTTP ${resp.status}`;
      } catch (e) { errMsg = String(e instanceof Error ? e.message : e); }

      if (ok) success++; else { failed++; if (errMsg && errors.length < 3) errors.push(errMsg); }
      await admin.from("chat_customers").update({
        meta_push_status: ok ? "success" : "failed",
        meta_push_stage: r.stage,
        meta_push_error: ok ? null : errMsg.slice(0, 300),
        meta_push_at: now,
      }).eq("id", r.id);
    }

    // eligible นับเฉพาะรายที่ "ส่งจริง" (ตัด skipped ออก) — ไม่งั้น frontend จะวนต่อทั้งที่ไม่มีอะไรให้ส่ง
    return new Response(JSON.stringify({
      ok: true, eligible: rows.length - skipped, success, failed, skipped,
      done: rows.length < limit, errors,
    }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err instanceof Error ? err.message : err) }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
});
