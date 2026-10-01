// เทียบสมาชิกในแอป (tv_access) กับรายชื่อจริงจาก TradingView แล้วคืน "สิ่งที่ต้องแก้" ต่อแถว
// ใช้ในงานซิงก์ทุกคืน (tradingview action sync) — ไม่มี import ภายนอก ทดสอบได้ (tests/tv-reconcile.test.mjs)
//
// ทำไมต้องมี: เดิมงานซิงก์เก็บรายชื่อ TradingView ไว้ใน tv_external_members อย่างเดียว ไม่แตะ tv_access
// และไม่มีงานไหนเปลี่ยนสถานะคนหมดอายุ ผลคือ (วัด 1 ต.ค. 69) 364 แถวขึ้น "มีสิทธิ์" ทั้งที่วันหมดอายุผ่านไปแล้ว
// และบางคนต่ออายุ/เพิ่มสคริปต์บน TradingView ตรง ๆ แต่แอปยังโชว์วันเดิม
//
// กติกา: TradingView คือความจริงเรื่อง "มีสิทธิ์ถึงวันไหน"
//   · อยู่ในรายชื่อ TV     → expiration = ของ TV, status = active (หรือ expired ถ้าวันของ TV ผ่านไปแล้ว)
//   · ไม่อยู่ในรายชื่อ TV  → ถ้าแอปยังขึ้น active = ไม่มีสิทธิ์จริงแล้ว → status = expired
//   · แถวที่ถอนสิทธิ์ผ่านแอป (revoked) และ TV ก็ไม่มี = ตรงกันอยู่แล้ว ไม่แตะ
export type TvUser = { username: string; expiration?: string | null };

const sameTime = (a: unknown, b: unknown) => {
  const x = a ? Date.parse(String(a)) : null;
  const y = b ? Date.parse(String(b)) : null;
  if (x === null || y === null) return x === y;
  return Math.abs(x - y) < 1000;   // ต่างกันแค่หลักมิลลิวินาที (รูปแบบเวลาคนละแบบ) ถือว่าเท่ากัน
};

export function reconcileTvAccess(appRows: any[], tvUsers: Map<string, TvUser>, nowMs = Date.now(), nowIso = new Date(nowMs).toISOString()) {
  const patches: { id: number; patch: Record<string, unknown>; reason: string }[] = [];
  for (const r of appRows || []) {
    const tv = tvUsers.get(String(r.username || "").toLowerCase());
    if (tv) {
      // TradingView ไม่ส่งช่องวันหมดอายุมาเลย = ไม่รู้ ห้ามเดาเป็นตลอดชีพ
      if (tv.expiration === undefined) continue;
      const exp = tv.expiration ?? null;
      const status = exp && Date.parse(exp) <= nowMs ? "expired" : "active";
      const expChanged = !sameTime(r.expiration, exp);
      const tvExpChanged = !sameTime(r.tv_expiration, exp);
      const statusChanged = r.status !== status;
      // หมดอายุแล้วตั้ง tv_access_verified = false — ต้องเทียบกับค่าที่ควรเป็น ไม่ใช่ true เสมอ
      // ไม่งั้นแถวหมดอายุถูกเขียนซ้ำทุกคืน (เจอจริง: รอบที่สอง One STR โดนแก้ซ้ำ 409 แถว)
      if (!expChanged && !tvExpChanged && !statusChanged && r.tv_access_verified === (status === "active")) continue;
      const patch: Record<string, unknown> = {
        expiration: exp, tv_expiration: exp, status,
        tv_access_verified: status === "active", tv_verified_at: nowIso, tv_verify_error: null,
        last_synced_at: nowIso, updated_at: nowIso,
      };
      if (expChanged) patch.previous_expiration = r.expiration ?? null;
      patches.push({ id: r.id, patch, reason: expChanged ? "วันหมดอายุไม่ตรงกับ TradingView" : statusChanged ? "สถานะไม่ตรงกับ TradingView" : "ยืนยันกับ TradingView" });
    } else if (r.status === "active") {
      patches.push({
        id: r.id, reason: "ไม่พบใน TradingView",
        patch: {
          status: "expired", tv_access_verified: false, tv_verified_at: nowIso,
          tv_verify_error: "ไม่พบสิทธิ์นี้ใน TradingView (ซิงก์รายชื่อทุกคืน)", last_synced_at: nowIso, updated_at: nowIso,
        },
      });
    }
  }
  return patches;
}

// คนที่มีสิทธิ์อยู่บน TradingView แต่แอปไม่มีแถวเลย (ให้สิทธิ์ตรงบน TradingView ไม่ผ่านแอป)
// → นำเข้าเป็นแถวใหม่ให้เห็นในหน้าสมาชิก · ข้อมูลลูกค้า (ชื่อ/อีเมล/ไอดีเทรด) คัดลอกจากแถวสคริปต์อื่นของคนเดียวกันถ้ามี
// นำเข้าเฉพาะสิทธิ์ที่ยังไม่หมดอายุ — คนที่หมดไปนานแล้วไม่ต้องรก
export function missingFromApp(appRows: any[], tvUsers: Map<string, TvUser>, nowMs = Date.now()): TvUser[] {
  const have = new Set((appRows || []).map((r) => String(r.username || "").toLowerCase()));
  return [...tvUsers.entries()]
    .filter(([key, u]) => !have.has(key) && u.expiration !== undefined && (u.expiration === null || Date.parse(u.expiration) > nowMs))
    .map(([, u]) => u);
}
