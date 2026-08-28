// supabase/functions/leaderboard/index.ts
// กระดานแต้ม (Leaderboard) — แต้มพิเศษจากการ "ตอบแชทนอกเวลาทำการ" ต่อผู้ใช้
// เห็นได้ทุกคนที่ล็อกอิน (ไม่จำกัด admin) — เพจที่นับถูกล็อกโดยแอดมินในตั้งค่า (settings.leaderboard.pages)
// อ่านอย่างเดียวจาก reply_stats — ไม่แตะ logic/นับใหม่
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const TZ_MS = 7 * 3600 * 1000;
const toMin = (s: string) => { const [h, m] = String(s || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
function thai(tMs: number) { const t = new Date(tMs + TZ_MS); return { day: t.getUTCDay(), min: t.getUTCHours() * 60 + t.getUTCMinutes() + t.getUTCSeconds() / 60 }; }
const thaiDateStr = (tMs: number) => new Date(tMs + TZ_MS).toISOString().slice(0, 10);
const holidaySet = (cfg: any): Set<string> => new Set((Array.isArray(cfg?.holidays) ? cfg.holidays : []).map((d: any) => String(d).slice(0, 10)));

// ตารางแต้ม (เหมือนหน้าสถิติ) — [ทันเวลา, ช้ากว่า] ตามช่วงเวลา×วันหยุด
function offPoints(minOfDay: number, isHoliday: boolean, inTime: boolean): number {
  const R = (a: number, b: number) => minOfDay >= a * 60 && minOfDay < b * 60;
  let p: [number, number] = [0, 0];
  if (isHoliday) {
    if (R(9, 17)) p = [2, 1]; else if (R(17, 20)) p = [4, 2]; else if (R(20, 24)) p = [8, 4];
    else if (R(0, 5)) p = [16, 12]; else if (R(5, 9)) p = [8, 4];
  } else {
    if (R(12, 13)) p = [1, 0.5]; else if (R(17, 20)) p = [2, 1]; else if (R(20, 24)) p = [4, 2];
    else if (R(0, 5)) p = [8, 6]; else if (R(5, 9)) p = [4, 2];
  }
  return inTime ? p[0] : p[1];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const auth = await authorizeRequest(req);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const body = await req.json().catch(() => ({}));
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: ohRow } = await admin.from("settings").select("value").eq("key", "office_hours").maybeSingle();
    const cfg: any = { days: [1, 2, 3, 4, 5], open: "09:00", close: "17:00", break_start: "12:00", break_end: "13:00", slow_min: 5, ...(ohRow?.value || {}) };
    const slowMin = Math.max(1, Number(cfg.slow_min) || 5);
    const holidays = holidaySet(cfg);
    const exclude = (Array.isArray(cfg.exclude) ? cfg.exclude : []).map((x: any) => String(x).toLowerCase().trim()).filter(Boolean);

    // เพจที่นับ — แอดมินตั้งใน settings.leaderboard.pages (ว่าง = ทุกเพจ)
    const { data: lbRow } = await admin.from("settings").select("value").eq("key", "leaderboard").maybeSingle();
    const lbPages: string[] = Array.isArray(lbRow?.value?.pages) ? lbRow.value.pages.map(String) : [];
    if (lbRow?.value?.enabled === false) return json({ ok: false, error: "ปิดกระดานแต้มอยู่" }, 403);
    const allowedEmails = Array.isArray(lbRow?.value?.emails)
      ? lbRow.value.emails.map((email: unknown) => String(email).toLowerCase().trim()).filter(Boolean)
      : [];
    if (allowedEmails.length && !allowedEmails.includes(auth.permission!.email.toLowerCase())) {
      return json({ ok: false, error: "ไม่มีสิทธิ์ดูกระดานแต้ม" }, 403);
    }
    const permittedPages = auth.permission!.role === "admin"
      ? lbPages
      : (lbPages.length
        ? lbPages.filter((pageId) => auth.permission!.allowedPages.includes(pageId))
        : auth.permission!.allowedPages);
    if (auth.permission!.role !== "admin" && !permittedPages.length) {
      return json({ ok: true, board: [], total: 0, rows: 0 });
    }

    const since = body?.since ? new Date(body.since + "T00:00:00+07:00").toISOString() : new Date(Date.now() - 7 * 86400000).toISOString();
    const until = body?.until ? new Date(body.until + "T23:59:59+07:00").toISOString() : new Date().toISOString();

    const agg: Record<string, any> = {};
    let total = 0;
    let scannedRows = 0;
    const PAGE_SIZE = 1000; // PostgREST อาจจำกัดผลลัพธ์ต่อคำขอ แม้ระบุ limit สูงกว่านี้
    const MAX_PAGES = 200;

    const aggregateRow = (r: any) => {
      if (!r.msg_at || !r.replied_at || r.source === "missed") return;   // เฉพาะรอบที่ตอบแล้ว
      // ตัดบัญชีเทส
      if (exclude.length && exclude.some((e) => (r.customer_name && String(r.customer_name).toLowerCase().includes(e)) || (r.conversation_id && String(r.conversation_id).toLowerCase() === e))) return;
      const s = new Date(r.msg_at).getTime();
      const info = thai(s);
      const inOffice = cfg.days.includes(info.day) && !holidays.has(thaiDateStr(s)) &&
        info.min >= toMin(cfg.open) && info.min < toMin(cfg.close) &&
        !(cfg.break_start && cfg.break_end && info.min >= toMin(cfg.break_start) && info.min < toMin(cfg.break_end));
      if (inOffice) return;   // แต้มเฉพาะนอกเวลาทำการ
      const wm = Math.max(0, (new Date(r.replied_at).getTime() - s) / 60000);
      const isHoliday = !cfg.days.includes(info.day) || holidays.has(thaiDateStr(s));
      const pts = offPoints(info.min, isHoliday, wm <= slowMin);
      if (pts <= 0) return;
      const who = r.replied_by || r.email || (r.source === "page" ? "(ตอบจากเพจ)" : "(ไม่ระบุ)");
      const a = (agg[who] = agg[who] || { email: who, points: 0, count: 0, in_time: 0, slow: 0 });
      a.points += pts; a.count++; if (wm <= slowMin) a.in_time++; else a.slow++;
      total += pts;
    };

    // ต้องแบ่งหน้าเอง มิฉะนั้น Supabase จะคืนมาเฉพาะแถวใหม่สุดประมาณ 1,000 แถว
    // ซึ่งในช่วงที่แชทหนาแน่นครอบคลุมเพียงราว 3 วัน ทำให้ 3/7/14 วันได้คะแนนเท่ากัน
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      let q = admin.from("reply_stats")
        .select("replied_by, email, source, customer_name, conversation_id, page_id, msg_at, replied_at")
        .gte("msg_at", since).lte("msg_at", until)
        .order("msg_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (permittedPages.length) q = q.in("page_id", permittedPages);
      const { data: pageRows, error } = await q;
      if (error) throw error;
      const rows = pageRows ?? [];
      scannedRows += rows.length;
      for (const row of rows) aggregateRow(row);
      if (rows.length < PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) throw new Error("ข้อมูลกระดานแต้มมีมากเกินขีดจำกัดที่รองรับ");
    }
    const board = Object.values(agg).map((a: any) => ({ ...a, points: Math.round(a.points * 10) / 10 })).sort((x: any, y: any) => y.points - x.points);
    return json({ ok: true, total: Math.round(total * 10) / 10, board, since, until, rows: scannedRows });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
