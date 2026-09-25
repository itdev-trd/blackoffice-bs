// กติกาตัดสินสถานะของหน้า "สุขภาพระบบ" — แยกไว้ให้ทดสอบได้ (tests/health-rules.test.mjs) ไม่มี import ภายนอก
export type HealthStatus = "ok" | "warn" | "error";
export type HealthCheck = { key: string; label: string; status: HealthStatus; detail: string; days_left?: number | null };

export const WARN_DAYS = 21;   // เตือนล่วงหน้า 3 สัปดาห์ — ต่ออายุ token/App Review ต้องใช้เวลา
export const ERROR_DAYS = 7;

// วันหมดอายุเป็นวินาที (แบบที่ Meta debug_token ส่งมา) · 0/null = ไม่หมดอายุ
export function expiryStatus(expiresAtSec: number | null | undefined, nowMs = Date.now()): { status: HealthStatus; days_left: number | null } {
  const sec = Number(expiresAtSec || 0);
  if (!sec) return { status: "ok", days_left: null };
  const days = Math.floor((sec * 1000 - nowMs) / 86400000);
  if (days < 0) return { status: "error", days_left: days };
  if (days < ERROR_DAYS) return { status: "error", days_left: days };
  if (days < WARN_DAYS) return { status: "warn", days_left: days };
  return { status: "ok", days_left: days };
}

// อะไรที่ "เพิ่งพัง/เพิ่งแย่ลง" เทียบกับรอบก่อน — แจ้งเตือนเฉพาะตัวนี้ ไม่แจ้งซ้ำทุกชั่วโมง
const rank: Record<HealthStatus, number> = { ok: 0, warn: 1, error: 2 };
export function worsened(prev: HealthCheck[] | null | undefined, next: HealthCheck[]): HealthCheck[] {
  const before = new Map((prev || []).map((c) => [c.key, c.status]));
  return next.filter((c) => c.status !== "ok" && rank[c.status] > rank[before.get(c.key) || "ok"]);
}

// สถานะรวม = ตัวที่แย่ที่สุด
export function overall(checks: HealthCheck[]): HealthStatus {
  return checks.reduce<HealthStatus>((w, c) => (rank[c.status] > rank[w] ? c.status : w), "ok");
}
