"use client";
import AnalyzeTab from "@/components/features/analyze/AnalyzeTab";
import { useDashboard } from "@/components/dashboard/DashboardContext";

export default function AnalyzePage() {
  const { adContent, metricsHistoryByAd, settings, loadAll, restricted, perm } = useDashboard();
  return (
    <AnalyzeTab
      adContent={adContent}
      metricsHistoryByAd={metricsHistoryByAd}
      settings={settings}
      onChanged={loadAll}
      restricted={restricted}
      allowedAccounts={perm?.allowed || []}
    />
  );
}
