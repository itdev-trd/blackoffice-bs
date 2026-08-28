"use client";
import SettingsTab from "@/components/features/settings/SettingsTab";
import { useDashboard } from "@/components/dashboard/DashboardContext";

export default function SettingsPage() {
  const { settings, loadAll, allowedSettings, allowedPages, goToChat } = useDashboard();
  return (
    <SettingsTab
      settings={settings}
      onSaved={loadAll}
      allowedSettings={allowedSettings}
      allowedPages={allowedPages}
      onOpenChat={(id, at) => goToChat({ id, at })}
    />
  );
}
