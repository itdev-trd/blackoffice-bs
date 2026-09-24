// supabase/functions/chat-retention/index.ts
// วงจรจัดการลูกค้าที่ไม่สนใจแล้ว — ติดแท็ก → ออกจากกล่องหลัก → รอยืนยัน → ล้างข้อมูล
//
// เหตุผลที่ทำ (วัดจริงแล้ว): ฐานข้อมูลทั้งก้อน 21 MB บทสนทนา 3 MB — "ประหยัดพื้นที่" ไม่ใช่เหตุผลจริง
// เหตุผลจริงคือ (1) กล่องแชทสะอาด ไม่ต้องเลื่อนผ่านคนที่ไม่สนใจ (2) ไม่เก็บข้อมูลส่วนตัวเกินจำเป็น
//
//   { action: "status" }                    -> สรุปคิว: อยู่ในเมนู / รอยืนยัน / รอล้าง
//   { action: "mark", ids[], purge_on }     -> มาร์กว่าไม่สนใจ + ตั้งวันลบถาวร (purge_on = "YYYY-MM-DD" เวลาไทย)
//                                              ส่งซ้ำได้เพื่อเปลี่ยนวันลบ · ไม่ส่ง purge_on = มาร์กอย่างเดียว ยังไม่ตั้งวันลบ
//   { action: "unmark", ids[] }             -> ดึงกลับเข้ากล่องหลัก (ยกเลิกวันลบด้วย)
//   { action: "confirm", ids[] }            -> (รุ่นเก่า) ตั้งวันลบอีก purge_days วัน
//   { action: "run", dry_run? }             -> งานประจำวัน: ดึงคนที่ทักกลับ + ลบที่ถึงกำหนด
//
// ตัวที่ "ลบข้อมูลจริง" มีแค่ action run และทำเฉพาะแถวที่ purge_at ถึงกำหนดแล้วเท่านั้น
// การลบ = ลบแถวออกจาก chat_customers ถาวร (แอดมินเลือกวันเองตอนกดปุ่ม "ไม่สนใจแล้ว")
// และจดไว้ใน chat_purged กันงานซิงก์ Messenger ดึงห้องเดิมกลับมา

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/permissions.ts";
import { readJsonBody } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULTS = {
  enabled: true,
  tag: "🚫 ไม่สนใจ",
  review_days: 7,
  purge_days: 23,
  mode: "transcript_only" as "transcript_only" | "full",
  return_on_reply: true,
};

