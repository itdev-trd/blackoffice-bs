// คัดรายชื่อลูกค้าที่จะได้สิทธิ์สคริปต์ใหม่ย้อนหลัง (tradingview action backfill_script)
// ไม่มี import ภายนอก — tests/tv-backfill.test.mjs เรียกตรงด้วย node
//
// กติกาวันหมดอายุ (ตามที่ owner กำหนด 1 ต.ค. 69):
//   · ตลอดชีพครบทุกสคริปต์ต้นทาง           → tier "lifetime"  = ตลอดชีพ
//   · ตลอดชีพแค่บางตัว (หรือมีตัวเดียวที่ตลอดชีพ) → tier "decide" = แอดมินเลือก 1 เดือน หรือ ตลอดชีพ (รายคนได้)
//   · ไม่มีตัวไหนตลอดชีพ                       → tier "timed"   = วันหมดอายุที่ไกลที่สุดของตัวเดิม
export type BackfillTier = "lifetime" | "decide" | "timed";
export type BackfillChoice = "month" | "lifetime";
export type BackfillCand = {
  key: string; username: string; pines: Set<string>; lifetimePines: Set<string>; maxExp: number; tier: BackfillTier; profile: any;
};
export const MONTH_DAYS = 30;

export function buildBackfill(srcRows: any[], tgtRows: any[], sources: string[], mode: "any" | "all", nowMs = Date.now()) {
  const hasTarget = new Set((tgtRows || [])
    .filter((r: any) => r.status === "active" && (!r.expiration || Date.parse(r.expiration) > nowMs))
    .map((r: any) => String(r.username).toLowerCase()));
  const byUser = new Map<string, BackfillCand>();
  for (const r of srcRows || []) {
    const exp = r.expiration ? Date.parse(r.expiration) : null;
    if (exp !== null && !(exp > nowMs)) continue;     // หมดอายุแล้วไม่นับ
    const key = String(r.username || "").toLowerCase();
    if (!key) continue;
    const c = byUser.get(key) || { key, username: String(r.username), pines: new Set<string>(), lifetimePines: new Set<string>(), maxExp: 0, tier: "timed" as BackfillTier, profile: r };
    c.pines.add(String(r.pine_id));
    if (exp === null) c.lifetimePines.add(String(r.pine_id)); else c.maxExp = Math.max(c.maxExp, exp);
    // ข้อมูลลูกค้า (ชื่อ/อีเมล/ไอดีเทรด) ใช้จากแถวที่แก้ล่าสุด
    if ((Date.parse(r.updated_at || "") || 0) > (Date.parse(c.profile?.updated_at || "") || 0)) c.profile = r;
    byUser.set(key, c);
  }
  for (const c of byUser.values()) {
    c.tier = sources.every((p) => c.lifetimePines.has(p)) ? "lifetime" : c.lifetimePines.size > 0 ? "decide" : "timed";
  }
  const all = [...byUser.values()]
    .filter((c) => mode === "any" || sources.every((p) => c.pines.has(p)))
    .sort((a, b) => a.key.localeCompare(b.key));
  const pending = all.filter((c) => !hasTarget.has(c.key));
  const count = (t: BackfillTier) => pending.filter((c) => c.tier === t).length;
  return {
    all, pending,
    summary: { candidates: all.length, already: all.length - pending.length, pending: pending.length,
      lifetime: count("lifetime"), decide: count("decide"), timed: count("timed") },
  };
}

// วันหมดอายุของสคริปต์ใหม่ · null = ตลอดชีพ · choice ใช้กับ tier "decide" เท่านั้น
export function backfillExpiration(c: BackfillCand, choice: BackfillChoice = "month", nowMs = Date.now()): string | null {
  if (c.tier === "lifetime") return null;
  if (c.tier === "decide") return choice === "lifetime" ? null : new Date(nowMs + MONTH_DAYS * 86400000).toISOString();
  return new Date(c.maxExp).toISOString();
}

// การตัดสินใจรายคน (overrides) ชนะค่าตั้งต้นของกลุ่ม
export function choiceFor(c: BackfillCand, fallback: BackfillChoice, overrides: Record<string, unknown> = {}): BackfillChoice {
  const o = overrides[c.key];
  return o === "lifetime" || o === "month" ? o : fallback;
}
