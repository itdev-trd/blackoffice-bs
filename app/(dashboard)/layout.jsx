import { DashboardProvider } from "@/components/dashboard/DashboardContext";
import DashboardGate from "@/components/dashboard/DashboardGate";

export default function DashboardLayout({ children }) {
  return (
    <DashboardProvider>
      <DashboardGate>{children}</DashboardGate>
    </DashboardProvider>
  );
}
