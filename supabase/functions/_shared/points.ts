// บันทึกแต้มลงสมุด point_events — เรียกจาก edge function ตอนงานเกิดขึ้นจริง (ตอบแชท / ให้สิทธิ์ TV)
// ทุกฟังก์ชันที่นี่ "เงียบเมื่อพัง" — บันทึกแต้มล้มต้องไม่ทำให้การตอบแชท/ให้สิทธิ์ลูกค้าล้มตาม
import {
  normalizeOfficeHours, normalizeRules, scoreReply, capFor, overCap, isExcludedCustomer, thaiDayRange, tvEventKind, periodOf,
  type OfficeHours, type PointRules,
} from "./points-rules.ts";

export type PointConfig = { version: number; rules: PointRules; officeHours: OfficeHours; pages: string[] };

export async function loadPointConfig(admin: any): Promise<PointConfig> {
  const [{ data: ruleRow }, { data: settingRows }] = await Promise.all([
    admin.from("point_rules").select("version, rules").order("version", { ascending: false }).limit(1).maybeSingle(),
    admin.from("settings").select("key, value").in("key", ["office_hours", "leaderboard"]),
  ]);
  const byKey = new Map((settingRows || []).map((r: any) => [r.key, r.value]));
  const lb: any = byKey.get("leaderboard") || {};
  return {
    version: Number(ruleRow?.version) || 0,
    rules: normalizeRules(ruleRow?.rules),
    officeHours: normalizeOfficeHours(byKey.get("office_hours")),
    pages: Array.isArray(lb.pages) ? lb.pages.map(String) : [],
  };
}

