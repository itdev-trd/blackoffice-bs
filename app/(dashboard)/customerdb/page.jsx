"use client";

import CustomerOperationsTab from "@/components/features/customer-ops/CustomerOperationsTab";
import { useDashboard } from "@/components/dashboard/DashboardContext";

export default function CustomerDbPage() {
  const { goToChat, allowedPages } = useDashboard();
  return <CustomerOperationsTab allowedPages={allowedPages} onOpenChat={(id, at) => goToChat({ id, at })} />;
}
