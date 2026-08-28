"use client";
import ChatInboxTab from "@/components/features/inbox/ChatInboxTab";
import { useDashboard } from "@/components/dashboard/DashboardContext";

export default function InboxPage() {
  const { gotoChat, setGotoChat, allowedPages, perm } = useDashboard();
  return (
    <ChatInboxTab
      gotoChat={gotoChat}
      onGotoDone={() => setGotoChat(null)}
      allowedPages={allowedPages}
      alertAllowed={perm?.chatAlert !== false}
      alertMin={perm?.alertMinutes ?? 3}
      alertPages={perm?.alertPages ?? []}
      alertSound={perm?.alertSound !== false}
      alertNew={perm?.alertNew !== false}
      active={true}
    />
  );
}
