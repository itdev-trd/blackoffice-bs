// คัดรายชื่อลูกค้าที่จะได้สิทธิ์สคริปต์ใหม่ย้อนหลัง (tradingview action backfill_script)
// ไม่มี import ภายนอก — tests/tv-backfill.test.mjs เรียกตรงด้วย node
export type BackfillCand = { key: string; username: string; pines: Set<string>; lifetime: boolean; maxExp: number; profile: any };

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
    const c = byUser.get(key) || { key, username: String(r.username), pines: new Set<string>(), lifetime: false, maxExp: 0, profile: r };
    c.pines.add(String(r.pine_id));
    if (exp === null) c.lifetime = true; else c.maxExp = Math.max(c.maxExp, exp);
    // ข้อมูลลูกค้า (ชื่อ/อีเมล/ไอดีเทรด) ใช้จากแถวที่แก้ล่าสุด
    if ((Date.parse(r.updated_at || "") || 0) > (Date.parse(c.profile?.updated_at || "") || 0)) c.profile = r;
    byUser.set(key, c);
  }
  const all = [...byUser.values()]
    .filter((c) => mode === "any" || sources.every((p) => c.pines.has(p)))
    .sort((a, b) => a.key.localeCompare(b.key));
  const pending = all.filter((c) => !hasTarget.has(c.key));
  return {
    all, pending,
    summary: { candidates: all.length, already: all.length - pending.length, pending: pending.length, lifetime: pending.filter((c) => c.lifetime).length },
  };
}

// วันหมดอายุของสคริปต์ใหม่ — มีตลอดชีพสักตัว = ตลอดชีพ (null) ไม่งั้นเท่ากับวันที่ไกลที่สุด
export const backfillExpiration = (c: BackfillCand): string | null => (c.lifetime ? null : new Date(c.maxExp).toISOString());
