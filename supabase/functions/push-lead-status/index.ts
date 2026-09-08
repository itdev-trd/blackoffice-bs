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
  // account_opened = ลูกค้าเปิดบัญชีเทรดแล้ว คือคอนเวอร์ชั่นจริงของธุรกิจนี้
  // เดิมไม่มีในแผนที่ ทั้งที่เป็นสถานะที่แอดมินติดจริงมากที่สุด → ของที่มีค่าที่สุดไม่เคยถึง Meta
  account_opened: "Purchase",
  converted: "Purchase",        // สถานะเดิมของระบบเก่า เก็บไว้ให้ข้อมูลย้อนหลังยังส่งได้
  qualified: "QualifiedLead",   // คุยแล้วสนใจจริง แต่ยังไม่เปิดบัญชี
  new: "LeadSubmitted",         // เพิ่งทักเข้ามา
  // disqualified: ไม่ส่ง — การส่ง event บวกให้ลีดขยะจะสอนอัลกอริทึมผิดทาง
  // ทำให้ Meta ไปหาคนแบบเดียวกันมาอีก (ยิ่งได้ลีดคุณภาพต่ำ)
};

// Meta รับ event ย้อนหลังไม่เกิน 7 วัน — เกินกว่านั้นส่งไปก็ถูกปฏิเสธหรือได้เวลาผิด
// จึงไม่หยิบแถวที่เก่ากว่านี้มาส่งตั้งแต่ต้น ดีกว่าปล่อยให้ล้มแล้วมาร์ก failed ทั้งตาราง
const MAX_EVENT_AGE_DAYS = 7;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // ส่งทีละห้องจากหน้าตอบแชท (ระบุ ids) = งานประจำของแอดมิน ไม่ใช่การตั้งค่าระบบ
    // ส่งยกชุด (ไม่ระบุ ids) ยังจำกัดที่คนดูแลการซิงก์เหมือนเดิม เพราะกระทบข้อมูลโฆษณาเป็นวงกว้าง
    const preview = await req.clone().json().catch(() => ({}));
    const singleTargets = Array.isArray(preview?.ids) && preview.ids.length > 0 && preview.ids.length <= 50;
    const auth = await authorizeRequest(req, singleTargets
      ? { tab: ["inbox", "chat"], allowService: true }
      : { admin: true, setting: "synccfg", allowService: true });
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

    // ---- เลือกแถวที่ต้องส่ง ----
    //
    // เดิมกรองด้วย classified_by = 'ai-verify' ซึ่งในฐานข้อมูลจริงไม่มีแถวไหนเป็นค่านี้เลย
    // (ทุกแถวเป็น 'manual' คือแอดมินติดเอง หรือ null) ผลคือฟีเจอร์นี้ไม่เคยส่งอะไรออกไปได้จริง
    // เลิกกรองด้วยผู้จัดประเภท — แอดมินที่คุยกับลูกค้าเองน่าเชื่อถือกว่าโมเดลอยู่แล้ว
    //
    // สถานะที่ใช้ตัดสินคือ stage_manual ก่อน (ค่าที่คนกดเลือก) ไม่ใช่ stage ที่ระบบเดาไว้
    const COLS = "id, page_id, psid, source, stage, stage_manual, meta_push_status, meta_push_stage, last_message_at, account_opened_at";
    const effStage = (r: any) => String(r?.stage_manual || r?.stage || "new");
    // ต้องส่งเมื่อ: ยังไม่เคยส่ง / เคยล้มเหลว / เคยส่งแล้วแต่สถานะเปลี่ยนไปแล้ว
    const needsPush = (r: any) => !!STAGE_EVENT[effStage(r)] &&
      (r.meta_push_status !== "success" || String(r.meta_push_stage || "") !== effStage(r));

    const cutoffIso = new Date(Date.now() - MAX_EVENT_AGE_DAYS * 86_400_000).toISOString();
    let query = admin.from("chat_customers")
      .select(COLS)
      .not("psid", "is", null)
      .neq("psid", "")
      .is("blocked_at", null)
      // CAPI for Business Messaging รับเฉพาะ PSID ของเพจ Facebook
      // ห้อง LINE ใช้ user id ของ LINE และห้องคอมเมนต์ยังไม่มี PSID จริง — ส่งไปได้แต่เป็นข้อมูลผิด
      // (ตัวกรองเดิม classified_by='ai-verify' บังเอิญกันไว้ พอถอดออกจึงต้องกันตรงนี้ให้ชัด)
      //
      // ต้องเขียนเป็น "source is null or source not in (...)" เพราะห้อง Messenger ส่วนใหญ่
      // มี source = NULL และใน SQL การเทียบ NULL not in (...) ได้ผลเป็น NULL = ถูกตัดทิ้งทั้งหมด
      .or("source.is.null,source.not.in.(line,comment)")
      .not("id", "like", "fbc_%");
    // ระบุ ids มา = สั่งเฉพาะห้องนั้น (กดจากหน้าตอบแชทตอนเปลี่ยนสถานะ) ไม่ต้องจำกัดช่วงเวลาตรงนี้
    // เพราะต้องตอบให้ชัดว่าห้องนั้นส่งไม่ได้เพราะเก่าเกิน ไม่ใช่หายไปเงียบ ๆ
    if (ids) query = query.in("id", ids);
    else {
      // กรอง "ยังไม่เคยส่ง / เคยล้มเหลว" ที่ฐานข้อมูลเลย
      //
      // เดิมดึงแถวใหม่สุด limit*3 มาแล้วค่อยกรองในโค้ด ซึ่งพอแถวชุดนั้นส่งครบ
      // ตัวเลือกก็ได้แต่แถวที่ส่งแล้วทุกครั้ง ระบบจึงตอบว่า "เสร็จแล้ว" ทั้งที่ยังเหลืออีกเป็นร้อยห้อง
      // (เจอจริงตอน backfill: ส่งได้ 120 ห้องแล้วหยุด ทั้งที่เข้าเงื่อนไข 210 ห้อง)
      //
      // เคส "ส่งสำเร็จแล้วแต่สถานะเปลี่ยนทีหลัง" ไม่ต้องพึ่งรอบยกชุดอีก
      // เพราะตอนนี้หน้าจัดการลูกค้า/หน้าตอบแชท ยิงให้ทีละห้องทันทีที่เปลี่ยนสถานะ
      query = query
        .or("meta_push_status.is.null,meta_push_status.eq.failed")
        .gte("last_message_at", cutoffIso)
        .order("last_message_at", { ascending: false })
        .limit(limit);
    }
    const { data: candidates, error: qErr } = await query;
    if (qErr) throw qErr;

    const rows: any[] = (candidates ?? []).filter(needsPush).slice(0, limit);

    if (rows.length === 0) {
      const cnt = async (b: (q: any) => any) => (await b(admin.from("chat_customers").select("id", { count: "exact", head: true }))).count ?? 0;
      const recent = await cnt((q) => q.not("psid", "is", null).is("blocked_at", null).gte("last_message_at", cutoffIso));
      const alreadyPushed = await cnt((q) => q.eq("meta_push_status", "success"));
      const lastFailed = await cnt((q) => q.eq("meta_push_status", "failed"));
      const tooOld = await cnt((q) => q.not("psid", "is", null).is("blocked_at", null).lt("last_message_at", cutoffIso));
      // reason: บอกสาเหตุเป็นคำ ให้หน้าเว็บเอาไปแสดงตรง ๆ ได้เลย
      const reason = ids
        ? ((candidates ?? []).length === 0 ? "not_eligible" : "all_sent")
        : ((candidates ?? []).length === 0 ? (recent === 0 ? "no_recent" : "no_psid") : "all_sent");
      return new Response(JSON.stringify({
        ok: true, eligible: 0, success: 0, failed: 0, done: true, reason,
        debug: { recent_within_window: recent, alreadyPushed, lastFailed, too_old_to_send: tooOld, window_days: MAX_EVENT_AGE_DAYS,
                 dataset_set: Object.keys(dsByPage).length > 0 || !!fallbackDataset },
      }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    let success = 0, failed = 0, skipped = 0;
    const errors: string[] = [];
    const now = new Date().toISOString();
    const nowSec = Math.floor(Date.now() / 1000);

    for (const r of rows) {
      const stage = effStage(r);
      // สั่งด้วย ids ตรง ๆ ข้ามตัวกรองด้านบนได้ จึงกันช่องทางที่ Meta ไม่รองรับไว้อีกชั้น
      if (r.source === "line" || r.source === "comment" || String(r.id).startsWith("fbc_")) {
        skipped++;
        await admin.from("chat_customers").update({
          meta_push_status: "skipped", meta_push_stage: stage, meta_push_at: now,
          meta_push_error: "ช่องทางนี้ไม่รองรับ — Conversions API ของ Meta รับเฉพาะ Messenger และ Instagram",
        }).eq("id", r.id);
        continue;
      }
      // Instagram ใช้ชุดฟิลด์คนละแบบ: messaging_channel = instagram และ user_data ต้องเป็น
      // { ig_sid, ig_account_id } ไม่ใช่ { page_id, page_scoped_user_id }
      // (ยิงทดสอบกับ Graph v22.0 แล้ว: ใช้ page_scoped_user_id → subcode 2804075 "ไม่มีพารามิเตอร์ ig_sid",
      //  ใส่ ig_sid เดี่ยว ๆ → subcode 2804079 "ขาด ID บัญชี IG", ใส่คู่กัน → events_received 1)
      const isInstagram = r.source === "instagram";
      const igAccountId = isInstagram ? (/^ig_(\d+)_/.exec(String(r.id))?.[1] || "") : "";
      if (isInstagram && !igAccountId) {
        skipped++;
        await admin.from("chat_customers").update({
          meta_push_status: "skipped", meta_push_stage: stage, meta_push_at: now,
          meta_push_error: "หา ID บัญชี Instagram จากรหัสห้องไม่ได้ — ส่ง event ไม่ได้",
        }).eq("id", r.id);
        continue;
      }
      const eventName = STAGE_EVENT[stage];
      // ไม่มีใน map (disqualified) = ไม่ส่ง — มาร์กเป็น skipped กันวนกลับมาเลือกซ้ำทุกรอบ
      if (!eventName) {
        skipped++;
        await admin.from("chat_customers").update({
          meta_push_status: "skipped", meta_push_stage: stage, meta_push_error: null, meta_push_at: now,
        }).eq("id", r.id);
        continue;
      }
      // Meta ไม่รับ event ที่เก่ากว่า 7 วัน — บอกเหตุผลไว้ในแถว ไม่ใช่มาร์ก failed ให้ดูเหมือนระบบพัง
      const ageSec = r.last_message_at ? (nowSec - Math.floor(new Date(r.last_message_at).getTime() / 1000)) : 0;
      if (ageSec > MAX_EVENT_AGE_DAYS * 86400) {
        skipped++;
        await admin.from("chat_customers").update({
          meta_push_status: "skipped", meta_push_stage: stage, meta_push_at: now,
          meta_push_error: `ข้อความล่าสุดเก่ากว่า ${MAX_EVENT_AGE_DAYS} วัน — Meta ไม่รับ event ย้อนหลังเกินเท่านี้`,
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
          meta_push_status: "failed", meta_push_stage: stage, meta_push_error: why.slice(0, 300), meta_push_at: now,
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
          event_id: `${r.id}:${stage}`, // dedup กันส่งซ้ำตอน retry/กดซ้ำ (สถานะเดิมส่งกี่ครั้ง Meta นับครั้งเดียว)
          action_source: "business_messaging",
          messaging_channel: isInstagram ? "instagram" : "messenger",
          user_data: isInstagram
            ? { ig_sid: r.psid, ig_account_id: igAccountId }
            : { page_id: r.page_id, page_scoped_user_id: r.psid },
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
        // account_opened_at กันไม่ให้ client แก้ ฝั่งนี้จึงตั้งให้ตอนสถานะเป็น "เปิดบัญชีแล้ว"
        // (ใช้กับรายงานว่าเปิดบัญชีวันไหน — เดิมหน้าตอบแชทตั้งเองแล้วถูกปฏิเสธทั้งคำสั่ง)
        ...(stage === "account_opened" && !r.account_opened_at ? { account_opened_at: now } : {}),
        meta_push_status: ok ? "success" : "failed",
        meta_push_stage: stage,
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
