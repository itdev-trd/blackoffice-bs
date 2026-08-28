// supabase/functions/reply-stats/index.ts
// สรุปสถิติการตอบแชท (เฉพาะ admin) — ต่อ user × เพจ: จำนวนตอบ, เฉลี่ย (นับเฉพาะเวลาทำการ), ตอบช้าเกิน X นาทีกี่ครั้ง
// + ฮิสโตแกรมรายชั่วโมง (เวลาไทย) ว่าตอบช้าช่วงไหนบ่อย
// เวลาทำการอ่านจาก settings.office_hours: {days:[1-5], open:"09:00", close:"17:00", break_start, break_end, slow_min}
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const TZ_MS = 7 * 3600 * 1000; // ไทย UTC+7

const toMin = (s: string) => { const [h, m] = String(s || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
// แปลงเป็น "เวลาไทย": คืน { day: 0-6 (อาทิตย์=0), min: นาทีในวัน, dayStartUtc: ms }
function thai(tMs: number) {
  const t = new Date(tMs + TZ_MS);
  return { day: t.getUTCDay(), min: t.getUTCHours() * 60 + t.getUTCMinutes() + t.getUTCSeconds() / 60, hour: t.getUTCHours() };
}
// วันที่แบบไทย (YYYY-MM-DD) — ใช้เทียบกับรายการวันหยุดพิเศษ
const thaiDateStr = (tMs: number) => new Date(tMs + TZ_MS).toISOString().slice(0, 10);
// รายการวันหยุดพิเศษจาก settings.office_hours.holidays (เช่น สงกรานต์ ปีใหม่ วันหยุดชดเชย)
const holidaySet = (cfg: any): Set<string> =>
  new Set((Array.isArray(cfg?.holidays) ? cfg.holidays : []).map((d: any) => String(d).slice(0, 10)));

// นาทีทำการที่ผ่านไประหว่าง start→end (หักวันหยุดประจำสัปดาห์/วันหยุดพิเศษ/นอกเวลา/พักเบรก) — เดินทีละวัน
function bizMinutes(startMs: number, endMs: number, cfg: any): number {
  if (endMs <= startMs) return 0;
  const days: number[] = Array.isArray(cfg.days) && cfg.days.length ? cfg.days : [1, 2, 3, 4, 5];
  const open = toMin(cfg.open || "09:00"), close = toMin(cfg.close || "17:00");
  const bs = cfg.break_start ? toMin(cfg.break_start) : null, be = cfg.break_end ? toMin(cfg.break_end) : null;
  const holidays = holidaySet(cfg);
  let total = 0;
  // จุดเริ่มของ "วันไทย" ที่ครอบ startMs
  let dayStart = Math.floor((startMs + TZ_MS) / 86400000) * 86400000 - TZ_MS;
  for (let guard = 0; guard < 400 && dayStart < endMs; guard++, dayStart += 86400000) {
    const info = thai(dayStart + 12 * 3600 * 1000); // กลางวันของวันนั้น เอาไว้ดู day-of-week
    if (!days.includes(info.day)) continue;
    if (holidays.has(thaiDateStr(dayStart))) continue;   // วันหยุดพิเศษ — ไม่นับเป็นเวลาทำการ
    // ช่วงทำการของวันนี้ (ms)
    const winStart = dayStart + open * 60000, winEnd = dayStart + close * 60000;
    const s = Math.max(startMs, winStart), e = Math.min(endMs, winEnd);
    if (e <= s) continue;
    let mins = (e - s) / 60000;
    // หักพักเบรกส่วนที่ทับ
    if (bs != null && be != null && be > bs) {
      const brS = dayStart + bs * 60000, brE = dayStart + be * 60000;
      const os = Math.max(s, brS), oe = Math.min(e, brE);
      if (oe > os) mins -= (oe - os) / 60000;
    }
    total += Math.max(0, mins);
  }
  return total;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const auth = await authorizeRequest(req, { admin: true });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const body = await readJsonBody(req, 64 * 1024);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: cfgRow } = await admin.from("settings").select("value").eq("key", "office_hours").maybeSingle();
    const cfg: any = { days: [1, 2, 3, 4, 5], open: "09:00", close: "17:00", break_start: "12:00", break_end: "13:00", slow_min: 5, ...(cfgRow?.value || {}) };
    const slowMin = Math.max(1, Number(body?.slow_min ?? cfg.slow_min) || 5);
    const holidays = holidaySet(cfg);   // วันหยุดพิเศษ (ตั้งในหน้าสถิติการตอบแชท)
    // โหมด "นับทุกวัน 24 ชม." — ไม่กรองวัน/เวลา/วันหยุด และคิดเวลาตอบจาก "เวลาจริง" (wall-clock) ไม่หักนอกเวลา
    const allHoursMode = cfg.mode === "24_7";
    const elapsedMin = (a: number, b: number) => allHoursMode ? Math.max(0, (b - a) / 60000) : bizMinutes(a, b, cfg);

    const since = body?.since ? new Date(body.since + "T00:00:00+07:00").toISOString() : new Date(Date.now() - 30 * 86400000).toISOString();
    const until = body?.until ? new Date(body.until + "T23:59:59+07:00").toISOString() : new Date().toISOString();

    // กรองด้วย msg_at (เวลาที่ลูกค้าทัก) ไม่ใช่ replied_at — เพราะรอบที่ "ยังไม่มีใครตอบ" ไม่มี replied_at
    // และการนับ "จำนวนการแจ้งเตือนของแต่ละวัน" ต้องยึดวันที่ลูกค้าทักเข้ามา
    const pageFilter: string[] | null = Array.isArray(body?.pages) && body.pages.length ? body.pages.map(String) : null;
    let q = admin.from("reply_stats")
      .select("email, replied_by, source, conversation_id, customer_name, page_id, page_name, msg_at, replied_at, response_ms, read_at, is_unread, is_closing")
      .gte("msg_at", since).lte("msg_at", until)
      .order("msg_at", { ascending: false }).limit(20000);
    if (pageFilter) q = q.in("page_id", pageFilter);
    const { data: rows, error } = await q;
    if (error) throw error;

    // ตัดลูกค้าที่ไม่ต้องการนับสถิติ (บัญชีเทส) — จับจากชื่อ (มีคำนี้อยู่) หรือ conversation_id ตรงกัน
    const exclude = (Array.isArray(cfg.exclude) ? cfg.exclude : []).map((x: any) => String(x).toLowerCase().trim()).filter(Boolean);
    const isExcluded = (r: any) => exclude.length > 0 && exclude.some((e) =>
      (r.customer_name && String(r.customer_name).toLowerCase().includes(e)) ||
      (r.conversation_id && String(r.conversation_id).toLowerCase() === e));

    // สรุปต่อ user × เพจ + ฮิสโตแกรมชั่วโมง (นับเฉพาะข้อความลูกค้าที่มาใน "เวลาทำการ" เพื่อความแฟร์)
    const agg: Record<string, any> = {};
    const byUser: Record<string, any> = {};   // สรุปต่อ "ผู้ใช้" รวมทุกเพจ (จำนวนรอบ/เฉลี่ย/ช้า)
    const offAgg: Record<string, any> = {};   // ช่วงนอกเวลา/พัก/วันหยุด แยกต่อผู้ใช้ (ใช้เวลาจริง wall-clock)
    const byDay: Record<string, any> = {};    // วันไทย × เพจ → จำนวนแจ้งเตือน/ตอบแล้ว/ช้า/ยังไม่ตอบ
    const slowHours = new Array(24).fill(0);
    const allHours = new Array(24).fill(0);
    const evidence: any[] = [];               // รายการแชทรายตัว ไว้ลิสต์เป็นหลักฐาน
    let counted = 0, skipped = 0, unanswered = 0, unreadNow = 0, readSlowTotal = 0, closedByCustomer = 0, missedTotal = 0;
    let offTotal = 0, offAnswered = 0, offSum = 0;   // สรุปช่วงนอกเวลาทำการ (เวลาจริง)
    const pointAgg: Record<string, any> = {};        // แต้มพิเศษต่อผู้ใช้ (ตอบนอกเวลาทำการ)
    let totalPoints = 0;
    // ตารางแต้ม: [ทันเวลา, ช้ากว่า] ตามช่วงเวลา (นาทีในวัน เวลาไทย)
    function offPoints(minOfDay: number, isHoliday: boolean, inTime: boolean): number {
      const inRange = (a: number, b: number) => minOfDay >= a * 60 && minOfDay < b * 60;
      let p: [number, number] = [0, 0];
      if (isHoliday) {
        if (inRange(9, 17)) p = [2, 1];
        else if (inRange(17, 20)) p = [4, 2];
        else if (inRange(20, 24)) p = [8, 4];
        else if (inRange(0, 5)) p = [16, 12];
        else if (inRange(5, 9)) p = [8, 4];
      } else {
        if (inRange(12, 13)) p = [1, 0.5];
        else if (inRange(17, 20)) p = [2, 1];
        else if (inRange(20, 24)) p = [4, 2];
        else if (inRange(0, 5)) p = [8, 6];
        else if (inRange(5, 9)) p = [4, 2];
      }
      return inTime ? p[0] : p[1];
    }

    let excluded = 0;
    for (const r of rows ?? []) {
      if (!r.msg_at) { skipped++; continue; }
      if (isExcluded(r)) { excluded++; continue; }   // บัญชีเทส — ไม่นับทุกสถิติ
      const s = new Date(r.msg_at).getTime();
      const info = thai(s);
      const days: number[] = cfg.days;
      const inOffice = allHoursMode || (                  // โหมด 24 ชม. = นับทุกแชทเสมอ
        days.includes(info.day) &&
        !holidays.has(thaiDateStr(s)) &&                 // ลูกค้าทักในวันหยุดพิเศษ = ไม่นับ
        info.min >= toMin(cfg.open) && info.min < toMin(cfg.close) &&
        !(cfg.break_start && cfg.break_end && info.min >= toMin(cfg.break_start) && info.min < toMin(cfg.break_end)));
      if (!inOffice) {
        // ลูกค้าทักนอกเวลาทำการ/พัก/วันหยุด — ไม่นับในค่าเฉลี่ยหลัก แต่ "แยกวิเคราะห์" ด้วยเวลาจริง (wall-clock) + คิดแต้มพิเศษ
        skipped++; offTotal++;
        const owho = r.replied_by || r.email || (r.source === "page" ? "(ตอบจากเพจ)" : "(ไม่ระบุ)");
        const oa = (offAgg[owho] = offAgg[owho] || { email: owho, count: 0, answered: 0, sum: 0 });
        oa.count++;
        if (r.replied_at && r.source !== "missed") {
          const wm = Math.max(0, (new Date(r.replied_at).getTime() - s) / 60000);   // เวลาจริงที่ใช้ตอบ (นาที)
          oa.answered++; oa.sum += wm; offAnswered++; offSum += wm;
          // แต้มพิเศษ: ตอบนอกเวลาทำการ (ทัน 3 นาที = แต้มเต็ม, ช้ากว่า = ครึ่ง) ตามช่วงเวลา×วันหยุด
          const isHoliday = !days.includes(info.day) || holidays.has(thaiDateStr(s));
          const pts = offPoints(info.min, isHoliday, wm <= slowMin);
          if (pts > 0) {
            const pa = (pointAgg[owho] = pointAgg[owho] || { email: owho, points: 0, count: 0, in_time: 0, slow: 0 });
            pa.points += pts; pa.count++; if (wm <= slowMin) pa.in_time++; else pa.slow++;
            totalPoints += pts;
          }
        }
        continue;
      }

      // วันที่ (เวลาไทย) ของ "ตอนลูกค้าทัก" — ใช้เป็นแกนรายวัน
      const dayKey = new Date(s + TZ_MS).toISOString().slice(0, 10);
      const dk = `${dayKey}|${r.page_id || "?"}`;
      const d = (byDay[dk] = byDay[dk] || {
        day: dayKey, page_id: r.page_id, page_name: r.page_name || r.page_id,
        alerts: 0, answered: 0, slow: 0, unanswered: 0, closed: 0, sum: 0,
        read_slow: 0, unread: 0, read_sum: 0, read_count: 0,
      });
      allHours[info.hour]++;

      // ลูกค้าปิดบทสนทนาเอง (ขอบคุณ/ไลก์) = ไม่ใช่ความผิดพลาด ไม่นับเป็นรอบที่ต้องตอบ
      if (r.source === "closed" || (!r.replied_at && r.is_closing)) {
        closedByCustomer++; d.closed++;
        evidence.push({
          conversation_id: r.conversation_id, customer_name: r.customer_name, page_id: r.page_id, page_name: r.page_name || r.page_id,
          msg_at: r.msg_at, replied_at: null, minutes: null, slow: false, answered: false, is_closing: true,
          by: null, source: "closed", day: dayKey, read_at: r.read_at || null, read_minutes: null, is_unread: !!r.is_unread,
        });
        continue;
      }

      d.alerts++;   // 1 รอบการรอ = 1 ครั้งที่ต้องตอบ

      // รอบ "missed" = ลูกค้าทักซ้ำหลังเงียบเกิน (slow_min×2) ก่อนแอดมินตอบ → นับเป็นรอบ + ช้าทันที (ไม่มีเวลาตอบ)
      if (r.source === "missed") {
        missedTotal++; d.slow++; slowHours[info.hour]++;
        evidence.push({
          conversation_id: r.conversation_id, customer_name: r.customer_name, page_id: r.page_id, page_name: r.page_name || r.page_id,
          msg_at: r.msg_at, replied_at: null, minutes: null, slow: true, answered: false, is_closing: false,
          by: null, source: "missed", day: dayKey, read_at: r.read_at || null, read_minutes: null, is_unread: !!r.is_unread,
        });
        continue;
      }

      // ---- สถิติ "การอ่าน" (คนละเรื่องกับการตอบ — อ่านแล้วอาจยังไม่ตอบ) ----
      let readMins: number | null = null;
      if (r.read_at) {
        const rd = new Date(r.read_at).getTime();
        if (rd >= s) { readMins = elapsedMin(s, rd); d.read_count++; d.read_sum += readMins; if (readMins > slowMin) d.read_slow++; }
      }
      if (r.is_unread) { d.unread++; unreadNow++; }
      if (readMins != null && readMins > slowMin) readSlowTotal++;

      const answered = !!r.replied_at;
      const mins = answered ? elapsedMin(s, new Date(r.replied_at).getTime()) : null;

      if (!answered) {
        // ยังไม่มีใครตอบ (รอบล่าสุดที่ค้างอยู่) — ช้าถ้ารอเกินเกณฑ์แล้ว (เวลาทำการ)
        unanswered++; d.unanswered++;
        const overdue = elapsedMin(s, Date.now()) > slowMin;
        if (overdue) { d.slow++; slowHours[info.hour]++; }
        evidence.push({
          conversation_id: r.conversation_id, customer_name: r.customer_name,
          page_id: r.page_id, page_name: r.page_name || r.page_id,
          msg_at: r.msg_at, replied_at: null, minutes: null, slow: overdue, answered: false, is_closing: false,
          by: null, source: "unanswered", day: dayKey,
          read_at: r.read_at || null, read_minutes: readMins, is_unread: !!r.is_unread,
        });
        continue;
      }

      counted++; d.answered++; d.sum += mins!;
      const isSlow = mins! > slowMin;
      if (isSlow) { d.slow++; slowHours[info.hour]++; }

      // สรุปต่อคน × เพจ (ของเดิม) — ตอบจากกล่องข้อความเพจจะไม่รู้ว่าใครตอบ จึงจัดกลุ่มเป็น "ตอบจากเพจ"
      const who = r.replied_by || r.email || (r.source === "page" ? "(ตอบจากเพจ)" : "(ไม่ระบุ)");
      const key = `${who}|${r.page_id || "?"}`;
      const a = (agg[key] = agg[key] || { email: who, page_id: r.page_id, page_name: r.page_name || r.page_id, count: 0, sum: 0, slow: 0, fastest: Infinity, slowest: 0 });
      a.count++; a.sum += mins!;
      a.fastest = Math.min(a.fastest, mins!); a.slowest = Math.max(a.slowest, mins!);
      if (isSlow) a.slow++;

      // สรุปต่อ "ผู้ใช้" รวมทุกเพจ
      const bu = (byUser[who] = byUser[who] || { email: who, count: 0, sum: 0, slow: 0, fastest: Infinity, slowest: 0, pages: new Set<string>() });
      bu.count++; bu.sum += mins!; if (isSlow) bu.slow++;
      bu.fastest = Math.min(bu.fastest, mins!); bu.slowest = Math.max(bu.slowest, mins!);
      if (r.page_id) bu.pages.add(String(r.page_id));

      evidence.push({
        conversation_id: r.conversation_id, customer_name: r.customer_name,
        page_id: r.page_id, page_name: r.page_name || r.page_id,
        msg_at: r.msg_at, replied_at: r.replied_at, minutes: mins, slow: isSlow, answered: true,
        by: who, source: r.source || "app", day: dayKey,
        read_at: r.read_at || null, read_minutes: readMins, is_unread: !!r.is_unread,
      });
    }

    const stats = Object.values(agg).map((a: any) => ({
      email: a.email, page_id: a.page_id, page_name: a.page_name,
      count: a.count, slow: a.slow,
      avg_min: a.count ? a.sum / a.count : 0,
      fastest_min: a.count ? a.fastest : 0, slowest_min: a.slowest,
    })).sort((x: any, y: any) => (x.email + x.page_name).localeCompare(y.email + y.page_name));

    // สรุปต่อผู้ใช้ (รวมทุกเพจ) — เรียงจำนวนรอบมากสุดก่อน
    const users = Object.values(byUser).map((u: any) => ({
      email: u.email, count: u.count, slow: u.slow, pages: u.pages.size,
      avg_min: u.count ? u.sum / u.count : 0, fastest_min: u.count ? u.fastest : 0, slowest_min: u.slowest,
    })).sort((x: any, y: any) => y.count - x.count);

    // ช่วงนอกเวลา/พัก/วันหยุด — ต่อผู้ใช้ (เวลาจริง)
    const offUsers = Object.values(offAgg).map((o: any) => ({
      email: o.email, count: o.count, answered: o.answered, unanswered: o.count - o.answered,
      avg_min: o.answered ? o.sum / o.answered : 0,
    })).sort((x: any, y: any) => y.count - x.count);

    // แต้มพิเศษต่อผู้ใช้ (ตอบนอกเวลาทำการ) — เรียงแต้มมากสุดก่อน
    const points = Object.values(pointAgg).map((p: any) => ({
      email: p.email, points: Math.round(p.points * 10) / 10, count: p.count, in_time: p.in_time, slow: p.slow,
    })).sort((x: any, y: any) => y.points - x.points);

    const daily = Object.values(byDay).map((d: any) => ({
      ...d, avg_min: d.answered ? d.sum / d.answered : 0,
      avg_read_min: d.read_count ? d.read_sum / d.read_count : null,
    })).sort((x: any, y: any) => (y.day + y.page_name).localeCompare(x.day + x.page_name));

    // เรียงตามเวลาล่าสุดก่อน (เรียงจริงให้ผู้ใช้เลือกเองที่หน้าเว็บ)
    // เดิมเรียงเอา "ช้าสุด" ขึ้นก่อน พอโดนตัดเหลือ 1,000 แถว ข้อมูลเดือนเก่าจึงหายหมดเมื่อเลือกช่วงยาว
    evidence.sort((a, b) => new Date(b.msg_at).getTime() - new Date(a.msg_at).getTime());

    return json({
      ok: true, stats, users, daily, missed: missedTotal,
      off: { total: offTotal, answered: offAnswered, unanswered: offTotal - offAnswered, avg_min: offAnswered ? offSum / offAnswered : 0, by_user: offUsers },
      points: { total: Math.round(totalPoints * 10) / 10, by_user: points },
      evidence: evidence.slice(0, 5000),   // เพดานสูงพอสำหรับช่วง 3 เดือน
      evidence_total: evidence.length,
      slow_hours: slowHours, all_hours: allHours,
      counted, skipped, excluded, unanswered, closed_by_customer: closedByCustomer, unread_now: unreadNow, read_slow: readSlowTotal,
      slow_min: slowMin, office: cfg, since, until,
    });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
