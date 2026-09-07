// supabase/functions/extract-customer-data/index.ts
// ให้ AI อ่านบทสนทนาแล้วแยกว่า "ตัวเลข/ข้อความไหนคืออะไร" — เลขบัญชีเทรด / อีเมล / username TradingView / เบอร์โทร
//
// ทำไมต้องใช้ AI ไม่ใช้ regex: ในแชทเดียวมีตัวเลขหลายตัวปนกัน (เลขบัญชี, เบอร์โทร, ยอดเงิน,
// เลขออเดอร์, วันที่) และคำที่มีขีดล่างก็มีทั้ง username จริงกับ query parameter จากลิงก์
// regex แยกไม่ออกว่าอันไหนคืออะไร แต่ AI อ่านบริบทประโยคได้
//
// สำคัญ: ฟังก์ชันนี้ "ไม่เขียนข้อมูลลูกค้า" เลย — คืนเป็นข้อเสนอให้แอดมินตรวจแล้วกดบันทึกเองในหน้าแชท
// (ระบบสกัดอัตโนมัติเคยถูกปิดไปเพราะเขียนข้อมูลผิด จึงต้องมีคนยืนยันทุกครั้ง)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";
import { getOpenAIKey } from "../_shared/openai.ts";
import { cacheGet, cacheSet } from "../_shared/meta-cache.ts";
import { contentHashOf } from "../_shared/chat-extract.ts";

