"use client";
import CampaignsTab from "@/components/features/campaigns/CampaignsTab";
import { useDashboard } from "@/components/dashboard/DashboardContext";

export default function CampaignsPage() {
  const { adContent, metricsByAdId, loadAll, campaignFilter, setCampaignFilter } = useDashboard();
  return (
    <CampaignsTab
      adContent={adContent}
      metricsByAdId={metricsByAdId}
      onChanged={loadAll}
      filter={campaignFilter}
      onFilterChange={setCampaignFilter}
    />
  );
}
