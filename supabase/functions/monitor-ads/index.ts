// supabase/functions/monitor-ads/index.ts
// เรียกอัตโนมัติทุก 15 นาทีผ่าน pg_cron (ดู supabase-migration-cron.sql)
// ตัวฟังก์ชันเองจะเช็คว่าถึงรอบของแต่ละแอดหรือยังตาม monitor_interval_minutes ในตั้งค่า
//
// หลักการ: ตัดขาดทุน (pause) ทำ auto ได้เลย — เพิ่มงบ (scale) แค่ "เสนอ" รอแอดมินกดอนุมัติในเว็บแอปเท่านั้น
//
// Secrets ที่ต้องตั้ง:
//   META_ACCESS_TOKEN
//   TELEGRAM_BOT_TOKEN   (ไม่บังคับ — ถ้าตั้งจะได้แจ้งเตือนเข้า Telegram ด้วยนอกจากในเว็บแอป)
//   TELEGRAM_CHAT_ID     (ไม่บังคับ)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMetaToken } from "../_shared/meta.ts";
import { authorizeRequest } from "../_shared/permissions.ts";

let META_TOKEN = "";
const GRAPH_VERSION = "v22.0"; // อัปจาก v19 (sunset ต้นปี 2026)

async function notifyTelegram(text: string) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return; // ไม่บังคับตั้งค่า
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (e) {
    console.error("telegram notify failed", e);
  }
}

