// supabase/functions/meta-push-labels/index.ts
// ส่ง "สถานะลูกค้า" จากแอปไปติดเป็น Custom Label บนบทสนทนาของเพจใน Meta
//   - สร้างป้าย 4 สถานะอัตโนมัติถ้ายังไม่มี (idempotent)
//   - ติดป้ายให้ตรงกับสถานะปัจจุบันของลูกค้า + ถอดป้ายสถานะอื่นออก (ให้เหลือป้ายเดียว)
// โหมด:
//   { id: "<chat_customers.id>" }        → ทำทีละ 1 คน (ใช้กับปุ่มทดสอบ)
//   { mode: "all", page_id?, limit? }    → ทำทั้งหมด (เลือกเฉพาะเพจได้)
// ต้องมีสิทธิ์ pages_messaging (ตัวเดียวกับที่อ่าน custom_labels ได้อยู่แล้ว)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { getMetaPages } from "../_shared/meta-pages.ts";
import { authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";

const GRAPH_VERSION = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// สถานะ → ชื่อป้ายที่จะไปสร้าง/ติดบน Meta (ตรงกับ CHAT_STAGES ฝั่งแอป)
const STAGE_LABELS: Record<string, string> = {
  new: "มาใหม่",
  qualified: "มีคุณสมบัติ",
  converted: "สร้างคอนเวอร์ชั่นแล้ว",
  account_opened: "ลูกค้าเปิดบัญชีใหม่",
  disqualified: "ไม่มีคุณสมบัติ",
};
// สถานะ "ระดับสูง" (คอนเวอร์ชั่น) — อยู่ร่วมกันได้ ไม่ถอดออกจากกัน และไม่ดาวน์เกรด
//   "ลูกค้าเปิดบัญชีใหม่" ให้มีป้ายพร้อมกับ "สร้างคอนเวอร์ชั่นแล้ว" ได้
const HIGH_STAGES = new Set(["converted", "account_opened"]);
const ALL_STAGE_NAMES = Object.values(STAGE_LABELS);
const HIGH_NAMES = new Set(["converted", "account_opened"].map((s) => STAGE_LABELS[s]));
// ลำดับสถานะ (เลขมาก = ก้าวหน้ากว่า) ใช้ตัดสิน "อัปเกรด" ตอนกันส่งป้ายซ้ำ
const RANK: Record<string, number> = { disqualified: 0, new: 1, qualified: 2, converted: 3, account_opened: 4 };
// ป้ายที่ต้องมีเมื่อสถานะเป็น X — account_opened = ติดทั้ง "เปิดบัญชี" + "คอนเวอร์ชั่น"
const wantStagesFor = (stage: string) => (stage === "account_opened" ? ["account_opened", "converted"] : [stage]);

async function fetchJson(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  return await r.json().catch(() => ({}));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const body = await readJsonBody(req, 64 * 1024);
    const onlyId = body?.id ? String(body.id) : null;
    const mode = body?.mode === "all" ? "all" : (onlyId ? "one" : "all");
    const onlyPage = body?.page_id ? String(body.page_id) : null;
    // ทำทีละคนจากหน้า Inbox: พนักงานที่มีสิทธิ์เพจนั้นส่งป้ายได้
    // โหมด bulk/settings ยังคงจำกัดเฉพาะ admin
    const auth = await authorizeRequest(req, onlyId
      ? { tab: "inbox", allowService: true }
      : { admin: true, setting: "synccfg", pageId: onlyPage, allowService: true });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const limit = Math.min(2000, Math.max(1, Number(body?.limit) || 500));

    const token = await getMetaToken();
    if (!token) throw new Error("ยังไม่ได้ตั้งค่า Meta access token (ตั้งได้ในหน้าตั้งค่า)");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const base = `https://graph.facebook.com/${GRAPH_VERSION}`;
    const deadline = Date.now() + 120000;

    // token ของแต่ละเพจ (label ต้องใช้ page access token)
    const pagesData = await getMetaPages(base, token);
    if (pagesData?.error) throw new Error(pagesData.error.message || "ดึงรายชื่อเพจไม่สำเร็จ (ต้องมีสิทธิ์ pages_show_list/pages_messaging)");
    const pageTokens: Record<string, string> = {};
    for (const p of (pagesData?.data ?? [])) if (p.access_token) pageTokens[p.id] = p.access_token;

    // เลือกลูกค้าเป้าหมาย
    const COLS = "id, psid, page_id, page_name, customer_name, source, stage, stage_manual, classified_by, label_push_stage, label_push_attempts, account_opened_at";
    let rows: any[] = [];
    let remaining = 0;
    if (onlyId) {
      const { data } = await admin.from("chat_customers").select(COLS).eq("id", onlyId).maybeSingle();
      if (!data) throw new Error("ไม่พบลูกค้า id นี้");
      // สิทธิ์ตอบแชทไม่ผูกกับเพจ — ส่งป้ายจากหน้าตอบแชทได้ทุกเพจ (โหมด bulk ยังเป็น admin เท่านั้น)
      if (data.source === "instagram") {
        return json({ ok: true, processed: 0, total: 1, done: true, results: [{ name: data.customer_name || data.psid, skipped: true, unsupported: "instagram_labels", error: null }], note: "Instagram API ไม่รองรับ Facebook Page custom labels — สถานะยังบันทึกในแอปตามปกติ" });
      }
      rows = [data];
    } else {
      // เป้าหมาย = เฉพาะราย "AI ตรวจซ้ำแล้ว (classified_by = ai-verify)" หรือ "แอดมินติดป้ายเอง (stage_manual มีค่า)"
      // และต้อง "ยังไม่เคยส่งจากแอป (label_push_stage = null)" หรือ "อัปเกรดสถานะขึ้น" จากที่เคยส่ง
      //   → กันส่งซ้ำ (สถานะเท่าเดิม) และกันดาวน์เกรด (สถานะต่ำลง) โดยไม่ต้องอัปเดต DB ทิ้ง
      const stages = Object.keys(RANK);
      const upPairs: string[] = [];
      for (const to of stages) for (const from of stages) if (RANK[to] > RANK[from]) upPairs.push(`and(stage.eq.${to},label_push_stage.eq.${from})`);
      const needPush = ["label_push_stage.is.null", ...upPairs].join(",");
      let q = admin.from("chat_customers").select(COLS, { count: "exact" })
        .not("psid", "is", null)
        .or("source.is.null,source.neq.instagram")   // IGSID ใช้กับ Facebook Page custom_labels ไม่ได้
        .lt("label_push_attempts", 3)   // ลองแล้วไม่ผ่าน 3 ครั้ง = พักไว้ ไม่ให้บล็อกคิวคนอื่น
        .or("classified_by.eq.ai-verify,stage_manual.not.is.null")   // แหล่งสถานะที่อนุญาต
        .or(needPush)                                                // ยังไม่เคยส่ง หรือ อัปเกรด
        .order("last_message_at", { ascending: false })
        .limit(limit);
      if (onlyPage) q = q.eq("page_id", onlyPage);
      const { data, count } = await q;
      rows = data ?? [];
      remaining = Math.max(0, (count ?? rows.length) - rows.length);
    }
    if (!rows.length) return json({ ok: true, processed: 0, total: 0, done: true, results: [], note: "ป้ายตรงกับสถานะครบทุกรายแล้ว" });

    // cache: page_id → { name → label_id }  (โหลด/สร้างครั้งเดียวต่อเพจ)
    const labelMapByPage: Record<string, Record<string, string>> = {};
    const labelErrors: string[] = [];

    async function ensureLabels(pageId: string, pageToken: string): Promise<Record<string, string>> {
      if (labelMapByPage[pageId]) return labelMapByPage[pageId];
      const map: Record<string, string> = {};
      // อ่านป้ายที่มีอยู่
      const lr = await fetchJson(`${base}/${pageId}/custom_labels?fields=name,page_label_name&limit=500&access_token=${pageToken}`);
      if (lr?.error) { labelErrors.push(`[${pageId}] อ่านป้าย: ${lr.error.message || lr.error}`); }
      for (const l of (lr?.data ?? [])) {
        const nm = l.name || l.page_label_name;
        if (nm && ALL_STAGE_NAMES.includes(nm) && !map[nm]) map[nm] = l.id;
      }
      // สร้างป้ายที่ยังไม่มี — Graph API เวอร์ชันใหม่ใช้ field "page_label_name" (ตรงกับตอนอ่าน)
      // เอกสารเก่าใช้ "name" จึงลองทั้งสองแบบเพื่อความเข้ากันได้
      for (const nm of ALL_STAGE_NAMES) {
        if (map[nm]) continue;
        let created = false, lastErr = "ไม่สำเร็จ";
        for (const field of ["page_label_name", "name"]) {
          const cr = await fetchJson(`${base}/${pageId}/custom_labels?access_token=${pageToken}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ [field]: nm }),
          });
          if (cr?.id) { map[nm] = String(cr.id); created = true; break; }
          lastErr = cr?.error?.message || cr?.error?.error_user_msg || JSON.stringify(cr?.error || cr);
        }
        if (!created) labelErrors.push(`สร้างป้าย "${nm}": ${lastErr}`);
      }
      labelMapByPage[pageId] = map;
      return map;
    }

    const results: any[] = [];
    let processed = 0;
    for (const r of rows) {
      if (Date.now() > deadline) { results.push({ name: r.customer_name || r.psid, error: "หมดเวลา — เหลือทำต่อรอบหน้า" }); break; }
      const pageToken = pageTokens[r.page_id];
      if (!pageToken) { results.push({ name: r.customer_name || r.psid, error: "ไม่พบ access token ของเพจนี้ (เช็คสิทธิ์)" }); continue; }
      const stage = STAGE_LABELS[r.stage] ? r.stage : "new";
      const wantStages = wantStagesFor(stage);            // account_opened → [account_opened, converted]
      const wantNames = wantStages.map((s) => STAGE_LABELS[s]);

      const map = await ensureLabels(r.page_id, pageToken);
      const missing = wantNames.find((nm) => !map[nm]);
      if (missing) { results.push({ name: r.customer_name || r.psid, stage, error: `สร้าง/หาป้าย "${missing}" ไม่ได้ — ${labelErrors[labelErrors.length - 1] || "ไม่ทราบสาเหตุ"}` }); continue; }

      // กันดาวน์เกรด (เฉพาะโหมดทั้งหมด): รายที่ "ยังไม่เคยส่งจากแอป" และสถานะต่ำกว่าคอนเวอร์ชั่น
      //   ถ้าบน Meta มีป้ายคอนเวอร์ชั่น/เปิดบัญชีอยู่แล้ว → ไม่ทับด้วยป้ายที่ต่ำกว่า (บันทึกไว้แล้วข้าม)
      if (!onlyId && !r.label_push_stage && RANK[stage] < RANK.converted) {
        const cur = await fetchJson(`${base}/${r.psid}/custom_labels?fields=name,page_label_name&limit=100&access_token=${pageToken}`);
        const curNames = (cur?.data ?? []).map((x: any) => x.name || x.page_label_name).filter(Boolean);
        const high = curNames.includes(STAGE_LABELS.account_opened) ? "account_opened" : (curNames.includes(STAGE_LABELS.converted) ? "converted" : null);
        if (high) {
          await admin.from("chat_customers").update({ label_push_stage: high, label_push_at: new Date().toISOString(), label_push_error: null }).eq("id", r.id);
          results.push({ name: r.customer_name || r.psid, stage, label: STAGE_LABELS[high], assigned: false, skipped: true, error: null });
          continue;
        }
      }

      // ติดป้ายที่ต้องการ (account_opened จะติดทั้ง "ลูกค้าเปิดบัญชีใหม่" + "สร้างคอนเวอร์ชั่นแล้ว")
      let assignOk = true, assignErr = "";
      for (const nm of wantNames) {
        // Messenger Custom Labels รับ PSID ผ่าน query parameter; fallback body รองรับ Graph รุ่นเก่า
        let assign = await fetchJson(`${base}/${map[nm]}/label?user=${encodeURIComponent(r.psid)}&access_token=${pageToken}`, { method: "POST" });
        if (assign?.success !== true) assign = await fetchJson(`${base}/${map[nm]}/label?access_token=${pageToken}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: r.psid }),
        });
        if (assign?.success !== true) { assignOk = false; assignErr = assign?.error?.message || "ติดป้ายไม่สำเร็จ"; }
      }

      // ถอด "ป้ายสถานะระบบ" อันเก่าที่ไม่ต้องการออก — แต่ "ไม่แตะป้ายคอนเวอร์ชั่น/เปิดบัญชี" (คงไว้เสมอ ให้อยู่ร่วมกันได้)
      // ป้ายอื่นที่แอดมินติดเอง (เช่น "ชำระเงินแล้ว") ไม่อยู่ใน map จึงไม่ถูกแตะ
      const toRemove = (r.label_push_stage && !HIGH_STAGES.has(r.label_push_stage) && STAGE_LABELS[r.label_push_stage])
        ? [STAGE_LABELS[r.label_push_stage]].filter((nm) => !wantNames.includes(nm))
        : ALL_STAGE_NAMES.filter((nm) => !wantNames.includes(nm) && !HIGH_NAMES.has(nm));
      let removed = 0;
      for (const nm of toRemove) {
        const oid = map[nm];
        if (!oid) continue;
        const del = await fetchJson(`${base}/${oid}/label?user=${encodeURIComponent(r.psid)}&access_token=${pageToken}`, { method: "DELETE" });
        if (del?.success === true) removed++;
      }

      processed += assignOk ? 1 : 0;
      // บันทึกผลลง DB — สำเร็จ = บันทึกสถานะที่ส่ง (รอบหน้าจะข้าม/รออัปเกรด) ; ไม่สำเร็จ = คงค่าเดิม
      const upd: Record<string, unknown> = {
        label_push_stage: assignOk ? stage : r.label_push_stage,
        label_push_at: new Date().toISOString(),
        label_push_error: assignOk ? null : String(assignErr).slice(0, 300),
        label_push_attempts: assignOk ? 0 : (r.label_push_attempts || 0) + 1,
      };
      // ประทับเวลา "เปิดบัญชี" ครั้งเดียว ตอนติดป้ายสำเร็จ (นับ 1 ในตารางรายวัน)
      if (assignOk && stage === "account_opened" && !r.account_opened_at) upd.account_opened_at = new Date().toISOString();
      await admin.from("chat_customers").update(upd).eq("id", r.id);

      results.push({
        name: r.customer_name || r.psid,
        stage,
        label: wantNames.join(" + "),
        assigned: assignOk,
        removed_others: removed,
        error: assignOk ? null : assignErr,
      });
    }

    // done = ทำครบทุกแถวที่ดึงมาแล้ว และไม่มีเหลือค้างในคิว
    const hitDeadline = results.some((x) => x.error === "หมดเวลา — เหลือทำต่อรอบหน้า");
    return json({
      ok: true,
      mode,
      processed,
      total: rows.length,
      remaining,
      done: !hitDeadline && remaining === 0 && rows.length < limit,
      results: results.slice(0, 200),
      label_errors: labelErrors.slice(0, 5),
    });
  } catch (err) {
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
