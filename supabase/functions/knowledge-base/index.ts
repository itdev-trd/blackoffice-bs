import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const normalizeKnowledgeText = (value: unknown) => String(value || "")
  .toLocaleLowerCase("th")
  .replace(/[^\p{L}\p{N}\s]/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

function knowledgeKeywordScore(row: Record<string, unknown>, rawQuery: string) {
  const query = normalizeKnowledgeText(rawQuery);
  if (!query) return 0;
  const rawKeywords = String(row.question || "").split(/[,;|/\n]+/).map(normalizeKnowledgeText).filter(Boolean);
  let score = 0;
  for (const keyword of rawKeywords) {
    if (query.includes(keyword)) score = Math.max(score, 120 + keyword.length);
    else if (keyword.includes(query)) score = Math.max(score, 100 + query.length);
    else {
      const words = keyword.split(" ").filter((word) => word.length >= 2);
      const matched = words.filter((word) => query.includes(word)).length;
      if (matched && matched === words.length) score = Math.max(score, 70 + matched * 5);
      else if (matched >= 2) score = Math.max(score, 40 + matched * 4);
    }
  }
  const answer = normalizeKnowledgeText(row.answer);
  if (answer.includes(query)) score = Math.max(score, 25);
  return score;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "search");
    const pageId = body?.page_id ? String(body.page_id) : null;
    const adminOnly = ["list", "review", "delete"].includes(action);
    if (action === "search" && !pageId) return json({ ok: false, error: "ต้องระบุเพจ" }, 400);
    const auth = await authorizeRequest(req, adminOnly ? { admin: true, setting: "chat" } : { tab: "inbox", pageId });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    // สิทธิ์ตอบแชทไม่ผูกกับเพจ — ใครเข้าหน้าตอบแชทได้ ก็ตอบได้ทุกเพจและทุก LINE OA (คลังคำตอบใช้ตอนตอบแชทจึงเปิดตามกัน)
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (action === "search") {
      const term = String(body?.q || "").trim().slice(0, 300);
      if (term.length < 2) return json({ ok: true, items: [] });
      const { data, error } = await db.from("knowledge_qa")
        .select("id,question,answer,page_id,source,tags,use_count,updated_at")
        .eq("status", "approved").eq("page_id", pageId)
        .limit(1000);
      if (error) throw error;
      const items = (data || [])
        .map((row) => ({ ...row, _score: knowledgeKeywordScore(row, term) }))
        .filter((row) => row._score > 0)
        .sort((a, b) => b._score - a._score || Number(b.use_count || 0) - Number(a.use_count || 0))
        .slice(0, 20)
        .map(({ _score: _ignored, ...row }) => row);
      return json({ ok: true, items });
    }

    if (action === "list") {
      const status = String(body?.status || "pending");
      const term = String(body?.q || "").trim().slice(0, 200).replace(/[%_,().]/g, " ").replace(/\s+/g, " ").trim();
      const allowedPageSizes = [5, 10, 20, 50, 100];
      const pageSize = allowedPageSizes.includes(Number(body?.page_size)) ? Number(body.page_size) : 10;
      const page = Math.max(1, Math.floor(Number(body?.page) || 1));
      let query = db.from("knowledge_qa").select("*", { count: "exact" }).eq("status", status);
      if (pageId) query = query.eq("page_id", pageId);
      if (term) query = query.or(`question.ilike.%${term}%,answer.ilike.%${term}%`);
      query = status === "approved"
        ? query.order("question", { ascending: true }).range((page - 1) * pageSize, page * pageSize - 1)
        : query.order("created_at", { ascending: false }).limit(200);
      const { data, error, count } = await query;
      if (error) throw error;
      return json({ ok: true, items: data || [], total: count || 0, page, page_size: pageSize });
    }

    if (action === "create") {
      const question = String(body?.question || "").trim().slice(0, 2000);
      const answer = String(body?.answer || "").trim().slice(0, 8000);
      if (!pageId || !question || !answer) return json({ ok: false, error: "กรุณาเลือกเพจและกรอกคำค้นกับคำตอบให้ครบ" }, 400);
      const now = new Date().toISOString();
      const reviewer = auth.permission?.email || auth.user?.email || null;
      // คำตอบเดียวกันภายในเพจเดียวกันใช้เป็นรายการเดียว แล้วสะสมคำถามเป็น keywords
      // ช่วยไม่ให้คลังโตจากคำถามหลายรูปแบบที่ใช้คำตอบเดียวกัน
      const { data: sameAnswer, error: sameAnswerError } = await db.from("knowledge_qa")
        .select("id,question")
        .eq("page_id", pageId)
        .eq("status", "approved")
        .eq("answer", answer)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sameAnswerError) throw sameAnswerError;
      if (sameAnswer?.id) {
        const keywordParts = (value: string) => value.split(/[\n,]+/).map((part) => part.trim()).filter(Boolean);
        const merged: string[] = [];
        const seen = new Set<string>();
        for (const keyword of [...keywordParts(String(sameAnswer.question || "")), ...keywordParts(question)]) {
          const key = keyword.toLocaleLowerCase("th").replace(/\s+/g, " ");
          if (!seen.has(key)) { seen.add(key); merged.push(keyword); }
        }
        while (merged.length > 1 && merged.join("\n").length > 2000) merged.shift();
        const mergedQuestion = merged.join("\n").slice(-2000);
        const { error: mergeError } = await db.from("knowledge_qa").update({
          question: mergedQuestion,
          reviewed_by: reviewer,
          reviewed_at: now,
          updated_at: now,
        }).eq("id", sameAnswer.id);
        if (mergeError) throw mergeError;
        return json({ ok: true, id: sameAnswer.id, merged: true });
      }
      const { data, error } = await db.from("knowledge_qa").insert({
        source_key: `manual:${crypto.randomUUID()}`,
        page_id: pageId,
        source: "manual",
        question,
        answer,
        language: "Thai",
        status: "approved",
        created_by: reviewer,
        reviewed_by: reviewer,
        reviewed_at: now,
        created_at: now,
        updated_at: now,
      }).select("id").single();
      if (error) throw error;
      return json({ ok: true, id: data?.id, merged: false });
    }

    if (action === "review") {
      const id = String(body?.id || ""), status = String(body?.status || "");
      if (!id || !["approved", "rejected", "archived"].includes(status)) return json({ ok: false, error: "ข้อมูลไม่ครบ" }, 400);
      const patch: Record<string, unknown> = {
        status, reviewed_by: auth.permission?.email || auth.user?.email || null,
        reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      if (String(body?.question || "").trim()) patch.question = String(body.question).trim();
      if (String(body?.answer || "").trim()) patch.answer = String(body.answer).trim();
      const { error } = await db.from("knowledge_qa").update(patch).eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "delete") {
      const id = String(body?.id || "");
      if (!id) return json({ ok: false, error: "ไม่พบรายการที่ต้องการลบ" }, 400);
      const { error } = await db.from("knowledge_qa").delete().eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "used") {
      const id = String(body?.id || "");
      if (id) await db.rpc("increment_knowledge_use", { target_id: id });
      return json({ ok: true });
    }
    return json({ ok: false, error: "action ไม่ถูกต้อง" }, 400);
  } catch (err) {
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
