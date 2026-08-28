"use client";
import GenerateTab from "@/components/features/generate/GenerateTab";
import { useDashboard } from "@/components/dashboard/DashboardContext";

export default function GeneratePage() {
  const { settings, loadAll } = useDashboard();
  return <GenerateTab settings={settings} onGenerated={loadAll} />;
}
