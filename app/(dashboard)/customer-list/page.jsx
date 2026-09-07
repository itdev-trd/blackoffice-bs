"use client";

import CustomerListTab from "@/components/features/customer-list/CustomerListTab";
import { useDashboard } from "@/components/dashboard/DashboardContext";

export default function CustomerListPage() {
  const { goToChat } = useDashboard();
  // หน้านี้อ่านอย่างเดียว — ปุ่ม "ตอบในกล่องแชท" ในหน้าต่างแชทเล็กจึงพาไปตอบที่กล่องแชทจริง
  return <CustomerListTab onOpenChat={(id) => goToChat({ id })} />;
}