// insert แบบกันซ้ำด้วย idem_key — ซ้ำ = ไม่ทำอะไร (คืน null)
export async function insertPointEvent(admin: any, ev: Record<string, unknown>) {
  const { data, error } = await admin.from("point_events")
    .upsert(ev, { onConflict: "idem_key", ignoreDuplicates: true }).select("id").maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export const replyIdemKey = (conversationId: string, msgAtMs: number) => `reply:${conversationId}:${msgAtMs}`;

// แต้มตอบแชทหนึ่งรอบ — คำตอบแรกของรอบเท่านั้น (idem_key ต่อรอบ) คนที่ตอบก่อนได้แต้ม
export async function awardReplyPoints(admin: any, input: {
  staffEmail: string; conversationId: string; pageId: string | null; pageName?: string | null;
  customerName?: string | null; source?: string | null; msgAt: string; replyAt: string; via?: string | null;
  config?: PointConfig;
}) {
  try {
    const staff = String(input.staffEmail || "").toLowerCase().trim();
    if (!staff || !input.msgAt) return;
    const cfg = input.config ?? await loadPointConfig(admin);
    if (cfg.pages.length && !cfg.pages.includes(String(input.pageId || ""))) return;
    if (isExcludedCustomer(cfg.officeHours, input.customerName, input.conversationId)) return;
    const msgMs = new Date(input.msgAt).getTime();
    const replyMs = new Date(input.replyAt).getTime();
    if (!Number.isFinite(msgMs) || !Number.isFinite(replyMs)) return;
    const score = scoreReply(msgMs, replyMs, cfg.officeHours, cfg.rules);
    if (score.points <= 0) return;

    // เพดานต่อห้องแชทต่อวัน (เวลาไทยของวันที่ตอบ) — เกินแล้วยังบันทึกไว้เป็น 0 แต้ม
    // เพื่อให้คนตอบเห็นได้ว่าทำไมรอบนี้ไม่ได้แต้ม แทนที่จะหายเงียบ
    const cap = capFor(score.kind, cfg.rules);
    let capped = false;
    if (cap > 0) {
      const day = thaiDayRange(replyMs);
      const { count } = await admin.from("point_events").select("id", { count: "exact", head: true })
        .eq("conversation_id", input.conversationId).eq("kind", score.kind).gt("points", 0)
        .gte("occurred_at", new Date(day.startMs).toISOString()).lt("occurred_at", new Date(day.endMs).toISOString());
      capped = overCap(count ?? 0, cap);
    }

    await insertPointEvent(admin, {
      staff_email: staff, kind: score.kind, points: capped ? 0 : score.points,
      occurred_at: input.replyAt, idem_key: replyIdemKey(input.conversationId, msgMs), rule_version: cfg.version,
      conversation_id: input.conversationId, page_id: input.pageId,
      evidence: {
        msg_at: input.msgAt, reply_at: input.replyAt, wait_min: score.wait_min, in_time: score.in_time,
        slow_min: cfg.officeHours.slow_min, slot_msg: score.slot_msg, slot_reply: score.slot_reply, used: score.used,
        full_points: score.points, ...(capped ? { capped: true, cap } : {}),
        customer_name: input.customerName ?? null, page_name: input.pageName ?? null, source: input.source ?? null, via: input.via ?? null,
      },
      created_by: staff,
    });
  } catch (e) {
    console.error("awardReplyPoints", e);
  }
}

// แต้มให้สิทธิ์/ต่ออายุ TradingView — เรียกหลัง TradingView ยืนยันว่ามีสิทธิ์จริงแล้วเท่านั้น
export async function awardTvPoints(admin: any, input: {
  staffEmail: string; tvAccessId: number; username: string; pineId: string;
  existing: { expiration?: string | null } | null; newExpiration: string | null; at: string;
}) {
  try {
    const staff = String(input.staffEmail || "").toLowerCase().trim();
    if (!staff) return;
    const kind = tvEventKind(input.existing, input.newExpiration);
    if (!kind) return;
    const cfg = await loadPointConfig(admin);
    const points = kind === "tv_grant" ? cfg.rules.tv.grant : cfg.rules.tv.renew;
    if (points <= 0) return;
    const period = periodOf(new Date(input.at).getTime());
    const idem = kind === "tv_grant"
      ? `tv_grant:${input.username.toLowerCase()}:${input.pineId}`     // ให้สิทธิ์ใหม่ได้ครั้งเดียวตลอดกาล
      : `tv_renew:${input.tvAccessId}:${period}`;                      // ต่ออายุได้แต้มเดือนละครั้งต่อสิทธิ์
    await insertPointEvent(admin, {
      staff_email: staff, kind, points, occurred_at: input.at, idem_key: idem, rule_version: cfg.version,
      tv_access_id: input.tvAccessId,
      evidence: {
        username: input.username, pine_id: input.pineId,
        expiration_before: input.existing?.expiration ?? null, expiration_after: input.newExpiration,
      },
      created_by: staff,
    });
  } catch (e) {
    console.error("awardTvPoints", e);
  }
}

// ถอนสิทธิ์ภายใน N วันหลังได้แต้ม = หักแต้มคืนด้วยรายการ reversal (แต่ละแต้มหักได้ครั้งเดียว)
export async function reverseTvPointsOnRevoke(admin: any, input: { tvAccessId: number; actorEmail: string | null; at: string }) {
  try {
    const cfg = await loadPointConfig(admin);
    const days = cfg.rules.tv.revoke_void_days;
    if (!days) return;
    const since = new Date(new Date(input.at).getTime() - days * 86400000).toISOString();
    const { data: rows } = await admin.from("point_events")
      .select("id, staff_email, points, kind, occurred_at")
      .eq("tv_access_id", input.tvAccessId).in("kind", ["tv_grant", "tv_renew"]).gt("points", 0).gte("occurred_at", since);
    for (const ev of rows || []) {
      await insertPointEvent(admin, {
        staff_email: ev.staff_email, kind: "reversal", points: -Number(ev.points), occurred_at: input.at,
        idem_key: `reverse:${ev.id}`, reverses_event_id: ev.id, tv_access_id: input.tvAccessId, rule_version: cfg.version,
        evidence: { reason: `ถอนสิทธิ์ภายใน ${days} วันหลังให้สิทธิ์`, reversed_kind: ev.kind, reversed_at: ev.occurred_at },
        note: `ถอนสิทธิ์ภายใน ${days} วัน`, created_by: input.actorEmail || "system",
      });
    }
  } catch (e) {
    console.error("reverseTvPointsOnRevoke", e);
  }
}
