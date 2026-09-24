// ลดขนาดรูปก่อนอัปโหลด — รูปจากมือถือมักหนัก 3-8 MB ซึ่งต้องอัปขึ้น storage หนึ่งรอบ
// แล้ว Meta/ทุกเครื่องที่เปิดแชทยังต้องโหลดต่ออีก (นับเป็น egress ของ Supabase ทุกครั้ง)
// Messenger แสดงรูปกว้างไม่เกินราว 1600px อยู่แล้ว ย่อเท่านี้ตาเปล่าไม่เห็นต่าง
const IMG_MAX_EDGE = 1600;
const IMG_SKIP_BYTES = 400 * 1024;      // เล็กกว่านี้บีบแล้วไม่คุ้มเวลาที่ใช้บีบ

export async function compressImage(file) {
  if (!file?.type?.startsWith("image/")) return file;
  if (file.type === "image/gif") return file;          // GIF ขยับได้ บีบแล้วภาพเคลื่อนไหวหาย
  if (file.size <= IMG_SKIP_BYTES) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, IMG_MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    // PNG โปร่งใสแปลงเป็น JPEG แล้วพื้นจะกลายเป็นสีดำ — ปูพื้นขาวก่อน
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;   // บีบแล้วไม่เล็กลง = ส่งไฟล์เดิม
    return new File([blob], String(file.name || "image").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;                                        // เบราว์เซอร์ไม่รองรับ = ส่งไฟล์เดิม
  }
}

// ชื่อไฟล์ใน storage สุ่มใหม่ทุกครั้ง (เนื้อหาไม่เปลี่ยน) ให้เบราว์เซอร์/CDN แคชได้ยาว
// ค่าเริ่มต้นของ Supabase คือ 1 ชม. ทำให้รูปเดิมถูกโหลดซ้ำจาก storage วันละหลายสิบรอบ
export const STORAGE_CACHE_SECONDS = "31536000";
