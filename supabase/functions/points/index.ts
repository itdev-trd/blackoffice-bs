// supabase/functions/points/index.ts
// กระดานแต้มโบนัส — อ่านจากสมุด point_events (append-only) ไม่คิดแต้มสดอีกแล้ว
//
// ทุกคน (มีเมนูกระดานแต้ม): overview · events · file_dispute · list_disputes · rules_history
// เฉพาะ owner: resolve_dispute · adjust · reverse · close_period · rules_set · backfill
// ทุก action ของ owner ลง activity_log ด้วย (ใคร ทำอะไร กับแต้มของใคร เมื่อไหร่)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest, isOwner } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";
import { loadPointConfig, insertPointEvent, replyIdemKey } from "../_shared/points.ts";
import {
  periodOf, periodRange, scoreReply, capFor, overCap, isExcludedCustomer, thaiDateOf, validateRules, ledgerFingerprint,
  normalizeRules, normalizeOfficeHours,
} from "../_shared/points-rules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const KINDS = ["reply_offhours", "reply_office", "tv_grant", "tv_renew", "adjustment", "reversal"] as const;
const PERIOD_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ดึงทุกแถวแบบแบ่งหน้า (PostgREST คืนสูงสุด ~1000 แถวต่อครั้ง)
async function fetchAll(build: (from: number, to: number) => any, size = 1000, max = 200) {
  const out: any[] = [];
  for (let page = 0; page < max; page++) {
    const { data, error } = await build(page * size, page * size + size - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < size) return out;
  }
  throw new Error("ข้อมูลมากเกินขีดจำกัด");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const auth = await authorizeRequest(req, { tab: "leaderboard" });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const me = auth.permission!.email;
    const owner = isOwner(auth.permission!);
    const body = await readJsonBody(req, 256 * 1024).catch(() => ({}));
    const action = String(body?.action || "overview");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const nowIso = new Date().toISOString();
    const currentPeriod = periodOf(Date.now());
    const periodArg = PERIOD_RE.test(String(body?.period || "")) ? String(body.period) : currentPeriod;

    // ปิดกระดาน/จำกัดคนดู ใช้ค่าเดิมใน settings.leaderboard (owner ดูได้เสมอ)
    const { data: lbRow } = await admin.from("settings").select("value").eq("key", "leaderboard").maybeSingle();
    const lb: any = lbRow?.value || {};
    if (!owner && lb.enabled === false) return json({ ok: false, error: "ปิดกระดานแต้มอยู่" }, 403);
    const viewers = Array.isArray(lb.emails) ? lb.emails.map((e: unknown) => String(e).toLowerCase().trim()).filter(Boolean) : [];
    if (!owner && viewers.length && !viewers.includes(me)) return json({ ok: false, error: "ไม่มีสิทธิ์ดูกระดานแต้ม" }, 403);

    const ownerOnly = () => (owner ? null : json({ ok: false, error: "เฉพาะเจ้าของระบบ (owner) เท่านั้น" }, 403));
    const logOwner = (event: string, detail: unknown) =>
      admin.from("activity_log").insert({ email: me, event, detail }).then(() => {}, () => {});
    const nicknames = async () => {
      const { data } = await admin.from("user_permissions").select("email, nickname");
      return Object.fromEntries((data || []).map((r: any) => [String(r.email).toLowerCase(), r.nickname || null]));
    };
    const periodRow = async (p: string) => (await admin.from("point_periods").select("*").eq("period", p).maybeSingle()).data;
    const eventsOf = (p: string, cols: string) => fetchAll((a, b) => admin.from("point_events").select(cols).eq("period", p).order("id").range(a, b));

    // ---------- ภาพรวมเดือน: อันดับ + แยกตามประเภท ----------
    if (action === "overview") {
      const [rows, pr, names, cfg, { data: periodsRows }, { count: openDisputes }] = await Promise.all([
        eventsOf(periodArg, "id, staff_email, kind, points, refund_of:evidence->>refund_of, regrade_of:evidence->>regrade_of"),
        periodRow(periodArg),
        nicknames(),
        loadPointConfig(admin),
        admin.from("point_periods").select("period, status").order("period", { ascending: false }).limit(36),
        admin.from("point_disputes").select("id", { count: "exact", head: true }).eq("period", periodArg).eq("status", "open"),
      ]);
      // แต้มที่ "คืน" ให้รายการที่เคยโดนตัด (evidence.refund_of) นับกลับเข้าหมวดของรายการเดิม
      // ไม่งั้นช่อง "ปรับ/หัก" จะดูเหมือนมีการปรับแต้มมือก้อนใหญ่ ทั้งที่เป็นแต้มตอบแชทปกติ
      // คืนแต้ม (refund_of) และคิดแต้มใหม่เพราะเปลี่ยนวันหยุด (regrade_of) เป็นส่วนหนึ่งของรายการเดิม
      const kindOf = new Map(rows.map((r: any) => [String(r.id), r.kind]));
      const linkOf = (r: any) => r.refund_of || r.regrade_of || null;
      const topped = new Map<string, number>();
      for (const r of rows) if (linkOf(r)) topped.set(String(linkOf(r)), (topped.get(String(linkOf(r))) || 0) + Number(r.points));
      const agg: Record<string, any> = {};
      let total = 0;
      for (const r of rows) {
        const who = String(r.staff_email);
        const a = (agg[who] = agg[who] || { email: who, name: names[who] || null, points: 0, count: 0, by_kind: Object.fromEntries(KINDS.map((k) => [k, 0])), zero: 0 });
        const pts = Number(r.points) || 0;
        const link = linkOf(r);
        const bucket = link && kindOf.get(String(link)) ? kindOf.get(String(link)) : r.kind;
        a.points += pts; a.by_kind[bucket] = (a.by_kind[bucket] || 0) + pts; total += pts;
        if (link) continue;                                          // ไม่นับเป็นรายการใหม่
        const effective = pts + (topped.get(String(r.id)) || 0);
        if (effective > 0) a.count++; else if (effective === 0) a.zero++;
      }
      const board = Object.values(agg).map((a: any) => ({
        ...a, points: round2(a.points), by_kind: Object.fromEntries(Object.entries(a.by_kind).map(([k, v]) => [k, round2(Number(v))])),
      })).sort((x: any, y: any) => y.points - x.points || y.count - x.count || String(x.email).localeCompare(String(y.email)));
      let hashOk: boolean | null = null;
      if (pr?.status === "closed" && pr.snapshot_hash) {
        const upto = rows.filter((r: any) => Number(r.id) <= Number(pr.last_event_id || 0));
        hashOk = (await sha256(ledgerFingerprint(upto))) === pr.snapshot_hash;
      }
      const periods = new Set<string>([currentPeriod, ...(periodsRows || []).map((r: any) => r.period)]);
      const { startMs, endMs } = periodRange(periodArg);
      return json({
        ok: true, period: periodArg, current_period: currentPeriod, me, is_owner: owner,
        status: pr?.status || "open", closed_at: pr?.closed_at || null, closed_by: pr?.closed_by || null, close_note: pr?.close_note || null,
        snapshot_hash: pr?.snapshot_hash || null, hash_ok: hashOk,
        board, total: round2(total), events: rows.length, open_disputes: openDisputes || 0,
        rules: { version: cfg.version, ...cfg.rules, slow_min: cfg.officeHours.slow_min, office_hours: cfg.officeHours, pages: cfg.pages },
        periods: [...periods].sort().reverse(),
        close_allowed_at: new Date(endMs + cfg.rules.dispute_days * 86400000).toISOString(),
        range: { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() },
      });
    }

    // ---------- รายการแต้มทุกแถวพร้อมหลักฐาน (ทุกคนเห็นของทุกคน) ----------
    if (action === "events") {
      const staff = body?.staff ? String(body.staff).toLowerCase() : null;
      const rows = await fetchAll((a, b) => {
        let q = admin.from("point_events")
          .select("id, staff_email, kind, points, occurred_at, period, rule_version, conversation_id, page_id, tv_access_id, reverses_event_id, dispute_id, evidence, note, created_at, created_by")
          .eq("period", periodArg).order("occurred_at", { ascending: false }).order("id", { ascending: false }).range(a, b);
        if (staff) q = q.eq("staff_email", staff);
        return q;
      }, 1000, 10);
      // รายการไหนถูกหักแต้มไปแล้ว (reversal อาจอยู่คนละเดือน ถ้าเดือนเดิมปิดยอดไปก่อน)
      const reversedBy: Record<string, number> = {};
      const ids = rows.filter((r: any) => r.kind !== "reversal" && Number(r.points) !== 0).map((r: any) => r.id);
      for (let i = 0; i < ids.length; i += 300) {
        const { data } = await admin.from("point_events").select("id, reverses_event_id").in("reverses_event_id", ids.slice(i, i + 300));
        for (const r of data || []) reversedBy[String(r.reverses_event_id)] = r.id;
      }
      // แต้มที่ปรับเข้ารายการเดิมภายหลัง: คืนแต้มที่เคยโดนตัดเพดาน (refund_of) · คิดใหม่เพราะเปลี่ยนวันหยุด (regrade_of)
      // อาจอยู่คนละเดือนกับรายการเดิม (ถ้าเดือนเดิมปิดยอดไปก่อน) จึงค้นด้วย id ไม่ใช่เดือน
      const refundedBy: Record<string, number> = {};
      const linked: Record<string, { id: number; points: number; reason: string; at: string }[]> = {};
      const replyIds = rows.filter((r: any) => r.kind === "reply_office" || r.kind === "reply_offhours").map((r: any) => String(r.id));
      for (const field of ["refund_of", "regrade_of"]) {
        for (let i = 0; i < replyIds.length; i += 300) {
          const { data } = await admin.from("point_events").select("id, points, evidence, created_at").eq("kind", "adjustment").in(`evidence->>${field}`, replyIds.slice(i, i + 300));
          for (const r of data || []) {
            const target = String(r.evidence?.[field]);
            if (field === "refund_of") refundedBy[target] = r.id;
            (linked[target] = linked[target] || []).push({ id: r.id, points: Number(r.points), reason: String(r.evidence?.reason || ""), at: r.created_at });
          }
        }
      }
      const { data: disputes } = await admin.from("point_disputes").select("id, event_id, status, staff_email").eq("period", periodArg).not("event_id", "is", null);
      const disputeOf: Record<string, any> = {};
      for (const d of disputes || []) if (!disputeOf[d.event_id] || d.status === "open") disputeOf[d.event_id] = d;
      return json({
        ok: true, period: periodArg, staff,
        events: rows.map((r: any) => {
          const adj = linked[String(r.id)] || [];
          return {
            ...r, points: Number(r.points), reversed_by: reversedBy[String(r.id)] || null, refunded_by: refundedBy[String(r.id)] || null,
            adjustments: adj, extra_points: round2(adj.reduce((s, a) => s + a.points, 0)), dispute: disputeOf[String(r.id)] || null,
          };
        }),
      });
    }

    // ---------- ยื่นโต้แย้ง (ของตัวเอง) ----------
    if (action === "file_dispute") {
      const reason = String(body?.reason || "").trim();
      if (reason.length < 5) return json({ ok: false, error: "เขียนเหตุผลให้ชัดเจนอย่างน้อย 5 ตัวอักษร" }, 400);
      const eventId = body?.event_id ? Number(body.event_id) : null;
      let period = periodArg;
      if (eventId) {
        const { data: ev } = await admin.from("point_events").select("id, period").eq("id", eventId).maybeSingle();
        if (!ev) return json({ ok: false, error: "ไม่พบรายการแต้มนี้" }, 404);
        period = ev.period;
        const { count } = await admin.from("point_disputes").select("id", { count: "exact", head: true })
          .eq("event_id", eventId).eq("staff_email", me).eq("status", "open");
        if (count) return json({ ok: false, error: "คุณยื่นโต้แย้งรายการนี้ไว้แล้ว รอ owner พิจารณา" }, 409);
      }
      const requested = body?.requested_points === undefined || body?.requested_points === null || body?.requested_points === ""
        ? null : Number(body.requested_points);
      if (requested !== null && (!Number.isFinite(requested) || Math.abs(requested) > 1000)) return json({ ok: false, error: "จำนวนแต้มที่ขอไม่ถูกต้อง" }, 400);
      const { data, error } = await admin.from("point_disputes").insert({
        event_id: eventId, period, staff_email: me, reason: reason.slice(0, 2000), requested_points: requested,
      }).select("id").single();
      if (error) throw error;
      return json({ ok: true, id: data.id });
    }

    // ---------- รายการคำร้อง: owner เห็นทั้งหมด คนอื่นเห็นของตัวเอง ----------
    if (action === "list_disputes") {
      let q = admin.from("point_disputes").select("*").order("created_at", { ascending: false }).limit(500);
      if (body?.period && PERIOD_RE.test(String(body.period))) q = q.eq("period", String(body.period));
      if (body?.status) q = q.eq("status", String(body.status));
      if (!owner) q = q.eq("staff_email", me);
      const { data, error } = await q;
      if (error) throw error;
      const ids = (data || []).map((d: any) => d.event_id).filter(Boolean);
      const evMap: Record<string, any> = {};
      for (let i = 0; i < ids.length; i += 300) {
        const { data: evs } = await admin.from("point_events").select("id, staff_email, kind, points, occurred_at, evidence, conversation_id").in("id", ids.slice(i, i + 300));
        for (const e of evs || []) evMap[String(e.id)] = { ...e, points: Number(e.points) };
      }
      return json({ ok: true, disputes: (data || []).map((d: any) => ({ ...d, requested_points: d.requested_points === null ? null : Number(d.requested_points), event: d.event_id ? evMap[String(d.event_id)] || null : null })) });
    }

    // ---------- ปฏิทินวันหยุด (ทุกคนดูได้) ----------
    if (action === "holidays_get") {
      const { data } = await admin.from("settings").select("value").eq("key", "office_hours").maybeSingle();
      const v: any = data?.value || {};
      const oh = normalizeOfficeHours(v);
      const names: Record<string, string> = v.holiday_names && typeof v.holiday_names === "object" ? v.holiday_names : {};
      const { data: closed } = await admin.from("point_periods").select("period").eq("status", "closed");
      return json({
        ok: true, days: oh.days, open: oh.open, close: oh.close, break_start: oh.break_start, break_end: oh.break_end,
        holidays: oh.holidays.slice().sort().map((d) => ({ date: d, name: names[d] || "" })),
        closed_periods: (closed || []).map((r: any) => r.period), today: thaiDateOf(Date.now()),
      });
    }

    // ---------- ประวัติกติกา (ทุกคนอ่านได้ — โปร่งใส) ----------
    if (action === "rules_history") {
      const { data } = await admin.from("point_rules").select("version, rules, note, created_at, created_by").order("version", { ascending: false }).limit(50);
      return json({ ok: true, versions: data || [] });
    }

    // ================= ต่อจากนี้เฉพาะ owner =================

    // เพิ่ม/แก้ชื่อ/ยกเลิกวันหยุด — ถ้าเป็นวันที่ผ่านมาแล้ว คิดแต้มของวันนั้นใหม่ให้อัตโนมัติ
    // (แต้มบันทึกตามวันหยุด ณ ตอนตอบ ถ้าตั้งวันหยุดย้อนหลังโดยไม่คิดใหม่ คนที่ทำงานวันนั้นจะเสียแต้ม)
    if (action === "holidays_update") {
      const deny = ownerOnly(); if (deny) return deny;
      const changes = (Array.isArray(body?.changes) ? body.changes : []).slice(0, 400)
        .map((c: any) => ({ date: String(c?.date || ""), name: String(c?.name || "").trim().slice(0, 80), on: c?.on !== false }))
        .filter((c: any) => DATE_RE.test(c.date));
      if (!changes.length) return json({ ok: false, error: "ไม่มีวันที่จะบันทึก" }, 400);
      const { data } = await admin.from("settings").select("value").eq("key", "office_hours").maybeSingle();
      const v: any = { ...(data?.value || {}) };
      const set = new Set<string>((Array.isArray(v.holidays) ? v.holidays : []).map((d: unknown) => String(d).slice(0, 10)));
      const names: Record<string, string> = { ...(v.holiday_names && typeof v.holiday_names === "object" ? v.holiday_names : {}) };
      const flipped: { date: string; on: boolean }[] = [];
      for (const c of changes) {
        const was = set.has(c.date);
        if (c.on) { set.add(c.date); if (c.name) names[c.date] = c.name; }
        else { set.delete(c.date); delete names[c.date]; }
        if (was !== c.on) flipped.push({ date: c.date, on: c.on });
      }
      v.holidays = [...set].sort();
      v.holiday_names = Object.fromEntries(Object.entries(names).filter(([d]) => set.has(d)));
      const { error: upErr } = await admin.from("settings").upsert({ key: "office_hours", value: v, updated_at: nowIso });
      if (upErr) throw upErr;

      // คิดแต้มใหม่เฉพาะวันที่ผ่านมาแล้ว และเดือนยังไม่ปิดยอด
      const today = thaiDateOf(Date.now());
      const past = flipped.filter((f) => f.date <= today);
      const regrade = { events: 0, adjusted: 0, points: 0, skipped_closed: 0 };
      if (past.length) {
        const oh = normalizeOfficeHours(v);
        const { data: ruleRows } = await admin.from("point_rules").select("version, rules");
        const rulesByVersion = new Map((ruleRows || []).map((r: any) => [Number(r.version), normalizeRules(r.rules)]));
        const latest = Math.max(0, ...[...rulesByVersion.keys()]);
        const { data: closedRows } = await admin.from("point_periods").select("period").eq("status", "closed");
        const closedSet = new Set((closedRows || []).map((r: any) => r.period));
        for (const f of past) {
          const dayStart = Date.parse(`${f.date}T00:00:00+07:00`);
          // คำตอบที่ลูกค้าทักหรือเราตอบในวันนั้น (ตอบข้ามวันได้ จึงดึงถึงวันถัดไป)
          const evs = await fetchAll((a, b) => admin.from("point_events")
            .select("id, staff_email, kind, points, period, rule_version, conversation_id, page_id, evidence")
            .in("kind", ["reply_office", "reply_offhours"])
            .gte("occurred_at", new Date(dayStart).toISOString()).lt("occurred_at", new Date(dayStart + 2 * 86400000).toISOString())
            .order("id").range(a, b));
          const hits = evs.filter((e: any) => {
            const ev = e.evidence || {};
            return (ev.msg_at && thaiDateOf(Date.parse(ev.msg_at)) === f.date) || (ev.reply_at && thaiDateOf(Date.parse(ev.reply_at)) === f.date);
          });
          if (!hits.length) continue;
          const ids = hits.map((e: any) => String(e.id));
          const extra = new Map<string, number>(), regradeCount = new Map<string, number>(), reversed = new Set<string>();
          for (let i = 0; i < ids.length; i += 300) {
            const chunk = ids.slice(i, i + 300);
            const [{ data: refunds }, { data: regrades }, { data: revs }] = await Promise.all([
              admin.from("point_events").select("points, evidence").eq("kind", "adjustment").in("evidence->>refund_of", chunk),
              admin.from("point_events").select("points, evidence").eq("kind", "adjustment").in("evidence->>regrade_of", chunk),
              admin.from("point_events").select("reverses_event_id").in("reverses_event_id", chunk),
            ]);
            for (const r of refunds || []) extra.set(String(r.evidence.refund_of), (extra.get(String(r.evidence.refund_of)) || 0) + Number(r.points));
            for (const r of regrades || []) {
              const t = String(r.evidence.regrade_of);
              extra.set(t, (extra.get(t) || 0) + Number(r.points));
              regradeCount.set(t, (regradeCount.get(t) || 0) + 1);
            }
            for (const r of revs || []) reversed.add(String(r.reverses_event_id));
          }
          const toInsert: any[] = [];
          for (const e of hits) {
            regrade.events++;
            if (reversed.has(String(e.id))) continue;                   // owner หักแต้มรายการนี้ไปแล้ว
            if (closedSet.has(e.period)) { regrade.skipped_closed++; continue; }
            const ev = e.evidence || {};
            if (!ev.msg_at || !ev.reply_at) continue;
            const rules = rulesByVersion.get(Number(e.rule_version)) || rulesByVersion.get(latest) || normalizeRules(null);
            const sc = scoreReply(Date.parse(ev.msg_at), Date.parse(ev.reply_at), { ...oh, slow_min: Number(ev.slow_min) || oh.slow_min }, rules);
            const effective = round2(Number(e.points) + (extra.get(String(e.id)) || 0));
            const diff = round2(sc.points - effective);
            if (diff === 0) continue;
            toInsert.push({
              staff_email: e.staff_email, kind: "adjustment", points: diff, occurred_at: nowIso,
              idem_key: `regrade:${e.id}:${regradeCount.get(String(e.id)) || 0}`, rule_version: e.rule_version,
              conversation_id: e.conversation_id, page_id: e.page_id,
              evidence: {
                reason: `${f.date} ${f.on ? "ตั้งเป็นวันหยุด" : "ยกเลิกวันหยุด"} — คิดแต้มรายการ #${e.id} ใหม่`, regrade_of: String(e.id),
                adjusts_period: e.period, from: effective, to: sc.points, slot_msg: sc.slot_msg, slot_reply: sc.slot_reply, holiday_date: f.date,
              },
              note: `คิดแต้มใหม่ (${f.on ? "เพิ่ม" : "ยกเลิก"}วันหยุด ${f.date})`, created_by: me,
            });
          }
          for (let i = 0; i < toInsert.length; i += 200) {
            const { data: ins, error } = await admin.from("point_events").upsert(toInsert.slice(i, i + 200), { onConflict: "idem_key", ignoreDuplicates: true }).select("points");
            if (error) throw error;
            for (const r of ins || []) { regrade.adjusted++; regrade.points = round2(regrade.points + Number(r.points)); }
          }
        }
      }
      logOwner("points_holidays_update", { changes, flipped, regrade });
      return json({ ok: true, holidays: v.holidays.map((d: string) => ({ date: d, name: v.holiday_names[d] || "" })), flipped, regrade });
    }

    if (action === "resolve_dispute") {
      const deny = ownerOnly(); if (deny) return deny;
      const id = Number(body?.id);
      const approve = body?.approve === true;
      const note = String(body?.note || "").trim();
      if (note.length < 3) return json({ ok: false, error: "ต้องใส่เหตุผลการพิจารณาให้คนยื่นเห็น" }, 400);
      const { data: d } = await admin.from("point_disputes").select("*").eq("id", id).maybeSingle();
      if (!d) return json({ ok: false, error: "ไม่พบคำร้อง" }, 404);
      if (d.status !== "open") return json({ ok: false, error: "คำร้องนี้พิจารณาไปแล้ว" }, 409);
      let adjustmentId: number | null = null;
      if (approve) {
        const pts = body?.points !== undefined && body?.points !== null && body?.points !== "" ? Number(body.points) : Number(d.requested_points);
        if (!Number.isFinite(pts) || Math.abs(pts) > 1000) return json({ ok: false, error: "ระบุจำนวนแต้มที่จะปรับ (บวก = เพิ่ม, ลบ = หัก)" }, 400);
        const target = String(body?.staff_email || d.staff_email).toLowerCase();
        if (pts !== 0) {
          const ev = await insertPointEvent(admin, {
            staff_email: target, kind: "adjustment", points: round2(pts), occurred_at: nowIso, idem_key: `dispute:${id}`,
            dispute_id: id, evidence: { dispute_id: id, reason: d.reason, decision: note, adjusts_period: d.period, event_id: d.event_id },
            note: `อนุมัติคำร้อง #${id}: ${note}`.slice(0, 500), created_by: me,
          });
          adjustmentId = ev?.id ?? null;
        }
      }
      const { error } = await admin.from("point_disputes").update({
        status: approve ? "approved" : "rejected", resolved_by: me, resolved_at: nowIso, resolution_note: note.slice(0, 2000), adjustment_event_id: adjustmentId,
      }).eq("id", id).eq("status", "open");
      if (error) throw error;
      logOwner("points_resolve_dispute", { id, approve, note, adjustment_event_id: adjustmentId });
      return json({ ok: true, adjustment_event_id: adjustmentId });
    }

    if (action === "adjust") {
      const deny = ownerOnly(); if (deny) return deny;
      const staff = String(body?.staff_email || "").toLowerCase().trim();
      const pts = Number(body?.points);
      const reason = String(body?.reason || "").trim();
      if (!staff.includes("@")) return json({ ok: false, error: "ระบุอีเมลพนักงาน" }, 400);
      if (!Number.isFinite(pts) || pts === 0 || Math.abs(pts) > 1000) return json({ ok: false, error: "ระบุจำนวนแต้ม (บวก = เพิ่ม, ลบ = หัก)" }, 400);
      if (reason.length < 5) return json({ ok: false, error: "ต้องใส่เหตุผลการปรับแต้ม" }, 400);
      const adjustsPeriod = PERIOD_RE.test(String(body?.adjusts_period || "")) ? String(body.adjusts_period) : null;
      const ev = await insertPointEvent(admin, {
        staff_email: staff, kind: "adjustment", points: round2(pts), occurred_at: nowIso, idem_key: `adjust:${crypto.randomUUID()}`,
        evidence: { reason, ...(adjustsPeriod ? { adjusts_period: adjustsPeriod } : {}) }, note: reason.slice(0, 500), created_by: me,
      });
      logOwner("points_adjust", { staff, points: pts, reason, adjusts_period: adjustsPeriod, event_id: ev?.id });
      return json({ ok: true, id: ev?.id ?? null });
    }

    // หักแต้มรายการที่ผิด (เช่น ได้แต้มจากบัญชีเทส) — เพิ่ม reversal ติดลบ ไม่ลบของเดิม
    if (action === "reverse") {
      const deny = ownerOnly(); if (deny) return deny;
      const eventId = Number(body?.event_id);
      const reason = String(body?.reason || "").trim();
      if (reason.length < 5) return json({ ok: false, error: "ต้องใส่เหตุผลการหักแต้ม" }, 400);
      const { data: ev } = await admin.from("point_events").select("id, staff_email, points, kind, conversation_id, tv_access_id").eq("id", eventId).maybeSingle();
      if (!ev) return json({ ok: false, error: "ไม่พบรายการแต้ม" }, 404);
      if (ev.kind === "reversal") return json({ ok: false, error: "รายการนี้เป็นการหักแต้มอยู่แล้ว" }, 400);
      if (Number(ev.points) === 0) return json({ ok: false, error: "รายการนี้ 0 แต้ม ไม่มีอะไรให้หัก" }, 400);
      const out = await insertPointEvent(admin, {
        staff_email: ev.staff_email, kind: "reversal", points: -Number(ev.points), occurred_at: nowIso, idem_key: `reverse:${ev.id}`,
        reverses_event_id: ev.id, conversation_id: ev.conversation_id, tv_access_id: ev.tv_access_id,
        evidence: { reason, reversed_kind: ev.kind }, note: reason.slice(0, 500), created_by: me,
      });
      if (!out) return json({ ok: false, error: "รายการนี้ถูกหักแต้มไปแล้ว" }, 409);
      logOwner("points_reverse", { event_id: ev.id, staff: ev.staff_email, points: ev.points, reason });
      return json({ ok: true, id: out.id });
    }

    if (action === "close_period") {
      const deny = ownerOnly(); if (deny) return deny;
      const p = String(body?.period || "");
      if (!PERIOD_RE.test(p)) return json({ ok: false, error: "ระบุเดือน" }, 400);
      if (p >= currentPeriod) return json({ ok: false, error: "ปิดได้เฉพาะเดือนที่จบไปแล้ว" }, 400);
      const cfg = await loadPointConfig(admin);
      const allowAt = periodRange(p).endMs + cfg.rules.dispute_days * 86400000;
      const force = body?.force === true;
      const note = String(body?.note || "").trim();
      if (Date.now() < allowAt && !force) {
        return json({ ok: false, error: `ยังอยู่ในช่วงยื่นโต้แย้ง ปิดได้ตั้งแต่ ${new Date(allowAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}` }, 400);
      }
      const { count: openCount } = await admin.from("point_disputes").select("id", { count: "exact", head: true }).eq("period", p).eq("status", "open");
      if (openCount && !force) return json({ ok: false, error: `ยังมีคำร้องค้าง ${openCount} รายการ — พิจารณาให้ครบก่อน` }, 400);
      if (force && note.length < 5) return json({ ok: false, error: "ปิดแบบข้ามเงื่อนไขต้องใส่หมายเหตุ" }, 400);
      const rows = await eventsOf(p, "id, staff_email, kind, points, refund_of:evidence->>refund_of, regrade_of:evidence->>regrade_of");
      const names = await nicknames();
      const kindOf = new Map(rows.map((r: any) => [String(r.id), r.kind]));
      const snap: Record<string, any> = {};
      for (const r of rows) {
        const who = String(r.staff_email);
        const s = (snap[who] = snap[who] || { email: who, name: names[who] || null, points: 0, by_kind: {} as Record<string, number>, events: 0 });
        const link = r.refund_of || r.regrade_of;
        const bucket = link && kindOf.get(String(link)) ? kindOf.get(String(link)) : r.kind;
        s.points = round2(s.points + Number(r.points)); s.by_kind[bucket] = round2((s.by_kind[bucket] || 0) + Number(r.points)); s.events++;
      }
      const board = Object.values(snap).sort((a: any, b: any) => b.points - a.points);
      const hash = await sha256(ledgerFingerprint(rows));
      const lastId = rows.reduce((m: number, r: any) => Math.max(m, Number(r.id)), 0);
      const { error } = await admin.from("point_periods").upsert({
        period: p, status: "closed", closed_at: nowIso, closed_by: me, close_note: note || null,
        snapshot: { board, total: round2(rows.reduce((s: number, r: any) => s + Number(r.points), 0)), events: rows.length, rule_version: cfg.version, forced: force, open_disputes: openCount || 0 },
        snapshot_hash: hash, last_event_id: lastId,
      }, { onConflict: "period" });
      if (error) return json({ ok: false, error: /ปิดยอดแล้ว/.test(error.message) ? `เดือน ${p} ปิดยอดไปแล้ว` : error.message }, 400);
      logOwner("points_close_period", { period: p, hash, events: rows.length, forced: force, note });
      return json({ ok: true, period: p, snapshot_hash: hash, events: rows.length, board });
    }

    if (action === "rules_set") {
      const deny = ownerOnly(); if (deny) return deny;
      const v = validateRules(body?.rules);
      if (!v.ok) return json({ ok: false, error: v.error }, 400);
      const note = String(body?.note || "").trim();
      if (note.length < 3) return json({ ok: false, error: "บอกเหตุผลที่เปลี่ยนกติกา (ทุกคนจะเห็น)" }, 400);
      const { data: last } = await admin.from("point_rules").select("version").order("version", { ascending: false }).limit(1).maybeSingle();
      const version = (Number(last?.version) || 0) + 1;
      const { error } = await admin.from("point_rules").insert({ version, rules: v.rules, note: note.slice(0, 500), created_by: me });
      if (error) throw error;
      logOwner("points_rules_set", { version, note });
      return json({ ok: true, version });
    }

    // ย้อนบันทึกแต้มของเดือนจากข้อมูลระบบเดิม (reply_stats / tv_access) — รันซ้ำได้ ไม่นับซ้ำ (idem_key เดียวกับระบบจริง)
    if (action === "backfill") {
      const deny = ownerOnly(); if (deny) return deny;
      const p = String(body?.period || "");
      if (!PERIOD_RE.test(p)) return json({ ok: false, error: "ระบุเดือน" }, 400);
      const pr = await periodRow(p);
      if (pr?.status === "closed") return json({ ok: false, error: "เดือนนี้ปิดยอดแล้ว" }, 400);
      const cfg = await loadPointConfig(admin);
      const { startMs, endMs } = periodRange(p);
      const startIso = new Date(startMs).toISOString(), endIso = new Date(endMs).toISOString();

      // --- ตอบแชท ---
      // คำตอบเดียวกันมีได้สองแถว (แอปบันทึกตอนส่ง + cron สร้างจาก transcript) แต่เวลา "ตอบ" ตรงกันเป๊ะ
      // จึงรวมด้วย ห้อง + เวลาที่ตอบ แล้วเลือกแถวของแอป (เวลาเริ่มรอบตรงกับที่ระบบจริงใช้)
      const stats = await fetchAll((a, b) => admin.from("reply_stats")
        .select("email, conversation_id, page_id, page_name, customer_name, msg_at, replied_at, source")
        .gte("replied_at", startIso).lt("replied_at", endIso).not("msg_at", "is", null).order("replied_at").range(a, b));
      const byReply = new Map<string, any>();
      for (const r of stats) {
        const key = `${r.conversation_id}|${new Date(r.replied_at).getTime()}`;
        const prev = byReply.get(key);
        if (!prev || (prev.source && !r.source)) byReply.set(key, r);
      }
      const existing = await eventsOf(p, "conversation_id, kind, points, occurred_at");
      const capCount = new Map<string, number>();
      const ck = (conv: string, ms: number, kind: string) => `${conv}|${thaiDateOf(ms)}|${kind}`;
      for (const e of existing) if (e.conversation_id && Number(e.points) > 0) {
        const k = ck(e.conversation_id, new Date(e.occurred_at).getTime(), e.kind);
        capCount.set(k, (capCount.get(k) || 0) + 1);
      }
      const unattributed: any[] = [];
      const toInsert: any[] = [];
      let skippedPages = 0, skippedExcluded = 0, zero = 0;
      for (const r of [...byReply.values()].sort((a, b) => String(a.replied_at).localeCompare(String(b.replied_at)))) {
        if (cfg.pages.length && !cfg.pages.includes(String(r.page_id || ""))) { skippedPages++; continue; }
        if (isExcludedCustomer(cfg.officeHours, r.customer_name, r.conversation_id)) { skippedExcluded++; continue; }
        const msgMs = new Date(r.msg_at).getTime(), replyMs = new Date(r.replied_at).getTime();
        const s = scoreReply(msgMs, replyMs, cfg.officeHours, cfg.rules);
        if (s.points <= 0) { zero++; continue; }
        const staff = String(r.email || "").toLowerCase().trim();
        if (!staff) { unattributed.push({ conversation_id: r.conversation_id, customer_name: r.customer_name, msg_at: r.msg_at, replied_at: r.replied_at, points: s.points }); continue; }
        const k = ck(r.conversation_id, replyMs, s.kind);
        const used = capCount.get(k) || 0;
        const capped = overCap(used, capFor(s.kind, cfg.rules));
        if (!capped) capCount.set(k, used + 1);
        toInsert.push({
          staff_email: staff, kind: s.kind, points: capped ? 0 : s.points, occurred_at: r.replied_at,
          idem_key: replyIdemKey(r.conversation_id, msgMs), rule_version: cfg.version, conversation_id: r.conversation_id, page_id: r.page_id,
          evidence: {
            backfill: true, msg_at: r.msg_at, reply_at: r.replied_at, wait_min: s.wait_min, in_time: s.in_time, slow_min: cfg.officeHours.slow_min,
            slot_msg: s.slot_msg, slot_reply: s.slot_reply, used: s.used, full_points: s.points, ...(capped ? { capped: true } : {}),
            customer_name: r.customer_name ?? null, page_name: r.page_name ?? null,
          },
          created_by: `backfill:${me}`,
        });
      }

      // --- TradingView: คนให้สิทธิ์ต้องระบุตัวได้ (อีเมล หรือชื่อเล่นที่ตรงกับ user_permissions คนเดียว) ---
      const { data: perms } = await admin.from("user_permissions").select("email, nickname");
      const byNick = new Map<string, string[]>();
      for (const u of perms || []) if (u.nickname) byNick.set(String(u.nickname).trim(), [...(byNick.get(String(u.nickname).trim()) || []), String(u.email).toLowerCase()]);
      const emailOf = (email: unknown, nick: unknown) => {
        if (email) return String(email).toLowerCase();
        const n = String(nick || "").trim();
        const hit = byNick.get(n) || (n.includes("@") ? [n.toLowerCase()] : []);
        return hit.length === 1 ? hit[0] : null;
      };
      const tvRows = await fetchAll((a, b) => admin.from("tv_access")
        .select("id, username, pine_id, granted_by, granted_by_email, granted_at, edited_by, edited_by_email, renewed_at, expiration, tv_access_verified")
        .or(`and(granted_at.gte.${startIso},granted_at.lt.${endIso}),and(renewed_at.gte.${startIso},renewed_at.lt.${endIso})`)
        .order("id").range(a, b));
      const tvUnattributed: any[] = [];
      for (const t of tvRows) {
        const gMs = t.granted_at ? new Date(t.granted_at).getTime() : 0;
        if (gMs >= startMs && gMs < endMs && !String(t.granted_by || "").includes("ย้อนหลัง")) {
          const staff = emailOf(t.granted_by_email, t.granted_by);
          if (!staff) tvUnattributed.push({ kind: "tv_grant", username: t.username, pine_id: t.pine_id, by: t.granted_by, at: t.granted_at });
          else if (cfg.rules.tv.grant > 0) toInsert.push({
            staff_email: staff, kind: "tv_grant", points: cfg.rules.tv.grant, occurred_at: t.granted_at,
            idem_key: `tv_grant:${String(t.username).toLowerCase()}:${t.pine_id}`, rule_version: cfg.version, tv_access_id: t.id,
            evidence: { backfill: true, username: t.username, pine_id: t.pine_id, granted_by: t.granted_by }, created_by: `backfill:${me}`,
          });
        }
        const rMs = t.renewed_at ? new Date(t.renewed_at).getTime() : 0;
        if (rMs >= startMs && rMs < endMs) {
          const staff = emailOf(t.edited_by_email, t.edited_by);
          if (!staff) tvUnattributed.push({ kind: "tv_renew", username: t.username, pine_id: t.pine_id, by: t.edited_by, at: t.renewed_at });
          else if (cfg.rules.tv.renew > 0) toInsert.push({
            staff_email: staff, kind: "tv_renew", points: cfg.rules.tv.renew, occurred_at: t.renewed_at,
            idem_key: `tv_renew:${t.id}:${p}`, rule_version: cfg.version, tv_access_id: t.id,
            evidence: { backfill: true, username: t.username, pine_id: t.pine_id, edited_by: t.edited_by, expiration_after: t.expiration }, created_by: `backfill:${me}`,
          });
        }
      }

      let inserted = 0;
      for (let i = 0; i < toInsert.length; i += 200) {
        const { data, error } = await admin.from("point_events").upsert(toInsert.slice(i, i + 200), { onConflict: "idem_key", ignoreDuplicates: true }).select("id");
        if (error) throw error;
        inserted += (data || []).length;
      }
      logOwner("points_backfill", { period: p, candidates: toInsert.length, inserted, unattributed: unattributed.length, tv_unattributed: tvUnattributed.length });
      return json({
        ok: true, period: p, reply_rows: stats.length, unique_replies: byReply.size, candidates: toInsert.length, inserted,
        already_recorded: toInsert.length - inserted, skipped_pages: skippedPages, skipped_excluded: skippedExcluded, zero_points: zero,
        unattributed: unattributed.slice(0, 200), unattributed_count: unattributed.length,
        tv_unattributed: tvUnattributed.slice(0, 200), tv_unattributed_count: tvUnattributed.length,
      });
    }

    return json({ ok: false, error: `ไม่รู้จัก action: ${action}` }, 400);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
