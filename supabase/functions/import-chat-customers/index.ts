import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
const clean = (value: unknown, max = 200) => { const text = String(value ?? "").trim(); return text ? text.slice(0, max) : null; };
const normName = (value: unknown) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("th-TH");
const stageMap: Record<string, string> = {
  "new": "new", "มาใหม่": "new",
  "qualified": "qualified", "มีคุณสมบัติ": "qualified",
  "converted": "converted", "สร้างคอนเวอร์ชั่นแล้ว": "converted", "สร้างคอนเวอร์ชันแล้ว": "converted",
  "account_opened": "account_opened", "เปิดบัญชี": "account_opened", "ลูกค้าเปิดบัญชีใหม่": "account_opened",
  "disqualified": "disqualified", "ไม่มีคุณสมบัติ": "disqualified",
};
type ImportRecord = { row_number?: number; customer_name?: unknown; trade_id?: unknown; phone?: unknown; email?: unknown; username?: unknown; stage?: unknown };
type GroupedRecord = {
  key: string;
  customer_name: string | null;
  row_numbers: number[];
  trade_ids: string[];
  phone: string | null;
  email: string | null;
  username: string | null;
  stage: string | null;
};

function groupByFacebookName(input: ImportRecord[]) {
  const grouped = new Map<string, GroupedRecord>();
  input.forEach((record, index) => {
    const rowNumber = Number(record.row_number) || index + 2;
    const customerName = clean(record.customer_name);
    const normalized = normName(customerName);
    // แถวที่ไม่มีชื่อแยกกัน เพื่อให้ preview แจ้งแถวผิดได้ครบ
    const key = normalized || `__invalid_row_${rowNumber}_${index}`;
    const current = grouped.get(key) || {
      key, customer_name: customerName, row_numbers: [], trade_ids: [],
      phone: null, email: null, username: null, stage: null,
    };
    current.row_numbers.push(rowNumber);
    if (!current.customer_name && customerName) current.customer_name = customerName;
    const tradeId = clean(record.trade_id, 300);
    if (tradeId && !current.trade_ids.includes(tradeId)) current.trade_ids.push(tradeId);
    // ฟิลด์อื่นใช้ค่าที่กรอกล่าสุดในไฟล์ ส่วนไอดีเทรดเก็บทุกบัญชีของชื่อเดียวกัน
    for (const field of ["phone", "email", "username", "stage"] as const) {
      const value = clean(record[field], field === "email" ? 300 : 200);
      if (value) current[field] = value;
    }
    grouped.set(key, current);
  });
  return [...grouped.values()];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  try {
    const body = await readJsonBody(req, 4 * 1024 * 1024);
    const pageId = clean(body?.page_id, 100);
    const mode = body?.mode === "apply" ? "apply" : "preview";
    const input = Array.isArray(body?.records) ? body.records.slice(0, 5001) as ImportRecord[] : [];
    if (!pageId) return json({ ok: false, error: "กรุณาเลือกเพจ" }, 400);
    if (!input.length) return json({ ok: false, error: "ไม่มีข้อมูลสำหรับนำเข้า" }, 400);
    if (input.length > 5000) return json({ ok: false, error: "นำเข้าได้สูงสุดครั้งละ 5,000 แถว" }, 400);

    const auth = await authorizeRequest(req, { tab: "customerdb", pageId });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const customers: Record<string, unknown>[] = [];
    for (let from = 0; from < 100000; from += 1000) {
      const { data, error } = await admin.from("chat_customers")
        .select("id, customer_name, trade_id, phone, email, username, stage, account_opened_at")
        .eq("page_id", pageId).range(from, from + 999);
      if (error) throw error;
      customers.push(...(data || []));
      if (!data || data.length < 1000) break;
    }

    // จับคู่ด้วยชื่อ Facebook เพียงอย่างเดียว เพราะไฟล์เดิมไม่มี PSID
    const byName = new Map<string, Record<string, unknown>[]>();
    for (const customer of customers) {
      const key = normName(customer.customer_name);
      if (!key) continue;
      byName.set(key, [...(byName.get(key) || []), customer]);
    }
    const groups = groupByFacebookName(input);
    const groupByKey = new Map(groups.map((group) => [group.key, group]));

    const results = groups.map((group) => {
      const normalized = normName(group.customer_name);
      const matches = normalized ? (byName.get(normalized) || []) : [];
      const fields = [] as string[];
      if (group.trade_ids.length) fields.push("trade_id");
      for (const field of ["phone", "email", "username"] as const) if (group[field]) fields.push(field);
      if (group.stage && stageMap[normName(group.stage)]) fields.push("stage");
      let status = "matched";
      let reason = `จับคู่ชื่อสำเร็จ ${matches.length} รายการ`;
      if (!normalized) { status = "invalid"; reason = "ไม่มีชื่อลูกค้า"; }
      else if (!matches.length) { status = "not_found"; reason = "ไม่พบชื่อนี้ในเพจที่เลือก"; }
      else if (!fields.length) { status = "invalid"; reason = "ไม่มีข้อมูลที่จะเขียนทับ"; }
      return {
        key: group.key,
        row_number: group.row_numbers[0] || null,
        row_numbers: group.row_numbers,
        customer_name: group.customer_name,
        status,
        reason,
        customer_ids: status === "matched" ? matches.map((item) => item.id).filter(Boolean) : [],
        matched_count: status === "matched" ? matches.length : 0,
        trade_ids: group.trade_ids,
        fields,
      };
    });

    const summary = results.reduce((acc: Record<string, number>, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      if (row.status === "matched") acc.matched_records += row.matched_count;
      return acc;
    }, { total: input.length, names: results.length, matched_records: 0 });
    if (mode === "preview") return json({ ok: true, mode, summary, results });

    const nowIso = new Date().toISOString();
    const matched = results.filter((row) => row.status === "matched");
    let updated = 0;
    const errors: { row_numbers: number[]; customer_name: string | null; error: string }[] = [];
    const updateJobs = matched.flatMap((match) => {
      const group = groupByKey.get(match.key);
      if (!group) return [];
      const patch: Record<string, unknown> = {
        manual_data: true, manual_data_by: auth.permission?.email || "unknown", manual_data_at: nowIso,
        classified_by: "manual", needs_ai: false, needs_verify: false, updated_at: nowIso,
      };
      // ไฟล์เป็นข้อมูลยืนยันแล้ว: รวมไอดีเทรดทุกบัญชีของชื่อเดียวกันและเขียนทับค่าที่ AI เคยวิเคราะห์
      if (group.trade_ids.length) patch.trade_id = group.trade_ids.join(", ").slice(0, 1000);
      if (group.phone) patch.phone = group.phone;
      if (group.email) patch.email = group.email.toLowerCase();
      if (group.username) patch.username = group.username;
      const stage = group.stage ? stageMap[normName(group.stage)] : null;
      if (stage) {
        patch.stage = stage; patch.stage_manual = stage;
        if (stage === "account_opened") patch.account_opened_at = nowIso;
      }
      return match.customer_ids.map((customerId) => ({ match, customerId, patch }));
    });
    for (let index = 0; index < updateJobs.length; index += 15) {
      const batch = updateJobs.slice(index, index + 15);
      await Promise.all(batch.map(async ({ match, customerId, patch }) => {
        const { error } = await admin.from("chat_customers").update(patch).eq("id", customerId).eq("page_id", pageId);
        if (error) errors.push({ row_numbers: match.row_numbers, customer_name: match.customer_name, error: error.message });
        else updated += 1;
      }));
    }
    return json({
      ok: errors.length === 0,
      mode,
      updated,
      matched_names: matched.length,
      skipped: results.length - matched.length,
      errors,
      summary,
      results,
    });
  } catch (error) {
    return json({ ok: false, error: String(error instanceof Error ? error.message : error) }, 500);
  }
});
