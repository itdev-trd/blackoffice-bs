// รวมประวัติแชทสองชุดเข้าด้วยกันโดยใช้ mid (message id) เป็นตัวเดียวกัน
// ไม่มี import ภายนอก — tests/transcript-merge.test.mjs เรียกไฟล์นี้ตรงด้วย node
import { MAX_TRANSCRIPT_ITEMS } from "./transcript-cap.ts";

export const timeMs = (v: unknown) => {
  const t = v ? new Date(String(v)).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
};

// ผนวกข้อความที่ดึงมาใหม่ (fresh) เข้ากับของเดิม (prevTr) — ข้อความเดิมที่ Meta ไม่ได้คืนมารอบนี้ต้องอยู่ต่อ
// และคง metadata ที่แอปบันทึกไว้ตอนส่ง (th = ต้นฉบับไทยของแอดมิน, by/via, รูปจาก webhook) ที่ Meta สร้างคืนให้ไม่ได้
export function mergeTranscript(prevTr: any[], freshItems: any[], max = MAX_TRANSCRIPT_ITEMS): any[] {
  const previousByMid: Record<string, any> = {};
  for (const pm of prevTr) if (pm?.mid) previousByMid[String(pm.mid)] = pm;
  const newMids = new Set<string>();
  const fresh = freshItems.map((x) => ({ ...x }));
  for (const it of fresh) {
    if (!it?.mid) continue;
    newMids.add(String(it.mid));
    const old = previousByMid[String(it.mid)];
    if (!old) continue;
    if (typeof old.th === "string" && old.th.trim()) it.th = old.th;
    if (old.by) it.by = old.by;
    if (old.by_name && !it.by_name) it.by_name = old.by_name;
    if (old.via) it.via = old.via;
    if (old.img_source === "webhook" && old.img) { it.img = old.img; it.img_source = "webhook"; }
  }
  const carryOver = prevTr.filter((pm: any) => !pm?.mid || !newMids.has(String(pm.mid)));
  const merged = [...carryOver, ...fresh];
  merged.sort((a: any, b: any) => timeMs(a?.at) - timeMs(b?.at));
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

// ห้องนี้ยังต้องดึงประวัติย้อนหลังเพิ่มไหม
// history_synced_count = message_count ตอนที่ดึงครบแล้ว → ข้ามจนกว่าจะมีข้อความใหม่
// (message_count ของ Meta นับข้อความที่ไม่มีเนื้อหาด้วย ช่องว่างจึงอาจเหลือถาวร ถ้าไม่จำไว้จะดึงซ้ำทุกรอบ)
export function needsHistory(row: any, max = MAX_TRANSCRIPT_ITEMS): boolean {
  const tl = Array.isArray(row?.transcript) ? row.transcript.length : 0;
  const mc = Number(row?.message_count || 0);
  return mc > tl && tl < max && Number(row?.history_synced_count ?? -1) !== mc;
}