const FAST_MODEL = "gpt-4.1-mini";                 // งานสกัดข้อมูลใช้โมเดลเร็วพอ
const FALLBACK_MODEL = "gpt-5";                    // เผื่อคีย์ยังไม่เปิดโมเดลเร็ว
const EXTRACT_TTL_MS = 24 * 60 * 60 * 1000;        // ผลสแกนของบทสนทนาชุดเดิมใช้ซ้ำได้
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYS = `คุณคือผู้ช่วยแอดมินเพจโบรกเกอร์ อ่านบทสนทนาแล้วแยกข้อมูลของ "ลูกค้า" ออกมา

สิ่งที่ต้องหา:
- trade_id: เลขบัญชีเทรด (XM) มักเป็นตัวเลข 6-10 หลัก ลูกค้ามักพิมพ์พร้อมคำว่า "เลขบัญชี", "บัญชีเทรด", "ไอดีเทรด", "XM"
- email: อีเมลที่ลูกค้าใช้สมัครบัญชีเทรด
- tv_username: ชื่อผู้ใช้ TradingView (ตัวอักษร/ตัวเลข/ขีดล่าง)
- phone: เบอร์โทรของลูกค้า

กฎที่ต้องทำตามเคร่งครัด:
1. เอาเฉพาะข้อมูล "ของลูกค้า" เท่านั้น — ข้อความฝั่งแอดมิน (role: admin) มีเลขตัวอย่าง เบอร์ติดต่อเพจ และลิงก์โปรโมชั่นปนอยู่ ห้ามเอา
2. ห้ามเดา ถ้าไม่มีข้อมูลหรือไม่มั่นใจให้ใส่ null
3. อย่าสับสนระหว่างชนิดข้อมูล: เบอร์โทรไทยมี 9-10 หลักขึ้นต้น 0 หรือ +66 · ยอดเงิน/จำนวนลอต/วันที่ ไม่ใช่เลขบัญชี
4. ห้ามเอาค่าจาก URL หรือ query parameter (utm_source, story_fbid, fbclid ฯลฯ) มาเป็น username
5. ถ้าลูกค้าพิมพ์เลขบัญชีหลายเลข ให้เอาเลขที่ล่าสุด/ที่ลูกค้ายืนยันว่าเป็นของตัวเอง
6. evidence ต้องเป็นข้อความ "ที่ตัดมาจากบทสนทนาจริง" ไม่ใช่คำอธิบายที่แต่งขึ้น

ตอบ JSON เท่านั้น:
{
  "trade_id": "เลข หรือ null",
  "email": "อีเมล หรือ null",
  "tv_username": "ชื่อ หรือ null",
  "phone": "เบอร์ หรือ null",
  "confidence": { "trade_id": 0-1, "email": 0-1, "tv_username": 0-1, "phone": 0-1 },
  "evidence": { "trade_id": "ข้อความต้นฉบับ", "email": "...", "tv_username": "...", "phone": "..." },
  "note": "ข้อสังเกตสั้นๆ ถ้ามีอะไรน่าสงสัย เช่นเจอหลายเลขแล้วเลือกอันไหนเพราะอะไร"
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

  try {
    const body = await readJsonBody(req, 32 * 1024);
    const id = String(body?.id || "");
    if (!id) return json({ ok: false, error: "ต้องส่ง id ของบทสนทนา" }, 400);
    // อ่านอย่างเดียว ไม่เขียน — สิทธิ์ระดับตอบแชทพอ
    const auth = await authorizeRequest(req, { tab: ["inbox", "chat"], allowService: true });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: row } = await admin
      .from("chat_customers")
      .select("id, customer_name, transcript, trade_id, username, phone, email")
      .eq("id", id)
      .maybeSingle();
    if (!row) return json({ ok: false, error: "ไม่พบบทสนทนานี้" }, 404);

    const tr = Array.isArray(row.transcript) ? row.transcript : [];
    if (tr.length === 0) return json({ ok: false, error: "บทสนทนานี้ยังไม่มีข้อความ" }, 400);

    // ส่งทั้งสองฝั่งไปให้ AI พร้อมป้ายบอกว่าใครพูด — ต้องรู้บริบทว่าแอดมินถามอะไรลูกค้าจึงตอบเลขนั้น
    // แต่กำกับใน prompt ว่าห้ามเอาข้อมูลฝั่งแอดมิน
    // ยิ่ง prompt ยาว AI ยิ่งตอบช้า — คัดเฉพาะข้อความที่ "มีโอกาสมีข้อมูล" (ตัวเลข/อีเมล/คำที่เกี่ยวข้อง)
    // แล้วพ่วงข้อความก่อนหน้า 1 ข้อไว้เป็นบริบท (แอดมินถามอะไรลูกค้าจึงตอบเลขนั้น)
    // ต้องคัดจากบทสนทนา "ทั้งห้อง" ไม่ใช่แค่ช่วงท้าย — ลูกค้าหลายคนส่งเลขบัญชีตอนต้นแชท
    // แล้วคุยเรื่องอื่นต่ออีกยาว (เคยตัดแค่ 40 ข้อความท้ายแล้วพลาดข้อความที่ 12 จาก 53)
    // ถ้าคัดแล้วไม่เหลืออะไรเลย ค่อยถอยไปใช้ 20 ข้อความท้ายแบบเดิม
    const CANDIDATE = /[0-9]|@|บัญชี|ไอดี|user|tradingview|tv|เบอร์|อีเมล|mail/i;
    const all = tr.filter((m: any) => m?.t);
    const keep = new Set<number>();
    all.forEach((m: any, i: number) => {
      if (!CANDIDATE.test(String(m.t))) return;
      if (i > 0) keep.add(i - 1);
      keep.add(i);
    });
    const picked = keep.size ? all.filter((_: any, i: number) => keep.has(i)) : all.slice(-20);
    // ตัดด้านท้ายเมื่อยาวเกินงบ (กฎข้อ 5 บอกว่าเอาเลขที่ลูกค้ายืนยันล่าสุด จึงเก็บท้ายไว้)
    const CHAR_BUDGET = 12000;
    const lines: string[] = [];
    let used = 0;
    for (let i = picked.length - 1; i >= 0; i--) {
      const m: any = picked[i];
      const line = `[${m.w === "u" ? "customer" : "admin"}] ${String(m.t).slice(0, 300)}`;
      if (used + line.length > CHAR_BUDGET && lines.length) break;
      lines.unshift(line);
      used += line.length;
    }
    const convo = lines.join("\n");

    // สแกนซ้ำห้องเดิมที่บทสนทนาไม่เปลี่ยน = คืนผลเดิมทันที (0 วินาที ไม่เสียค่า AI)
    const cacheKey = `extract:${row.id}:${contentHashOf(tr)}`;
    if (body?.force !== true) {
      const hit = await cacheGet(cacheKey, EXTRACT_TTL_MS).catch(() => null);
      if (hit?.payload) return json({ ...hit.payload, cached: true });
    }

    const key = await getOpenAIKey();
    if (!key) return json({ ok: false, error: "ยังไม่ได้ตั้งค่า OpenAI API key ในหน้าตั้งค่า" }, 400);

    // งานนี้คือ "คัดข้อมูลจากข้อความ" ไม่ใช่งานคิดวิเคราะห์ — ใช้โมเดลเร็ว (ไม่ใช่ reasoning model)
    // เดิมใช้ gpt-5 ซึ่งคิดก่อนตอบทุกครั้ง จึงกิน ~10 วินาทีต่อการสแกน 1 ห้อง
    // เปลี่ยนพารามิเตอร์ตามตระกูลโมเดลด้วย: reasoning_effort/max_completion_tokens ใช้ได้เฉพาะตระกูล gpt-5/o
    // ส่วนรุ่นอื่นต้องใช้ max_tokens (ส่งผิดตระกูล = OpenAI ตอบ 400 ทั้งคำขอ)
    const isReasoning = (m: string) => /^(gpt-5|o\d)/i.test(m);
    const askOpenAI = async (m: string) => {
      const payload: Record<string, unknown> = {
        model: m,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYS },
          { role: "user", content: `ชื่อลูกค้า: ${row.customer_name || "(ไม่ทราบ)"}\n\nบทสนทนา:\n${convo}` },
        ],
      };
      if (isReasoning(m)) { payload.max_completion_tokens = 1200; payload.reasoning_effort = "low"; }
      else { payload.max_tokens = 600; payload.temperature = 0; }
      return await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(payload),
      });
    };

    // รับ model จาก body ได้ แต่เพียงสองตัวที่ระบบรองรับ กันการสั่งชื่อโมเดลแพง ๆ เข้ามาจากหน้าเว็บ
    const requested = String(body?.model || "");
    let model = requested === FALLBACK_MODEL ? FALLBACK_MODEL : FAST_MODEL;
    let resp = await askOpenAI(model);
    // คีย์ของบางบัญชียังไม่เปิดโมเดลเร็ว → ถอยไปตัวที่ระบบใช้อยู่เดิม ไม่ให้ผู้ใช้เจอ error เฉย ๆ
    if (!resp.ok && model !== FALLBACK_MODEL) {
      const t = await resp.text();
      if (/model/i.test(t)) { model = FALLBACK_MODEL; resp = await askOpenAI(model); }
      else return json({ ok: false, error: `OpenAI ${resp.status}: ${t.slice(0, 200)}` }, 400);
    }
    if (!resp.ok) {
      const t = await resp.text();
      return json({ ok: false, error: `OpenAI ${resp.status}: ${t.slice(0, 200)}` }, 400);
    }
    const data = await resp.json();
    let out: any = {};
    try { out = JSON.parse(data.choices?.[0]?.message?.content || "{}"); } catch { out = {}; }

    // ตรวจรูปแบบฝั่งเราอีกชั้น — AI ยังหลุดรูปแบบได้ ห้ามส่งค่าที่หน้าตาไม่ใช่ไปให้แอดมินกดบันทึก
    const clean = (v: unknown) => { const s = String(v ?? "").trim(); return s && s.toLowerCase() !== "null" ? s : null; };
    const tid = clean(out.trade_id);
    const email = clean(out.email);
    const uname = clean(out.tv_username);
    const phone = clean(out.phone);

    const suggestion = {
      trade_id: tid && /^\d{5,12}$/.test(tid) ? tid : null,
      email: email && /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(email) ? email : null,
      tv_username: uname && /^[A-Za-z][A-Za-z0-9_]{2,29}$/.test(uname) ? uname : null,
      phone: phone && /^[0-9+\-\s()]{8,20}$/.test(phone) ? phone : null,
    };

    // ช่องที่ AI ตอบมาแต่รูปแบบไม่ผ่านการตรวจ = "เพี้ยน" ต้องบอกหน้าเว็บให้ชวนกดลองใหม่
    // ไม่ใช่เงียบไปเฉย ๆ จนแอดมินคิดว่าไม่มีข้อมูลในแชท
    const dropped = [
      ...(tid && !suggestion.trade_id ? ["trade_id"] : []),
      ...(email && !suggestion.email ? ["email"] : []),
      ...(uname && !suggestion.tv_username ? ["tv_username"] : []),
      ...(phone && !suggestion.phone ? ["phone"] : []),
    ];

    const result = {
      ok: true,
      id: row.id,
      model,
      suggestion,
      dropped,
      confidence: out.confidence ?? null,
      evidence: out.evidence ?? null,
      note: out.note ?? null,
      // ค่าที่มีอยู่แล้วในระบบ — ให้หน้าเว็บโชว์ว่าจะทับอะไร ไม่ทับเงียบ
      current: { trade_id: row.trade_id || null, username: row.username || null, phone: row.phone || null, email: row.email || null },
    };
    cacheSet(cacheKey, row.id, "extract", "-", result).catch(() => {});   // เขียนแคชแบบไม่รอ
    return json(result);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
