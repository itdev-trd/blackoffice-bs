// ดึงคู่ "ลูกค้าถาม → แอดมินตอบ" จากแชท BeSight ลง chat_qa_pairs (ขั้นแรกของ AI ช่วยร่างคำตอบ)
// cron ทุก 10 นาที (scheduled_jobs chat_qa_extract) หรือ owner/admin เรียกเอง
//   body: { max_chats?: number (ค่าเริ่ม 100), reset?: true = เริ่มอ่านใหม่ตั้งแต่ห้องแรก, stats?: true = แค่ดูสรุป, rebuild?: true = รวบแพทเทิร์นใหม่ทันที }
// อ่านทีละ 20 ห้อง เรียงตาม last_message_at จากตัวชี้ใน settings.chat_qa_extract_cursor
//   ห้องที่มีข้อความใหม่ last_message_at ขยับ → ถูกอ่านซ้ำเองรอบถัดไป · upsert ตาม (chat_id, q_at) จึงไม่ซ้ำ
// ขอบเขต: เพจ BeSight + LINE OA BeSight เท่านั้น (CLAUDE.md) · ไม่เอาคอมเมนต์ (เป็นสาธารณะ ไม่ใช่บทสนทนา)
// ฐานข้อมูล micro: อ่าน transcript ทีละไม่กี่ห้อง เว้นจังหวะ ไม่สแกนทั้งตาราง
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { extractQaPairs } from "../_shared/chat-qa.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const PAGES = ["438134449376109", "line:U548349abdb0b1b38b650bbbf3f64a78d"];
const CURSOR_KEY = "chat_qa_extract_cursor";
const BATCH = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const auth = await authorizeRequest(req, { admin: true, allowService: true });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const body = await req.json().catch(() => ({}));
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (body?.stats === true) {
      const { count } = await db.from("chat_qa_pairs").select("id", { count: "exact", head: true });
      const { data: cur } = await db.from("settings").select("value").eq("key", CURSOR_KEY).maybeSingle();
      return json({ ok: true, pairs: count ?? 0, cursor: cur?.value ?? null });
    }

    let cursor = "1970-01-01T00:00:00Z";
    if (body?.reset !== true) {
      const { data: cur } = await db.from("settings").select("value").eq("key", CURSOR_KEY).maybeSingle();
      if ((cur?.value as any)?.at) cursor = String((cur!.value as any).at);
    }
    const maxChats = Math.min(400, Math.max(1, Number(body?.max_chats) || 100));
    const started = Date.now();
    let chats = 0, pairs = 0, errors = 0;
    while (chats < maxChats && Date.now() - started < 40_000) {
      const { data: rows, error } = await db.from("chat_customers")
        .select("id, page_id, source, last_message_at, transcript")
        .in("page_id", PAGES).not("id", "like", "fbc_%").or("source.is.null,source.neq.comment")
        .gt("last_message_at", cursor).order("last_message_at", { ascending: true }).limit(BATCH);
      if (error) return json({ ok: false, error: error.message, chats, pairs });
      if (!rows?.length) break;
      const nowIso = new Date().toISOString();
      const out: any[] = [];
      for (const r of rows) {
        for (const p of extractQaPairs(r.transcript)) {
          out.push({ chat_id: r.id, page_id: r.page_id, source: r.source ?? null, ...p, updated_at: nowIso });
        }
      }
      // ห้องเดียวกันอาจมีคำถามเวลาซ้ำกัน (ข้อความเข้ามาวินาทีเดียวกัน) — ตัดซ้ำก่อน upsert ไม่งั้นทั้งชุดล้ม
      const uniq = [...new Map(out.map((p) => [`${p.chat_id}|${p.q_at}`, p])).values()];
      for (let i = 0; i < uniq.length; i += 200) {
        const { error: upErr } = await db.from("chat_qa_pairs").upsert(uniq.slice(i, i + 200), { onConflict: "chat_id,q_at" });
        if (upErr) { errors++; console.error("chat_qa_pairs upsert", upErr.message); }
      }
      chats += rows.length; pairs += uniq.length;
      cursor = String(rows[rows.length - 1].last_message_at);
      await db.from("settings").upsert({ key: CURSOR_KEY, value: { at: cursor, updated: nowIso }, updated_at: nowIso });
      if (rows.length < BATCH) break;
      await new Promise((r) => setTimeout(r, 300));   // เว้นจังหวะให้ฐานข้อมูล
    }
    // รวบแพทเทิร์นซ้ำ (chat_qa_patterns) — อ่านแค่ chat_qa_pairs · ทำเมื่อมีคู่ใหม่ และไม่ถี่กว่า 30 นาที (หรือสั่ง rebuild: true)
    let patterns: number | null = null;
    const { data: meta } = await db.from("settings").select("value").eq("key", "chat_qa_patterns_rebuilt").maybeSingle();
    const lastRebuild = Date.parse(String((meta?.value as any)?.at || "")) || 0;
    if (body?.rebuild === true || (pairs > 0 && Date.now() - lastRebuild > 30 * 60_000)) {
      const { data: n, error: rbErr } = await db.rpc("rebuild_chat_qa_patterns");
      if (rbErr) console.error("rebuild_chat_qa_patterns", rbErr.message);
      else {
        patterns = Number(n) || 0;
        const at = new Date().toISOString();
        await db.from("settings").upsert({ key: "chat_qa_patterns_rebuilt", value: { at, patterns }, updated_at: at });
      }
    }
    return json({ ok: true, chats, pairs, errors, cursor, patterns });
  } catch (e) {
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
