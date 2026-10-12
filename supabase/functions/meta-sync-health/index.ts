// supabase/functions/meta-sync-health/index.ts
// ศูนย์รวม "ผลที่ส่งไป Meta" ให้แอดมินดูและแก้เองได้ โดยไม่ต้องเปิด log:
//   { action: "summary", page_id? }                  → นับสถานะส่ง CAPI/ป้าย + รายการที่พัง + รายการที่เว็บนำหน้า Meta
//   { action: "diff", page_id?, offset?, limit? }    → อ่านป้ายจริงจาก Meta ทีละชุดแล้วเทียบกับสถานะในเว็บ
// อ่านอย่างเดียว ไม่เขียนอะไรกลับ — การแก้ (ส่งใหม่) หน้าเว็บเรียก push-lead-status / meta-push-labels เอง
// ขอบเขตเพจ: BeSight เท่านั้น (ดู CLAUDE.md) — ระบุ page_id อื่นได้เฉพาะเพจที่ getChatPages เห็น

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getChatPages } from "../_shared/meta-pages.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";
import { getMetaBackgroundGuard, recordMetaUsage } from "../_shared/meta-rate.ts";

const GRAPH_BASE = "https://graph.facebook.com/v22.0";
const BESIGHT_PAGE_ID = "438134449376109";
const LIST_LIMIT = 100;       // จำนวนรายการสูงสุดต่อกลุ่มที่ส่งกลับให้หน้าเว็บ
const DIFF_MAX = 30;          // ห้องต่อการเรียก diff หนึ่งครั้ง (คุมจำนวนคำขอ Meta)
const DIFF_CONCURRENCY = 5;
const DIFF_DEADLINE_MS = 90_000;
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

// ต้องตรงกับ STAGE_LABELS ใน meta-push-labels
const STAGE_LABELS: Record<string, string> = {
  new: "มาใหม่",
  qualified: "มีคุณสมบัติ",
  converted: "สร้างคอนเวอร์ชั่นแล้ว",
  account_opened: "ลูกค้าเปิดบัญชีใหม่",
  disqualified: "ไม่มีคุณสมบัติ",
};
const STAGE_NAME_SET = new Set(Object.values(STAGE_LABELS));
const HIGH_NAMES = new Set([STAGE_LABELS.converted, STAGE_LABELS.account_opened]);
const wantNamesFor = (stage: string) => (stage === "account_opened"
  ? [STAGE_LABELS.account_opened, STAGE_LABELS.converted]
  : [STAGE_LABELS[stage] || STAGE_LABELS.new]);

// ช่องทางที่ป้าย Messenger ใช้ได้ (LINE / Instagram / คอมเมนต์ ไม่มี custom label)
const MESSENGER_FILTER = "source.is.null,source.not.in.(line,instagram,comment)";

