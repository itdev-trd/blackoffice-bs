"use client";

import CustomerOperationsTab from "@/components/features/customer-ops/CustomerOperationsTab";
import { useDashboard } from "@/components/dashboard/DashboardContext";

export default function CustomerDbPage() {
  const { goToChat, allowedPages } = useDashboard();
  // รับได้สองแบบ: id ของห้องแชทตรง ๆ (แบบเดิม) หรือก้อนค้นหา { trade_id } / { username }
  // แท็บ TradingView รู้แค่เลขบัญชีเทรดกับ username จึงต้องให้กล่องแชทไปหาห้องเอง
  const openChat = (target, at) => goToChat(typeof target === "string" ? { id: target, at } : target);
  return <CustomerOperationsTab allowedPages={allowedPages} onOpenChat={openChat} />;
}
