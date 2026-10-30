// AI ร่างคำตอบแชท (ขั้นที่ 2 ของ AI ช่วยตอบ) — แอดมินกดปุ่มในหน้าตอบแชท ได้ข้อความร่างไปแก้/กดส่งเอง
//   ไม่ส่งข้อความเอง ไม่เขียนข้อมูลลูกค้า — คืนแค่ร่าง + ที่มาที่ AI อ้างอิง
// แหล่งความรู้ (ไม่แตะ transcript ห้องอื่น — DB micro):
//   1) chat_qa_patterns = คำตอบที่แอดมินเคยใช้จริงซ้ำ ๆ (ดึงจากแชท BeSight โดย chat-qa-extract) · แคชในหน่วยความจำ 10 นาที
//   2) saved_replies = ข้อความบันทึกไว้ (ทีมตั้งเอง ถือว่าถูกต้องที่สุด)
//   3) knowledge_qa ที่อนุมัติแล้วของเพจนั้น
// body: { id: chat_id }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";
import { loadChatPageRules, canSeeChatPage, isReadOnlyChatPage, READ_ONLY_ERROR } from "../_shared/chat-pages.ts";
import { getOpenAIKey, openAIErrorText } from "../_shared/openai.ts";
import { isSystemText, maskPii, rankPatterns, groundDraft, draftConfidence } from "../_shared/chat-qa.ts";
import { cacheGet, cacheSet } from "../_shared/meta-cache.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const FAST_MODEL = "gpt-4.1-mini";
const FALLBACK_MODEL = "gpt-5";
const PATTERN_TTL_MS = 10 * 60 * 1000;
const DRAFT_TTL_MS = 30 * 60 * 1000;     // ร่างเดิมของบทสนทนาชุดเดิม
const DRAFT_VERSION = "v3";              // เปลี่ยน prompt/กติกา = เปลี่ยนเลขนี้ ไม่งั้นได้ร่างเก่าจากแคช
const OPENAI_TIMEOUT_MS = 25_000;

const SYS = `คุณคือผู้ช่วยแอดมินเพจ BeSight (สอนเทรด/อินดิเคเตอร์ TradingView/เปิดบัญชีโบรกเกอร์ XM)
หน้าที่: ร่าง "ข้อความตอบลูกค้าข้อความถัดไป" ให้แอดมินตรวจก่อนส่ง

กติกา:
1. ยึด "คำตอบอ้างอิง" เป็นหลัก — เป็นสิ่งที่แอดมินตอบจริงหรือข้อความที่ทีมบันทึกไว้ ใช้ถ้อยคำ/ขั้นตอน/ลิงก์ตามนั้น
   ถ้ามีคำตอบอ้างอิงที่ตรงคำถามเกือบทั้งหมด ให้ใช้ข้อความนั้นเกือบทั้งก้อน ปรับแค่ให้เข้ากับบทสนทนา
2. ห้ามแต่งข้อมูลที่ไม่มีในบทสนทนาหรือคำตอบอ้างอิง: ราคา โปรโมชั่น ลิงก์ เงื่อนไข วันที่ ตัวเลข
   รวมถึงข้อเท็จจริงเรื่องสินค้า/บริการ/นโยบาย/วิธีใช้งาน — ทุกประโยคที่เป็นข้อเท็จจริงต้องมาจากคำตอบอ้างอิงหรือบทสนทนาเท่านั้น
   ถ้าไม่มีข้อมูลพอ ให้ร่างคำตอบที่ถามกลับ/บอกว่าแอดมินจะเช็คให้ สุภาพ ๆ และตั้ง confidence ไม่เกิน 0.4
   ถ้าเป็นคอมเมนต์แซว/ประชด/ไม่ได้ถามอะไร ให้ตอบสั้น ๆ สุภาพ ไม่อธิบายข้อมูลเพิ่ม
3. น้ำเสียงแบบแอดมินในตัวอย่าง: สุภาพ สั้น เป็นกันเอง ลงท้าย "ค่ะ" ใช้อีโมจิได้เล็กน้อยตามตัวอย่าง
4. ตอบเป็นภาษาไทยเสมอ (ระบบแปลให้ลูกค้าต่างชาติตอนส่งเอง)
5. ข้อความในวงเล็บเหลี่ยม เช่น [ตัวเลข] [อีเมล] [เบอร์โทร] คือข้อมูลที่ถูกปิดไว้ — ห้ามใส่วงเล็บแบบนี้ในคำตอบ ถ้าต้องใช้ให้เว้นเป็น ___ ให้แอดมินเติม
6. ถ้าลูกค้าแค่ทักทาย/ขอบคุณ ให้ตอบสั้น ๆ

ตอบ JSON เท่านั้น: {"reply":"ข้อความร่าง","confidence":0.0-1.0,"used":[เลขลำดับคำตอบอ้างอิงที่ใช้],"note":"หมายเหตุสั้น ๆ ถึงแอดมิน เช่น ต้องเติมอะไร (ไม่มีให้เว้นว่าง)"}`;