const rowInfo = (r: any) => ({
  id: r.id, name: r.customer_name || r.psid || r.id, source: r.source || "messenger", stage: r.stage_manual || r.stage || "new",
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorizeRequest(req, { admin: true, setting: "synccfg" });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const body = await readJsonBody(req, 16 * 1024);
    const action = String(body?.action || "summary");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const pageId = String(body?.page_id || BESIGHT_PAGE_ID);
    const pagesData = pageId === BESIGHT_PAGE_ID && action === "summary" ? null : await getChatPages(GRAPH_BASE);
    if (pagesData && pageId !== BESIGHT_PAGE_ID && !(pagesData.data ?? []).some((p: any) => String(p.id) === pageId)) {
      return json({ ok: false, error: "เพจนี้ไม่อยู่ในขอบเขตแชทของระบบ" }, 400);
    }

    if (action === "summary") {
      const count = async (b: (q: any) => any) => (await b(admin.from("chat_customers").select("id", { count: "exact", head: true }).eq("page_id", pageId))).count ?? 0;
      const [capiSuccess, capiFailed, capiSkipped, labelError] = await Promise.all([
        count((q) => q.eq("meta_push_status", "success")),
        count((q) => q.eq("meta_push_status", "failed")),
        count((q) => q.eq("meta_push_status", "skipped")),
        count((q) => q.not("label_push_error", "is", null)),
      ]);
      const { data: capiRows } = await admin.from("chat_customers")
        .select("id, customer_name, psid, source, stage, stage_manual, meta_push_stage, meta_push_error, meta_push_at")
        .eq("page_id", pageId).eq("meta_push_status", "failed")
        .order("meta_push_at", { ascending: false }).limit(LIST_LIMIT);
      const { data: labelRows } = await admin.from("chat_customers")
        .select("id, customer_name, psid, source, stage, stage_manual, label_push_stage, label_push_error, label_push_attempts, label_push_at")
        .eq("page_id", pageId).not("label_push_error", "is", null)
        .order("label_push_at", { ascending: false }).limit(LIST_LIMIT);
      // เว็บนำหน้า Meta: เคยส่งป้ายแล้วแต่สถานะในเว็บเปลี่ยนไปทีหลัง (เทียบในโค้ด — ไม่มี index ให้เทียบสองคอลัมน์)
      const { data: pushed } = await admin.from("chat_customers")
        .select("id, customer_name, psid, source, stage, stage_manual, label_push_stage, label_push_at")
        .eq("page_id", pageId).not("label_push_stage", "is", null).or(MESSENGER_FILTER).limit(5000);
      const webAhead = (pushed ?? []).filter((r: any) => (r.stage || "new") !== r.label_push_stage)
        .slice(0, LIST_LIMIT).map((r: any) => ({ ...rowInfo(r), stage: r.stage || "new", label_push_stage: r.label_push_stage, label_push_at: r.label_push_at }));
      return json({
        ok: true, page_id: pageId,
        counts: { capi_success: capiSuccess, capi_failed: capiFailed, capi_skipped: capiSkipped, label_error: labelError, web_ahead: webAhead.length, label_pushed: (pushed ?? []).length },
        capi_failed: (capiRows ?? []).map((r: any) => ({ ...rowInfo(r), error: r.meta_push_error, at: r.meta_push_at, pushed_stage: r.meta_push_stage })),
        label_errors: (labelRows ?? []).map((r: any) => ({ ...rowInfo(r), error: r.label_push_error, at: r.label_push_at, attempts: r.label_push_attempts || 0 })),
        web_ahead: webAhead,
      });
    }

    if (action === "diff") {
      const guard = await getMetaBackgroundGuard(admin);
      if (guard.blocked) return json({ ok: false, error: `Meta จำกัดการเรียกชั่วคราว (ใกล้เต็มโควตา) — ลองใหม่หลัง ${guard.until}` });
      const page = (pagesData?.data ?? (await getChatPages(GRAPH_BASE))?.data ?? []).find((p: any) => String(p.id) === pageId);
      if (!page?.access_token) return json({ ok: false, error: "ไม่พบ access token ของเพจนี้ (เช็คสิทธิ์/token ตอบแชทในหน้าตั้งค่า)" });
      const offset = Math.max(0, Number(body?.offset) || 0);
      const limit = Math.min(DIFF_MAX, Math.max(1, Number(body?.limit) || DIFF_MAX));
      const { data: rows, count } = await admin.from("chat_customers")
        .select("id, customer_name, psid, source, stage, stage_manual, label_push_stage, label_push_at", { count: "exact" })
        .eq("page_id", pageId).not("psid", "is", null).not("label_push_stage", "is", null)
        .or(MESSENGER_FILTER).not("id", "like", "fbc_%")
        .order("label_push_at", { ascending: false }).range(offset, offset + limit - 1);

      const deadline = Date.now() + DIFF_DEADLINE_MS;
      const mismatches: any[] = [];
      let checked = 0, matched = 0, errors = 0, firstError = "";
      const queue = [...(rows ?? [])];
      const worker = async () => {
        for (let r = queue.shift(); r; r = queue.shift()) {
          if (Date.now() > deadline) { queue.unshift(r); return; }
          const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(r.psid)}/custom_labels?fields=name,page_label_name&limit=100&access_token=${page.access_token}`);
          await recordMetaUsage(admin, res, "meta_sync_health_diff");
          const j = await res.json().catch(() => ({}));
          if (j?.error) { errors++; firstError ||= j.error.message || "Meta error"; continue; }
          checked++;
          const metaNames: string[] = (j?.data ?? []).map((x: any) => x.name || x.page_label_name).filter((n: any) => n && STAGE_NAME_SET.has(n));
          const stage = r.stage || "new";   // meta-push-labels ใช้ stage ตัวนี้ในการติดป้าย
          const want = wantNamesFor(stage);
          const missing = want.filter((n) => !metaNames.includes(n));
          const extra = metaNames.filter((n) => !want.includes(n));
          if (!missing.length && !extra.length) { matched++; continue; }
          // ป้ายสูง (คอนเวอร์ชั่น/เปิดบัญชี) บน Meta ที่เว็บไม่มีแล้ว = ระบบตั้งใจไม่ถอด (กันดาวน์เกรด) แยกประเภทให้เห็น
          const kind = missing.length ? "missing_on_meta" : extra.every((n) => HIGH_NAMES.has(n)) ? "meta_higher" : "meta_differs";
          mismatches.push({ ...rowInfo(r), stage, kind, want, meta: metaNames, label_push_at: r.label_push_at });
        }
      };
      await Promise.all(Array.from({ length: DIFF_CONCURRENCY }, worker));
      // queue ที่เหลือ = หมดเวลาก่อน → ให้หน้าเว็บเริ่มรอบถัดไปจากตรงที่ทำถึง
      const done = (rows ?? []).length - queue.length;
      return json({
        ok: true, page_id: pageId, offset, next_offset: offset + done, total: count ?? null,
        has_more: offset + done < (count ?? 0), checked, matched, errors, first_error: firstError || null, mismatches,
      });
    }

    return json({ ok: false, error: "action ไม่ถูกต้อง" }, 400);
  } catch (error) {
    return json({ ok: false, error: String(error instanceof Error ? error.message : error) });
  }
});