Deno.serve(async (req) => {
  const auth = await authorizeRequest(req, { allowService: true });
  if (!auth.ok || !auth.isService) {
    return new Response(JSON.stringify({ ok: false, error: auth.ok ? "service role required" : auth.error }), {
      status: auth.ok ? 403 : auth.status,
      headers: { "content-type": "application/json" },
    });
  }
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ===== Kill-switch: ปิดระบบ auto monitor ชั่วคราว (ลดการยิง Meta / กันชน rate limit) =====
  // no-op ทันที ต่อให้ cron หรือปุ่มยิงมาก็ไม่ทำงาน · เปิดกลับ: settings.monitor_ads_enabled = true
  let monitorEnabled = false;
  try {
    const { data: msRow } = await supabaseAdmin.from("settings").select("value").eq("key", "monitor_ads_enabled").maybeSingle();
    monitorEnabled = msRow?.value === true;
  } catch { monitorEnabled = false; }   // อ่าน flag ไม่ได้ = ถือว่าปิดไว้ก่อน (ปลอดภัย)
  if (!monitorEnabled) {
    return new Response(JSON.stringify({ ok: true, skipped: "auto monitor ปิดชั่วคราว (ตั้ง settings.monitor_ads_enabled=true เพื่อเปิดกลับ)" }), { headers: { "content-type": "application/json" } });
  }

  try {
    META_TOKEN = await getMetaToken();
    const { data: settingsRows } = await supabaseAdmin
      .from("settings")
      .select("key, value")
      .in("key", ["optimization_thresholds", "ghost_protection"]);
    const cfg = settingsRows?.find((s) => s.key === "optimization_thresholds")?.value ?? {
      target_cpa_thb: 150,
      min_spend_before_judging_thb: 200,
      underperform_multiplier: 1.5,
      outperform_multiplier: 0.7,
      scale_up_pct: 20,
    };
    // ตั้งค่าป้องกันแชทผี (ถ้ายังไม่ได้รัน migration จะไม่มี -> ใช้ค่าปิดไว้ก่อน ไม่กระทบการทำงานเดิม)
    const ghostCfg = settingsRows?.find((s) => s.key === "ghost_protection")?.value ?? {
      enabled: false,
      min_conversations: 10,
      min_reply_rate: 0.4,
      action: "alert",
    };

    // รวมค่า action ของแต่ละประเภทจาก insights.actions ตาม matcher
    function sumActions(actions: { action_type: string; value: string }[], matcher: (t: string) => boolean) {
      return (actions || [])
        .filter((a) => matcher(a.action_type))
        .reduce((s, a) => s + parseFloat(a.value || "0"), 0);
    }

    // ดึงทั้งแอดที่กำลังรัน (active) และแอดที่ถูกหยุดอัตโนมัติ (paused_auto)
    // เพื่อให้ sync ได้สองทาง: ถ้าแอดที่เคยหยุดถูกเปิดกลับมารันในตัวจัดการโฆษณา
    // ก็ต้องอัปเดตสถานะในเว็บแอปให้กลับเป็น active ด้วย
    const { data: activeAds, error } = await supabaseAdmin
      .from("ad_content")
      .select("*")
      .in("status", ["active", "paused_auto"]);
    if (error) throw error;

    // ประมวลผลทีละแอดแบบขนาน (Promise.all) แทน sequential for-loop เดิม
    // เพราะการเช็คสถานะ + ดึง insight ทีละตัวรอกันเป็นแถวทำให้ CPU time ของ Edge Function หมดเมื่อมีแอดเยอะขึ้น
    // และรวม field effective_status กับ insights ไว้ใน request เดียวกัน (field expansion) แทนที่จะยิง 2 ครั้งต่อแอด
    async function processAd(row: Record<string, any>) {
      if (!row.ad_id) return null;

      const url =
        `https://graph.facebook.com/${GRAPH_VERSION}/${row.ad_id}` +
        `?fields=effective_status,insights.date_preset(today){spend,actions}` +
        `&access_token=${META_TOKEN}`;
      const resp = await fetch(url);
      const data = await resp.json();

      const metaErrorCode = data?.error?.code;
      const isGone =
        metaErrorCode === 100 || // ไม่พบ object (ถูกลบถาวร)
        metaErrorCode === 803 || // object ไม่มีอยู่ / ไม่มีสิทธิ์เข้าถึงแล้ว
        data?.effective_status === "DELETED" ||
        data?.effective_status === "ARCHIVED";

      if (isGone) {
        await supabaseAdmin
          .from("ad_content")
          .update({
            status: "deleted_on_meta",
            notes: "ตรวจพบว่าถูกลบ/เก็บถาวรในตัวจัดการโฆษณาโดยตรง (sync อัตโนมัติ)",
          })
          .eq("id", row.id);
        return { id: row.id, verdict: "deleted_on_meta" };
      }

      const effStatus: string = data?.effective_status ?? "";
      const isActiveOnMeta = effStatus.includes("ACTIVE");
      const isPausedOnMeta = effStatus.includes("PAUSED");

      // sync สองทางกับตัวจัดการโฆษณา:
      // (1) แอดที่ถูกหยุดอัตโนมัติ แต่ตอนนี้กลับมารันในตัวจัดการโฆษณาแล้ว -> อัปเดตเป็น active
      if (isActiveOnMeta && row.status === "paused_auto") {
        await supabaseAdmin
          .from("ad_content")
          .update({ status: "active", notes: "กลับมารันในตัวจัดการโฆษณาแล้ว (sync อัตโนมัติ)" })
          .eq("id", row.id);
        await notifyTelegram(`▶️ กลับมารันแล้ว: ${row.headline} (sync จากตัวจัดการโฆษณา)`);
        // ข้ามการตัดสินผลในรอบนี้ ให้แอดได้เริ่มเก็บผลใหม่ก่อน จะได้ไม่โดนหยุดซ้ำทันที
        return { id: row.id, verdict: "reactivated" };
      }

      // (2) แอดที่กำลัง active ในเว็บแอป แต่ถูกหยุดในตัวจัดการโฆษณา -> อัปเดตเป็น paused_auto
      if (isPausedOnMeta && row.status === "active") {
        await supabaseAdmin
          .from("ad_content")
          .update({ status: "paused_auto", notes: "หยุดจากตัวจัดการโฆษณาโดยตรง (sync อัตโนมัติ)" })
          .eq("id", row.id);
        return { id: row.id, verdict: "paused_on_meta" };
      }

      // แอดที่ยังไม่ได้รันอยู่บน Meta (เช่น ยังหยุดอยู่) ไม่ต้องตัดสินผล/บันทึก metric
      if (!isActiveOnMeta) {
        return { id: row.id, verdict: "skipped_not_active" };
      }

      const insight = data?.insights?.data?.[0] ?? { spend: "0", actions: [] };
      const spend = parseFloat(insight.spend || "0");
      const leadAction = (insight.actions || []).find(
        (a: { action_type: string; value: string }) =>
          a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
      );
      const leads = leadAction ? parseFloat(leadAction.value) : 0;
      const cpa = leads > 0 ? spend / leads : null;

      let verdict = "insufficient_data";
      if (spend >= (cfg.min_spend_before_judging_thb ?? 200)) {
        if (cpa === null || cpa > (cfg.target_cpa_thb ?? 150) * (cfg.underperform_multiplier ?? 1.5)) {
          verdict = "underperform";
        } else if (cpa < (cfg.target_cpa_thb ?? 150) * (cfg.outperform_multiplier ?? 0.7)) {
          verdict = "outperform";
        } else {
          verdict = "on_target";
        }
      }

      await supabaseAdmin.from("metrics_log").insert({
        ad_content_id: row.id,
        spend,
        leads,
        cpa,
        verdict,
      });

      // ---------- ตรวจจับแชทผี (ghost chats) ----------
      // เฉพาะแอดที่มีแชทเข้าจริง (messaging) เท่านั้น — วัดจากอัตราการตอบกลับ:
      // เริ่มแชทเยอะ แต่คนตอบกลับจริงน้อย = สงสัยแชทผี/บอท/มิสคลิก
      const conversations = sumActions(insight.actions, (t) => t.includes("messaging_conversation_started"));
      const replies = sumActions(insight.actions, (t) => t.includes("messaging_user_depth_2_message_send"));
      const replyRate = conversations > 0 ? replies / conversations : null;

      if (ghostCfg.enabled && conversations > 0) {
        const enoughSample = conversations >= (ghostCfg.min_conversations ?? 10);
        const isGhost = enoughSample && (replyRate ?? 0) < (ghostCfg.min_reply_rate ?? 0.4);

        if (isGhost) {
          const reason = `สงสัยแชทผี: เริ่มแชท ${conversations} ครั้ง แต่ตอบกลับจริงแค่ ${replies} (อัตราตอบ ${Math.round((replyRate ?? 0) * 100)}% ต่ำกว่าเกณฑ์ ${Math.round((ghostCfg.min_reply_rate ?? 0.4) * 100)}%)`;
          if (ghostCfg.action === "auto_pause" && row.status === "active") {
            await fetch(
              `https://graph.facebook.com/${GRAPH_VERSION}/${row.ad_id}?access_token=${META_TOKEN}`,
              { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "PAUSED" }) }
            );
            await supabaseAdmin
              .from("ad_content")
              .update({
                status: "paused_auto",
                ghost_flagged: true,
                ghost_reason: reason,
                ghost_checked_at: new Date().toISOString(),
                conversations,
                replies,
                reply_rate: replyRate,
                notes: reason,
              })
              .eq("id", row.id);
          } else {
            // โหมด alert: แค่ปักธงรออนุมัติ ไม่หยุดเอง
            await supabaseAdmin
              .from("ad_content")
              .update({
                ghost_flagged: true,
                ghost_reason: reason,
                ghost_checked_at: new Date().toISOString(),
                conversations,
                replies,
                reply_rate: replyRate,
              })
              .eq("id", row.id);
          }
          await notifyTelegram(`👻 ${reason}\nแอด: ${row.headline}\nเข้าไปตรวจ/อนุมัติหยุดในเว็บแอปได้เลย`);
        } else {
          // สุขภาพดี -> เคลียร์ธงเดิม (ถ้ามี) + อัปเดตตัวเลขล่าสุด
          await supabaseAdmin
            .from("ad_content")
            .update({
              ghost_flagged: false,
              ghost_reason: null,
              ghost_checked_at: new Date().toISOString(),
              conversations,
              replies,
              reply_rate: replyRate,
            })
            .eq("id", row.id);
        }
      }

      if (verdict === "underperform") {
        await fetch(
          `https://graph.facebook.com/${GRAPH_VERSION}/${row.ad_id}?access_token=${META_TOKEN}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: "PAUSED" }),
          }
        );
        await supabaseAdmin
          .from("ad_content")
          .update({ status: "paused_auto", notes: `auto-paused: CPA ${cpa ?? "N/A"} > target` })
          .eq("id", row.id);
        await notifyTelegram(`⏸ หยุดอัตโนมัติ: ${row.headline}\nCPA: ${cpa ?? "N/A"} บาท (เป้า ${cfg.target_cpa_thb})\nSpend วันนี้: ${spend}`);
      } else if (verdict === "outperform") {
        const suggested = Math.round((row.daily_budget_thb || cfg.daily_budget_thb || 300) * (1 + (cfg.scale_up_pct ?? 20) / 100));
        await supabaseAdmin
          .from("ad_content")
          .update({ scale_suggested: true, suggested_budget_thb: suggested })
          .eq("id", row.id);
        await notifyTelegram(`📈 ผลดี ขอเสนอเพิ่มงบ: ${row.headline}\nCPA: ${cpa} บาท\nงบปัจจุบัน: ${row.daily_budget_thb} -> เสนอ ${suggested} บาท/วัน\nเข้าไปอนุมัติในเว็บแอปได้เลย`);
      }

      return { id: row.id, spend, leads, cpa, verdict };
    }

    const settled = await Promise.all((activeAds ?? []).map((row) => processAd(row).catch((e) => {
      console.error(`monitor-ads: failed for ad_content id=${row.id} ad_id=${row.ad_id}`, e);
      return { id: row.id, verdict: "error", error: String(e) };
    })));
    const results = settled.filter(Boolean);

    return new Response(JSON.stringify({ ok: true, checked: results.length, results }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