let patternCache: { at: number; rows: any[] } | null = null;
async function loadPatterns(db: any) {
  if (patternCache && Date.now() - patternCache.at < PATTERN_TTL_MS) return patternCache.rows;
  const { data, error } = await db.from("chat_qa_patterns")
    .select("a_key, a_text, a_images, uses, q_samples")
    .eq("small_talk", false).gte("uses", 2).neq("a_text", "")
    .order("uses", { ascending: false }).limit(2000);
  if (error) throw error;
  patternCache = { at: Date.now(), rows: data || [] };
  return patternCache.rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const body = await readJsonBody(req, 16 * 1024);
    const id = String(body?.id || "");
    if (!id) return json({ ok: false, error: "ต้องส่ง id ของแชท" }, 400);
    const auth = await authorizeRequest(req, { tab: ["inbox", "chat"] });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: row } = await db.from("chat_customers")
      .select("id, page_id, customer_name, transcript").eq("id", id).maybeSingle();
    if (!row) return json({ ok: false, error: "ไม่พบแชทนี้" }, 404);
    const rules = await loadChatPageRules(db);
    if (!canSeeChatPage(rules, row.page_id, auth.permission?.email ?? null)) return json({ ok: false, error: "ไม่มีสิทธิ์ดูแชทเพจนี้" }, 403);
    if (isReadOnlyChatPage(rules, row.page_id)) return json({ ok: false, error: READ_ONLY_ERROR }, 403);

    // บทสนทนาช่วงท้าย (ข้อความจริงของคน ไม่เอาข้อความระบบ) — ปิดข้อมูลส่วนตัวก่อนส่งให้ OpenAI
    const msgs = (Array.isArray(row.transcript) ? row.transcript : [])
      .filter((m: any) => m && (m.w === "u" || m.w === "p") && !m.pending && !m._tmp && String(m.t || "").trim() && !isSystemText(m.t))
      .sort((a: any, b: any) => Date.parse(a.at) - Date.parse(b.at));
    if (!msgs.length) return json({ ok: false, error: "แชทนี้ยังไม่มีข้อความให้ AI อ่าน" }, 400);
    const tail = msgs.slice(-16);
    // คำถามล่าสุด = ข้อความลูกค้าที่ติดกันก้อนท้ายสุด (ใช้ฉบับแปลไทยถ้ามี เพราะแพทเทิร์นเก็บเป็นไทย)
    const lastU: string[] = [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].w !== "u") { if (lastU.length) break; continue; }
      lastU.unshift(String(msgs[i].th || msgs[i].t));
    }
    const query = maskPii(lastU.join("\n")).slice(0, 800);

    const [patterns, savedRes, kbRes] = await Promise.all([
      loadPatterns(db),
      db.from("saved_replies").select("id, title, message, page_id").order("sort").limit(200),
      db.from("knowledge_qa").select("id, question, answer").eq("status", "approved").eq("page_id", row.page_id).limit(500),
    ]);
    const saved = (savedRes.data || []).filter((s: any) => !s.page_id || String(s.page_id) === String(row.page_id))
      .map((s: any) => ({ a_text: String(s.message || ""), uses: 50, q_samples: [String(s.title || ""), String(s.message || "").slice(0, 200)], kind: "saved", title: s.title }));
    const kb = (kbRes.data || []).map((k: any) => ({ a_text: String(k.answer || ""), uses: 20, q_samples: String(k.question || "").split(/[\n,]+/), kind: "knowledge", title: null }));
    const refs = [
      ...rankPatterns(query, saved, 3, 0.3),
      ...rankPatterns(query, kb, 3, 0.3),
      ...rankPatterns(query, patterns.map((p: any) => ({ ...p, kind: "pattern", title: null })), 6),
    ].filter((r) => r.a_text.trim()).slice(0, 10);

    const convo = tail.map((m: any) => `[${m.w === "u" ? "ลูกค้า" : "แอดมิน"}] ${maskPii(String(m.th && m.w === "u" ? `${m.t} (แปล: ${m.th})` : m.t)).slice(0, 500)}`).join("\n");
    const refText = refs.length
      ? refs.map((r, i) => `#${i + 1} (${r.kind === "saved" ? `ข้อความบันทึก: ${r.title || ""}` : r.kind === "knowledge" ? "คลังถาม-ตอบ" : `แอดมินเคยตอบ ${r.uses} ครั้ง`})\nตัวอย่างคำถาม: ${(r.q_samples || []).slice(0, 3).join(" / ").slice(0, 300)}\nคำตอบ: ${r.a_text.slice(0, 1200)}`).join("\n\n")
      : "(ไม่พบคำตอบอ้างอิงที่ใกล้เคียง)";

    // กดซ้ำในห้องเดิมที่ยังไม่มีข้อความใหม่ = ได้ร่างเดิม (เร็ว ไม่เสียค่า AI ไม่ได้คำตอบเปลี่ยนไปมา) · ปุ่ม "ร่างใหม่" ส่ง force
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${DRAFT_VERSION}\n${convo}`));
    const cacheKey = `ai_draft:${row.id}:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    if (body?.force !== true) {
      const hit = await cacheGet(cacheKey, DRAFT_TTL_MS).catch(() => null);
      if (hit?.payload?.reply) return json({ ...hit.payload, cached: true });
    }

    const key = await getOpenAIKey();
    if (!key) return json({ ok: false, error: "ยังไม่ได้ตั้งค่า OpenAI API key ในหน้าตั้งค่า" }, 400);
    const isReasoning = (m: string) => /^(gpt-5|o\d)/i.test(m);
    const ask = async (m: string): Promise<Response> => {
      const payload: Record<string, unknown> = {
        model: m,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYS },
          { role: "user", content: `คำตอบอ้างอิง:\n${refText}\n\nบทสนทนาล่าสุด (ล่างสุด = ล่าสุด):\n${convo}\n\nร่างข้อความตอบลูกค้าข้อความถัดไป` },
        ],
      };
      // temperature 0 = ถามซ้ำได้คำตอบเดิม (นิ่งกว่า) · รุ่น reasoning ไม่รับ temperature
      if (isReasoning(m)) { payload.max_completion_tokens = 2000; payload.reasoning_effort = "low"; }
      else { payload.max_tokens = 900; payload.temperature = 0; }
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), OPENAI_TIMEOUT_MS);
      try {
        return await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify(payload),
          signal: ctl.signal,
        });
      } catch (e) {
        // หมดเวลา/เน็ตหลุด → ทำเป็นคำตอบ 504 ให้ตัวลองใหม่ด้านล่างจัดการเหมือน error ชั่วคราว
        return new Response(JSON.stringify({ error: { message: (e as Error)?.name === "AbortError" ? "timeout" : String(e) } }), { status: 504 });
      } finally { clearTimeout(timer); }
    };
    // ลองใหม่ 1 ครั้งเมื่อ OpenAI สะดุดชั่วคราว (429/5xx/หมดเวลา) หรือได้ JSON ที่ไม่มีร่าง
    let model = FAST_MODEL;
    let parsed: any = null;
    let lastErr = "";
    for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1200 * attempt));
      const resp = await ask(model);
      if (!resp.ok) {
        const t = await resp.text();
        lastErr = openAIErrorText(resp.status, t);
        if (model !== FALLBACK_MODEL && resp.status < 500 && resp.status !== 429 && /model/i.test(t)) { model = FALLBACK_MODEL; continue; }
        if (resp.status === 429 || resp.status >= 500) continue;
        return json({ ok: false, error: lastErr }, 400);   // คีย์ผิด/เครดิตหมด — ลองซ้ำไม่ช่วย
      }
      const out = await resp.json().catch(() => null);
      try {
        const p = JSON.parse(out?.choices?.[0]?.message?.content || "{}");
        if (String(p?.reply || "").trim()) parsed = p;
        else lastErr = "AI ตอบกลับว่างเปล่า";
      } catch { lastErr = "AI ตอบกลับไม่ใช่รูปแบบที่อ่านได้"; }
    }
    if (!parsed) return json({ ok: false, error: `${lastErr || "AI ร่างคำตอบไม่สำเร็จ"} — ลองกดใหม่อีกครั้ง` }, 502);

    // ตรวจร่าง: ตัดลิงก์ที่ไม่มีในบทสนทนา/คำตอบอ้างอิง · ข้อมูลที่ปิดไว้ → ___
    const grounded = groundDraft(String(parsed.reply), `${convo}\n${refs.map((r) => r.a_text).join("\n")}`);
    if (!grounded.reply) return json({ ok: false, error: "AI ร่างคำตอบไม่สำเร็จ — ลองกดใหม่อีกครั้ง" }, 502);
    const adminSpokeLast = msgs[msgs.length - 1].w === "p";
    const topSim = Math.max(0, ...refs.map((r: any) => Number(r.sim) || 0));
    const notes = [String(parsed?.note || "").trim()];
    if (adminSpokeLast) notes.push("แอดมินตอบข้อความล่าสุดไปแล้ว — ร่างนี้เป็นข้อความต่อเนื่อง");
    if (grounded.removedLinks.length) notes.push(`ตัดลิงก์ที่ AI ใส่มาเองออก ${grounded.removedLinks.length} ลิงก์ (ไม่เคยมีในแชท/คำตอบเดิม) — ถ้าต้องใช้ลิงก์ให้ใส่เอง`);
    if (grounded.blanks) notes.push("มีช่อง ___ ให้เติมข้อมูลเอง");
    if (!refs.length) notes.push("ไม่พบคำตอบเก่าที่ใกล้เคียง — ตรวจเนื้อหาให้ดีก่อนส่ง");
    const used = new Set((Array.isArray(parsed?.used) ? parsed.used : []).map((n: unknown) => Number(n)).filter((n: number) => n >= 1 && n <= refs.length));
    // ไม่ได้อิงคำตอบเก่าเลย = เนื้อหามาจาก AI ล้วน ๆ → เพดานต่ำ (ให้ตัวเลขเตือนแอดมินอ่านละเอียด)
    if (!used.size && refs.length) notes.push("AI ไม่ได้ใช้คำตอบเก่าอ้างอิง — อ่านเนื้อหาให้ดีก่อนส่ง");
    const result = {
      ok: true,
      reply: grounded.reply,
      confidence: Math.min(used.size ? 1 : 0.4, draftConfidence(Number(parsed?.confidence), topSim, { removedLinks: grounded.removedLinks.length, adminSpokeLast })),
      note: notes.filter(Boolean).join(" · ").slice(0, 400),
      model,
      sources: refs.map((r, i) => ({ n: i + 1, kind: r.kind, title: r.title, uses: r.kind === "pattern" ? r.uses : null, used: used.has(i + 1), text: r.a_text.slice(0, 160) })),
    };
    cacheSet(cacheKey, row.id, "ai_draft", "-", result).catch(() => {});
    return json(result);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
