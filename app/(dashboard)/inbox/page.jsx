"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ChatInboxTab from "@/components/features/inbox/ChatInboxTab";
import { useDashboard } from "@/components/dashboard/DashboardContext";

// เปิดห้องแชทจากลิงก์ /inbox?chat=<id> — ใช้ตอนกดแจ้งเตือนบนมือถือ (push แนบ id ห้องมาด้วย)
// เดิม push ชี้ไป "/?tab=inbox" ซึ่งเป็นเส้นทางเก่า เลยเด้งไปหน้าแรกแทนที่จะเข้าห้องแชท
function InboxPageInner() {
  const { gotoChat, setGotoChat, perm } = useDashboard();
  const router = useRouter();
  const params = useSearchParams();
  const chatId = params.get("chat");

  useEffect(() => {
    if (!chatId) return;
    setGotoChat({ id: chatId, at: Date.now() });
    // ล้าง query ออกหลังใช้ ไม่งั้นรีเฟรชหน้าทีไรก็เด้งกลับห้องเดิมตลอด
    router.replace("/inbox");
  }, [chatId, setGotoChat, router]);

  // service worker ส่งมาเมื่อกดแจ้งเตือนแล้ว client.navigate() ใช้ไม่ได้ (แท็บที่ SW ไม่ได้คุม)
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
    const onMsg = (e) => {
      const url = e.data?.type === "navigate" ? String(e.data.url || "") : "";
      if (url.startsWith("/inbox")) router.replace(url);
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [router]);

  return (
    <ChatInboxTab
      gotoChat={gotoChat}
      onGotoDone={() => setGotoChat(null)}
      // สิทธิ์ตอบแชทไม่ผูกกับเพจ — ใครเข้าหน้านี้ได้ ตอบได้ทุกเพจและทุก LINE OA
      // (allowed_pages ยังคุมงานโฆษณา/ตั้งค่าระดับเพจตามเดิม) · null = ไม่กรองเพจ
      allowedPages={null}
      alertAllowed={perm?.chatAlert !== false}
      alertMin={perm?.alertMinutes ?? 3}
      alertPages={perm?.alertPages ?? []}
      alertSound={perm?.alertSound !== false}
      alertNew={perm?.alertNew !== false}
      active={true}
    />
  );
}

export default function InboxPage() {
  // useSearchParams ต้องอยู่ใต้ Suspense ไม่งั้น Next ตอน build จะบังคับให้ทั้งหน้าเป็น dynamic
  return (
    <Suspense fallback={null}>
      <InboxPageInner />
    </Suspense>
  );
}
