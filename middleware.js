import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // หน้านโยบาย/ข้อกำหนด/คำขอลบข้อมูล ต้องเปิดได้แบบไม่ล็อกอิน — Meta กับ LINE ส่งบอทมาตรวจ
    // ถ้าโดน middleware เด้งไปหน้า login จะถือว่า URL ใช้ไม่ได้ และเผยแพร่แอปไม่ผ่าน
    "/((?!_next/static|_next/image|favicon-64.png|apple-touch-icon.png|icon-.*\\.png|manifest.webmanifest|sw.js|version.json|privacy-policy.html|data-deletion.html|terms.html).*)",
  ],
};
