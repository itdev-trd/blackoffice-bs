// supabase/functions/rebuild-reply-stats/index.ts
// สรุป "รอบการรอ" (ลูกค้าทัก → แอดมินตอบครั้งแรก) จาก transcript จริงของทุกแชท แล้วเก็บลง reply_stats
//
// ทำไมต้องมี: ของเดิมบันทึกสถิติเฉพาะตอนกดส่งผ่านเว็บแอป ถ้าพนักงานตอบจากกล่องข้อความเพจโดยตรงจะไม่ถูกนับเลย
// transcript ใน chat_customers มีข้อความทั้งสองฝั่ง (ข้อความที่ตอบจากเพจเข้ามาทาง webhook echo) จึงคำนวณย้อนหลังได้ครบ
//
// body { pages?: string[], limit?: number, since_days?: number }
// deploy: supabase functions deploy rebuild-reply-stats
// ตั้ง cron ให้รันทุกชั่วโมงได้ (ไม่เรียก Meta/AI เลย จึงเบามาก)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// อ่านข้อความ error ให้เป็นข้อความจริงเสมอ — error ของ Postgres/PostgREST เป็น "ออบเจ็กต์ธรรมดา" ไม่ใช่ Error
// ถ้าใช้ String(err) ตรงๆ จะได้ "[object Object]" แล้วสาเหตุจริงหายไปหมด (ดีบั๊กไม่ได้เลย)
function errMsg(e: any): string {
  if (!e) return "unknown";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  const parts = [e.message, e.details, e.hint, e.code ? `(code ${e.code})` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : JSON.stringify(e);
}

type Round = {
  round_key: string; conversation_id: string; page_id: string | null; page_name: string | null;
  customer_name: string | null; msg_at: string; replied_at: string | null;
  response_ms: number | null; source: string; replied_by: string | null; email: string | null;
  read_at: string | null; is_unread: boolean; is_closing: boolean;
};

// ---- "ลูกค้าปิดบทสนทนาเอง" ----
// เคสจริง: แอดมินตอบครบแล้ว ลูกค้าพิมพ์ "ขอบคุณครับ" หรือกดไลก์ปิดท้าย แล้วไม่มีใครตอบต่อ (ซึ่งถูกต้อง)
// ถ้าไม่แยกออก จะถูกนับเป็น "ยังไม่ตอบ" ค้างตลอดไป ทำให้สถิติดูแย่เกินจริง
//
// เงื่อนไขที่ถือว่าปิดบทสนทนา (ต้องครบทุกข้อ):
//   1) เพจเคยตอบมาก่อนแล้วในแชทนี้ — ถ้าเป็นข้อความแรกสุดของลูกค้า ยังไงก็ต้องตอบ
//   2) ทุกข้อความในรอบนี้เป็นสติกเกอร์/ไลก์ หรือเป็นข้อความสั้นที่ตรงกับ "คำปิดท้าย"
//   3) ไม่มีเครื่องหมายคำถาม และไม่ยาว — กันเคส "ขอบคุณครับ แล้วต้องทำยังไงต่อ?"
const DEFAULT_CLOSING = [
  "ขอบคุณ", "ขอบใจ", "ครับ", "ค่ะ", "คับ", "จ้า", "โอเค", "ตกลง", "รับทราบ", "เข้าใจแล้ว",
  "thank", "thanks", "tq", "ok", "okay", "noted", "got it", "alright", "sure",
  "salamat", "sige", "opo", "terima kasih", "makasih", "oke", "baik", "siap", "cảm ơn",
];
// คำลงท้ายสุภาพ — ตัดทิ้งก่อนตรวจ (ภาษาไทยแทบทุกประโยคมี "ครับ/ค่ะ")
const POLITE = ["ครับผม", "คร้าบ", "ครับ", "คับ", "ค่ะ", "คะ", "ค๊า", "จ้า", "จ้าา", "จ๊ะ", "นะ", "น่ะ", "เลย", "แล้ว",
  "po", "opo", "ya", "sir", "maam", "ka", "krub", "kub",
  // คำเสริมที่ไม่มีความหมายเชิงคำถาม — ตัดทิ้งได้ ("ขอบคุณมากครับ", "thank you")
  "มากๆ", "มาก", "เยอะ", "you", "u", "very", "much", "so", "na", "din", "rin"];

function isClosingMsg(m: any, closingWords: string[]): boolean {
  if (m?.sticker === true) return true;                        // ไลก์/สติกเกอร์
  const raw = String(m?.t || "").trim();
  if (!raw) return false;
  if (raw === "[สติกเกอร์/ไลก์]") return true;
  if (/[?？]/.test(raw)) return false;                          // มีคำถาม = ต้องตอบ
  if (raw.length > 40) return false;                            // ยาว = น่าจะมีเนื้อหา

  // ตัดเครื่องหมาย/ช่องว่างออกก่อน
  let s = raw.toLowerCase().replace(/[\s.!~ๆฯ,;:)(“”"'\-_]/g, "");
  if (!s) return true;
  if (!/[\p{L}\p{N}]/u.test(s)) return true;                    // อีโมจิล้วน เช่น 🙏 👍

  // "กินคำ" ที่เป็นคำปิดท้าย + คำลงท้ายสุภาพออกจากข้อความ แล้วดูว่าเหลืออะไรไหม
  // ต้องทำแบบนี้เพราะภาษาไทยไม่มีช่องว่างแยกคำ — ถ้าใช้ includes เฉยๆ
  // "สมัครยังไงครับ" จะถูกมองว่าปิดบทสนทนา เพราะมีคำว่า "ครับ" อยู่ข้างใน
  const words = [...closingWords, ...POLITE]
    .map((w) => String(w || "").toLowerCase().replace(/\s/g, ""))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);   // คำยาวก่อน กันคำสั้นกินคำยาว
  let changed = true;
  for (let guard = 0; guard < 20 && changed && s; guard++) {
    changed = false;
    for (const w of words) {
      if (s.includes(w)) { s = s.split(w).join(""); changed = true; }
    }
  }
  // ไม่เหลือตัวอักษร/ตัวเลขที่มีความหมาย = เป็นข้อความปิดบทสนทนาล้วน
  return !/[\p{L}\p{N}]/u.test(s);
}

// แยก transcript เป็น "รอบการรอ" ด้วยเกณฑ์ใหม่:
//  - ลูกค้าทักครั้งแรก = เริ่มรอบ (จับเวลาจากข้อความแรก)
//  - ระหว่างรอ ถ้าลูกค้าเงียบเกิน gap (= slow_min × 2) แล้วทักใหม่ = ปิดรอบเดิมเป็น "missed" (พลาด/นับช้า) + เปิดรอบใหม่
//  - แอดมินตอบ = ปิดรอบ (answered) แล้วรอบถัดไปเริ่มเมื่อลูกค้าทักอีก
//  - ข้อความติดกันภายใน gap = รอบเดียวกัน
// slowMin = เกณฑ์ตอบช้า (นาที) ใช้คำนวณ gap = slowMin*2
function extractRounds(row: any, closingWords: string[], slowMin: number): Round[] {
  const tr = Array.isArray(row.transcript) ? row.transcript : [];
  const out: Round[] = [];
  const GAP = Math.max(1, slowMin) * 2 * 60000;   // เงียบเกินเท่านี้แล้วทักใหม่ = รอบใหม่
  let open: { start: string; last: string; msgs: any[] } | null = null;
  let pageRepliedBefore = false;
  const push = (start: string, repliedAt: string | null, source: string, by: string | null) => {
    const s = new Date(start).getTime();
    out.push({
      round_key: `${row.id}|${s}`,
      conversation_id: row.id, page_id: row.page_id ?? null, page_name: row.page_name ?? null,
      customer_name: row.customer_name ?? null,
      msg_at: start, replied_at: repliedAt, response_ms: repliedAt ? Math.max(0, new Date(repliedAt).getTime() - s) : null,
      source, replied_by: by, email: by,
      read_at: null, is_unread: false, is_closing: source === "closed",
    });
  };
  for (const m of tr) {
    if (!m?.at) { if (m?.w === "p" && open) open = null; continue; }  // ตอบแต่ไม่รู้เวลา → ปิดรอบทิ้ง (วัดไม่ได้)
    if (m.w === "u") {
      if (!open) { open = { start: String(m.at), last: String(m.at), msgs: [m] }; }
      else {
        const gap = new Date(m.at).getTime() - new Date(open.last).getTime();
        if (gap > GAP) { push(open.start, null, "missed", null); open = { start: String(m.at), last: String(m.at), msgs: [m] }; }  // ทักซ้ำหลังเงียบนาน = รอบใหม่ (รอบเก่าพลาด)
        else { open.last = String(m.at); open.msgs.push(m); }
      }
    } else if (m.w === "p") {
      pageRepliedBefore = true;
      if (open) { push(open.start, String(m.at), m.by ? "app" : "page", m.by ? String(m.by) : null); open = null; }
    }
  }
  // ค้างท้าย = ลูกค้าทักแล้วยังไม่มีใครตอบ
  if (open) {
    const closing = pageRepliedBefore && open.msgs.length > 0 && open.msgs.every((m) => isClosingMsg(m, closingWords));
    push(open.start, null, closing ? "closed" : "unanswered", null);
  }

  // ---- ผูก "เวลาที่เปิดอ่าน" เข้ากับรอบที่ถูกต้อง ----
  // chat_customers เก็บ read_at ไว้ค่าเดียว (ครั้งล่าสุด) จึงรู้เวลาอ่านได้เฉพาะรอบที่ครอบเวลานั้น
  // รอบที่ msg_at <= read_at < msg_at ของรอบถัดไป = รอบที่ถูกอ่าน ณ เวลานั้น
  const readMs = row.read_at ? new Date(row.read_at).getTime() : null;
  if (readMs) {
    for (let i = 0; i < out.length; i++) {
      const s = new Date(out[i].msg_at).getTime();
      const nextS = i + 1 < out.length ? new Date(out[i + 1].msg_at).getTime() : Infinity;
      if (readMs >= s && readMs < nextS) { out[i].read_at = row.read_at; break; }
    }
  }
  // รอบล่าสุดยังไม่ถูกอ่าน (สถานะปัจจุบันจากกล่องข้อความ)
  if (row.unread === true && out.length) out[out.length - 1].is_unread = true;
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const auth = await authorizeRequest(req, { admin: true, setting: "replystats", allowService: true });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const body = await req.json().catch(() => ({}));
    const pages: string[] | null = Array.isArray(body?.pages) && body.pages.length ? body.pages.map(String) : null;
    const sinceDays = Math.min(365, Math.max(1, Number(body?.since_days) || 60));
    const pageSize = Math.min(500, Math.max(50, Number(body?.limit) || 300));
    const sinceIso = new Date(Date.now() - sinceDays * 86400000).toISOString();

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const deadline = Date.now() + 120000;

    // คำที่ถือว่า "ลูกค้าปิดบทสนทนาเอง" — ตั้งเองได้ที่ settings.office_hours.closing_words
    const { data: ohRow } = await admin.from("settings").select("value").eq("key", "office_hours").maybeSingle();
    const cw = (ohRow?.value as any)?.closing_words;
    const closingWords: string[] = Array.isArray(cw) && cw.length ? cw.map(String) : DEFAULT_CLOSING;
    const slowMin = Math.max(1, Number((ohRow?.value as any)?.slow_min) || 3);   // ใช้คำนวณ gap = slowMin×2

    let scanned = 0, rounds = 0, saved = 0, cleaned = 0, from = 0;
    let done = true;
    for (let batch = 0; batch < 50; batch++) {
      if (Date.now() > deadline) { done = false; break; }
      let q = admin.from("chat_customers")
        .select("id, page_id, page_name, customer_name, transcript, read_at, unread")
        .gte("last_message_at", sinceIso)
        .order("last_message_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (pages) q = q.in("page_id", pages);
      const { data, error } = await q;
      if (error) throw new Error(`อ่าน chat_customers ไม่สำเร็จ: ${errMsg(error)}`);
      const list = data ?? [];
      if (!list.length) break;
      scanned += list.length;
      from += pageSize;

      // กันคีย์ซ้ำภายในก้อนเดียวกัน — Postgres ปฏิเสธถ้า upsert แถวคีย์เดียวกัน 2 ครั้งในคำสั่งเดียว
      // ("ON CONFLICT DO UPDATE command cannot affect row a second time")
      // เกิดได้ถ้าแถวเดิมถูกดึงซ้ำจากการแบ่งหน้า เมื่อ last_message_at ซ้ำกันพอดี
      const seen = new Set<string>();
      const all: Round[] = [];
      for (const r of list) {
        for (const x of extractRounds(r, closingWords, slowMin)) {
          if (seen.has(x.round_key)) continue;
          seen.add(x.round_key);
          all.push(x);
        }
      }
      rounds += all.length;

      // upsert ทีละก้อน — ชนคีย์ round_key = อัปเดตทับ (เช่นรอบที่เคยค้าง ตอนนี้มีคนตอบแล้ว)
      for (let i = 0; i < all.length; i += 500) {
        const chunk = all.slice(i, i + 500);
        const { error: upErr } = await admin.from("reply_stats").upsert(chunk, { onConflict: "round_key" });
        if (upErr) throw new Error(`บันทึก reply_stats ไม่สำเร็จ: ${errMsg(upErr)} — รัน supabase-migration-reply-stats-v2.sql แล้วหรือยัง?`);
        saved += chunk.length;
      }

      // ---- ลบ "ซากรอบเก่า" ที่คำนวณผิดไว้ ----
      // upsert อย่างเดียวไม่พอ: ถ้าตรรกะเปลี่ยน (เช่นตอนนี้เห็นข้อความรูปแล้ว รอบถูกแบ่งใหม่)
      // รอบเก่าที่ไม่มีอยู่จริงแล้วจะค้างในตารางตลอดไป → ยอดรวมเกินจริง (เคส 55 → 87)
      //
      // วิธี: ดึงคีย์ที่มีอยู่ของแชทชุดนี้มาเทียบใน memory แล้วลบทีเดียว (2 คำสั่ง/ก้อน)
      // ถ้าไล่ลบทีละแชทจะเป็น 300 คำสั่ง/ก้อน ช้าจนไม่ทัน deadline
      const convIds = list.map((r: any) => r.id);
      // ขอบเขตเวลาที่ transcript ของแต่ละแชท "มองเห็น" — เก่ากว่านี้เก็บไว้ เพราะเป็นประวัติที่ตรวจสอบไม่ได้แล้ว
      const firstAtByConv: Record<string, number> = {};
      for (const r of list) {
        const tr = Array.isArray(r.transcript) ? r.transcript : [];
        const f = tr.find((m: any) => m?.at)?.at;
        if (f) firstAtByConv[r.id] = new Date(f).getTime();
      }
      const { data: existing, error: exErr } = await admin.from("reply_stats")
        .select("round_key, conversation_id, msg_at")
        .in("conversation_id", convIds);
      if (exErr) console.warn("อ่านรอบเดิมไม่สำเร็จ:", errMsg(exErr));
      else {
        const newKeys = new Set(all.map((x) => x.round_key));
        const stale = (existing ?? [])
          .filter((e: any) => {
            if (!e.round_key || newKeys.has(e.round_key)) return false;      // ยังมีอยู่จริง
            const lim = firstAtByConv[e.conversation_id];
            if (!lim || !e.msg_at) return false;                             // ไม่รู้ขอบเขต = ไม่แตะ
            return new Date(e.msg_at).getTime() >= lim;                      // อยู่ในช่วงที่ตรวจสอบได้ = เป็นซาก
          })
          .map((e: any) => e.round_key);
        for (let i = 0; i < stale.length; i += 300) {
          const { error: delErr } = await admin.from("reply_stats").delete().in("round_key", stale.slice(i, i + 300));
          if (delErr) console.warn("ลบซากรอบเก่าไม่สำเร็จ:", errMsg(delErr));
          else cleaned += Math.min(300, stale.length - i);
        }
      }
      if (list.length < pageSize) break;
    }

    return json({ ok: true, scanned, rounds, saved, cleaned, done, since_days: sinceDays });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: errMsg(err) }, 500);
  }
});
