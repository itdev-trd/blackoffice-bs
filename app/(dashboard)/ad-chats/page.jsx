"use client";
import AdChatsTab from "@/components/features/ad-chats/AdChatsTab";
import { useDashboard } from "@/components/dashboard/DashboardContext";

export default function AdChatsPage() {
  const { goToChat } = useDashboard();
  // กดไอคอนแชทในรายชื่อ = เด้งไปกล่องแชทแล้วเปิดห้องนั้นให้เลย
  return <AdChatsTab active={true} onOpenChat={(id) => goToChat({ id })} />;
}
