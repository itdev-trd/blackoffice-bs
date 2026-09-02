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
    const auth = await authorizeRequest(req, { tab: ["inbox", "chat"] });
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
    const convo = tr
      .slice(-60)
      .filter((m: any) => m?.t)
      .map((m: any) => `[${m.w === "u" ? "customer" : "admin"}] ${String(m.t).slice(0, 500)}`)
      .join("\n");

    const key = await getOpenAIKey();
    if (!key) return json({ ok: false, error: "ยังไม่ได้ตั้งค่า OpenAI API key ในหน้าตั้งค่า" }, 400);

    // ใช้ gpt-5 ให้ตรงกับฟังก์ชัน AI อื่นในระบบ + reasoning_effort low เพราะงานนี้เป็นการสกัดข้อมูล ไม่ต้องคิดลึก
    const model = String(body?.model || "gpt-5");
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_completion_tokens: 1200,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYS },
          { role: "user", content: `ชื่อลูกค้า: ${row.customer_name || "(ไม่ทราบ)"}\n\nบทสนทนา:\n${convo}` },
        ],
      }),
    });
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

    return json({
      ok: true,
      id: row.id,
      model,
      suggestion,
      confidence: out.confidence ?? null,
      evidence: out.evidence ?? null,
      note: out.note ?? null,
      // ค่าที่มีอยู่แล้วในระบบ — ให้หน้าเว็บโชว์ว่าจะทับอะไร ไม่ทับเงียบ
      current: { trade_id: row.trade_id || null, username: row.username || null, phone: row.phone || null, email: row.email || null },
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