async function loadCfg(admin: any) {
  const { data } = await admin.from("settings").select("value").eq("key", "retention_config").maybeSingle();
  const v = (data?.value && typeof data.value === "object") ? data.value : {};
  // clamp ค่าที่มาจากหน้าเว็บ — กันตั้ง 0 วัน (ล้างทันที) หรือค่าติดลบ
  return {
    ...DEFAULTS,
    ...v,
    review_days: Math.min(90, Math.max(1, Number(v.review_days) || DEFAULTS.review_days)),
    purge_days: Math.min(30, Math.max(1, Number(v.purge_days) || DEFAULTS.purge_days)),
    mode: v.mode === "full" ? "full" : "transcript_only",
  };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const daysAhead = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
const MAX_PURGE_DAYS = 365;
// "YYYY-MM-DD" (วันที่ตามปฏิทินไทย) → เวลาเริ่มวันนั้นตามเวลาไทย · cron รันตีสอง (19:00 UTC) ของวันนั้นจึงลบให้
function purgeAtFromDate(v: unknown): string | null {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00+07:00`);
  if (!Number.isFinite(t)) return null;
  const todayTh = Date.parse(new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10) + "T00:00:00+07:00");
  if (t < todayTh || t > Date.now() + MAX_PURGE_DAYS * 86400000) return null;
  return new Date(t).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

  try {
    const body = await readJsonBody(req, 64 * 1024);
    const action = String(body?.action || "status");
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String).slice(0, 500) : [];

    // "run" ลบข้อมูลจริง → ต้องเป็น admin หรือ service (cron) · ที่เหลือแอดมินตอบแชททำได้
    const needsAdmin = action === "run" || action === "confirm";
    const auth = await authorizeRequest(
      req,
      needsAdmin ? { admin: true, setting: "synccfg", allowService: true } : { tab: ["inbox", "chat"] }
    );
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const cfg = await loadCfg(admin);
    const nowIso = new Date().toISOString();

    // ---------- สรุปคิว ----------
    if (action === "status") {
      const reviewCutoff = daysAgo(cfg.review_days);
      const [inMenu, awaiting, scheduled, purged] = await Promise.all([
        admin.from("chat_customers").select("id", { count: "exact", head: true }).not("not_interested_at", "is", null).is("purge_confirmed_at", null),
        admin.from("chat_customers").select("id", { count: "exact", head: true }).not("not_interested_at", "is", null).is("purge_confirmed_at", null).lte("not_interested_at", reviewCutoff),
        admin.from("chat_customers").select("id", { count: "exact", head: true }).not("purge_at", "is", null),
        admin.from("chat_customers").select("id", { count: "exact", head: true }).not("transcript_purged_at", "is", null),
      ]);
      return json({
        ok: true,
        config: cfg,
        counts: {
          in_menu: inMenu.count ?? 0,          // อยู่ในเมนู "ไม่สนใจ" ทั้งหมด
          awaiting_confirm: awaiting.count ?? 0, // ครบ review_days แล้ว รอแอดมินยืนยัน
          scheduled_purge: scheduled.count ?? 0, // ยืนยันแล้ว รอถึงวันล้าง
          already_purged: purged.count ?? 0,
        },
      });
    }

    // ---------- มาร์ก / ยกเลิกมาร์ก ----------
    if (action === "mark" || action === "unmark") {
      if (ids.length === 0) return json({ ok: false, error: "ไม่มีรายการที่เลือก" }, 400);
      const purgeAt = action === "mark" && body?.purge_on != null ? purgeAtFromDate(body.purge_on) : null;
      if (action === "mark" && body?.purge_on != null && !purgeAt) {
        return json({ ok: false, error: `วันลบไม่ถูกต้อง — เลือกได้ตั้งแต่วันนี้ถึง ${MAX_PURGE_DAYS} วันข้างหน้า` }, 400);
      }
      const { data: rows } = await admin.from("chat_customers").select("id, tags, not_interested_at").in("id", ids);
      let done = 0;
      for (const r of rows ?? []) {
        const tags: string[] = Array.isArray(r.tags) ? r.tags : [];
        const next = action === "mark"
          ? (tags.includes(cfg.tag) ? tags : [...tags, cfg.tag])
          : tags.filter((t) => t !== cfg.tag);
        const patch: Record<string, unknown> = { tags: next, updated_at: nowIso };
        if (action === "mark") {
          // มาร์กซ้ำเพื่อเปลี่ยนวันลบ = คงเวลามาร์กเดิม (ใช้เทียบว่าลูกค้าทักกลับมาหลังมาร์กหรือเปล่า)
          patch.not_interested_at = r.not_interested_at || nowIso;
          if (purgeAt) { patch.purge_at = purgeAt; patch.purge_confirmed_at = nowIso; }
          // ออกจากกล่องหลัก = ไม่ต้องค้างสถานะรอตอบอีก ไม่งั้นตัวนับ "ยังไม่ตอบ" เพี้ยน
          patch.awaiting_reply = false;
          patch.unread = false;
        } else {
          // ยกเลิกมาร์ก = ล้างคิวล้างข้อมูลทั้งชุด กันค้างแล้วโดนลบทีหลังทั้งที่ดึงกลับมาแล้ว
          patch.not_interested_at = null;
          patch.purge_confirmed_at = null;
          patch.purge_at = null;
        }
        const { error } = await admin.from("chat_customers").update(patch).eq("id", r.id);
        if (!error) done++;
      }
      return json({ ok: true, applied: action, done, purge_at: purgeAt });
    }

    // ---------- แอดมินยืนยันว่าไม่เอาจริง ----------
    if (action === "confirm") {
      if (ids.length === 0) return json({ ok: false, error: "ไม่มีรายการที่เลือก" }, 400);
      const purgeAt = daysAhead(cfg.purge_days);
      const { data, error } = await admin
        .from("chat_customers")
        .update({ purge_confirmed_at: nowIso, purge_at: purgeAt, updated_at: nowIso })
        .in("id", ids)
        .not("not_interested_at", "is", null)   // ยืนยันได้เฉพาะรายที่อยู่ในเมนูนี้จริง
        .select("id");
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, confirmed: (data ?? []).length, purge_at: purgeAt, purge_days: cfg.purge_days, mode: cfg.mode });
    }

    // ---------- งานประจำวัน ----------
    if (action === "run") {
      if (!cfg.enabled) return json({ ok: true, skipped: "ปิดใช้งานอยู่ใน retention_config" });
      const dryRun = body?.dry_run === true;
      const out: Record<string, unknown> = { dry_run: dryRun, mode: "delete_row" };

      // 1) ลูกค้าที่ทักกลับมาหลังถูกมาร์ก = ยังสนใจอยู่ → ดึงกลับเข้ากล่องหลัก
      // เทียบ last_message_at > not_interested_at ตรงๆ ไม่ต้องพึ่ง webhook มาแก้
      if (cfg.return_on_reply) {
        // PostgREST เทียบ "คอลัมน์กับคอลัมน์" ไม่ได้ (จะตีค่าเป็นสตริง) จึงดึงมาเทียบใน JS
        // ปลอดภัยเพราะดึงเฉพาะรายที่ถูกมาร์กไว้ ซึ่งมีจำนวนน้อยเสมอ
        const { data: marked } = await admin
          .from("chat_customers")
          .select("id, tags, last_message_at, not_interested_at")
          .not("not_interested_at", "is", null)
          .limit(2000);
        const list = (marked ?? []).filter((r: any) => {
          const last = r.last_message_at ? new Date(r.last_message_at).getTime() : 0;
          const marked_at = r.not_interested_at ? new Date(r.not_interested_at).getTime() : 0;
          return last > marked_at;   // มีข้อความใหม่หลังถูกมาร์ก = ลูกค้ายังสนใจ
        });
        out.returned_to_inbox = list.length;
        if (!dryRun) {
          for (const r of list) {
            const tags: string[] = Array.isArray(r.tags) ? r.tags : [];
            await admin.from("chat_customers").update({
              not_interested_at: null, purge_confirmed_at: null, purge_at: null,
              tags: tags.filter((t) => t !== cfg.tag),
              updated_at: nowIso,
            }).eq("id", r.id);
          }
        }
      }

      // 2) ถึงกำหนดล้าง — เฉพาะรายที่แอดมินยืนยันแล้วและ purge_at ผ่านไปแล้ว
      const { data: due } = await admin
        .from("chat_customers")
        .select("id")
        .not("purge_at", "is", null)
        .lte("purge_at", nowIso)
        .limit(500);
      const dueIds = (due ?? []).map((r) => r.id);
      out.due_purge = dueIds.length;

      if (dueIds.length > 0 && !dryRun) {
        const { data: dueRows } = await admin.from("chat_customers")
          .select("id, page_id, psid, source, last_message_at").in("id", dueIds);
        // จดก่อนลบ — ถ้าจดไม่สำเร็จห้ามลบ ไม่งั้นซิงก์รอบหน้าจะดึงห้องทั้งห้องกลับมา
        const { error: tombErr } = await admin.from("chat_purged").upsert(
          (dueRows ?? []).map((r: any) => ({ id: r.id, page_id: r.page_id, psid: r.psid, source: r.source, last_message_at: r.last_message_at, purged_at: nowIso })),
          { onConflict: "id" },
        );
        if (tombErr) {
          out.error = tombErr.message;
        } else {
          const { error } = await admin.from("chat_customers").delete().in("id", dueIds);
          out.deleted_rows = error ? 0 : dueIds.length;
          if (error) out.error = error.message;
          else {
            // ข้อมูลประกอบที่ผูกกับห้อง: ประวัติแจ้งเตือนลบทิ้ง · สถิติการตอบแชทเก็บตัวเลขไว้ให้ลีดเดอร์บอร์ดไม่เพี้ยน แต่ลบชื่อลูกค้าออก
            await admin.from("push_sent_log").delete().in("conversation_id", dueIds);
            await admin.from("reply_stats").update({ customer_name: null }).in("conversation_id", dueIds);
          }
        }
      }

      return json({ ok: true, ...out });
    }

    return json({ ok: false, error: `ไม่รู้จัก action "${action}"` }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
