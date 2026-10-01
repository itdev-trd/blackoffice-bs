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

// tvRows = รายชื่อจริงจาก TradingView (tv_external_members ซิงก์ทุกคืน) — ใช้เป็นหลักเรื่อง "มีสิทธิ์ถึงวันไหน"
// เพราะ tv_access (ประวัติที่ทำผ่านแอป) ค้างได้: ต่ออายุ/เพิ่มสคริปต์บน TradingView ตรง ๆ แล้วแอปไม่รู้
// (เจอจริง 1 ต.ค. 69: patie52546 ในแอปมีแค่ One STR หมด 6 ก.ย. แต่ TradingView มีทั้งสองตัวถึง 7 ต.ค. — ตกหล่น 48 คน)
// appRows = tv_access ใช้เอาข้อมูลลูกค้า (ชื่อ/อีเมล/ไอดีเทรด) และเป็นข้อมูลสำรองถ้าคนนั้นไม่อยู่ใน snapshot
export function buildBackfill(
  appRows: any[], appTgtRows: any[], sources: string[], mode: "any" | "all", nowMs = Date.now(),
  tvRows: any[] = [], tvTgtRows: any[] = [],
) {
  const alive = (r: any) => (r.status ?? "active") === "active" && (!r.expiration || Date.parse(r.expiration) > nowMs);
  const hasTarget = new Set([...(appTgtRows || []), ...(tvTgtRows || [])].filter(alive).map((r: any) => String(r.username).toLowerCase()));

  // สิทธิ์ต่อ (คน, สคริปต์): TradingView ชนะ · ไม่อยู่ใน snapshot ค่อยใช้ของแอป
  const grants = new Map<string, { username: string; pine: string; expiration: string | null }>();
  const keyOf = (u: string, p: string) => `${u.toLowerCase()}|${p}`;
  for (const r of appRows || []) if (r.status === undefined || r.status === "active") grants.set(keyOf(String(r.username), String(r.pine_id)), { username: String(r.username), pine: String(r.pine_id), expiration: r.expiration ?? null });
  for (const r of tvRows || []) grants.set(keyOf(String(r.username), String(r.pine_id)), { username: String(r.username), pine: String(r.pine_id), expiration: r.expiration ?? null });

  // ข้อมูลลูกค้าจากแถวแอปที่แก้ล่าสุดของคนนั้น
  const profileOf = new Map<string, any>();
  for (const r of appRows || []) {
    const k = String(r.username || "").toLowerCase();
    const cur = profileOf.get(k);
    if (!cur || (Date.parse(r.updated_at || "") || 0) > (Date.parse(cur.updated_at || "") || 0)) profileOf.set(k, r);
  }

  const byUser = new Map<string, BackfillCand>();
  for (const g of grants.values()) {
    const exp = g.expiration ? Date.parse(g.expiration) : null;
    if (exp !== null && !(exp > nowMs)) continue;     // หมดอายุแล้วไม่นับ
    const key = g.username.toLowerCase();
    if (!key) continue;
    const c = byUser.get(key) || { key, username: g.username, pines: new Set<string>(), lifetimePines: new Set<string>(), maxExp: 0, tier: "timed" as BackfillTier, profile: profileOf.get(key) || { username: g.username } };
    c.pines.add(g.pine);
    if (exp === null) c.lifetimePines.add(g.pine); else c.maxExp = Math.max(c.maxExp, exp);
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
    all, pending, hasTarget,
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
