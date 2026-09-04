"use client";
import ChatInboxTab from "@/components/features/inbox/ChatInboxTab";
import { useDashboard } from "@/components/dashboard/DashboardContext";

export default function InboxPage() {
  const { gotoChat, setGotoChat, perm } = useDashboard();
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
