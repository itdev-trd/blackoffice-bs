"use client";
import { useRouter } from "next/navigation";
import OverviewTab from "@/components/features/overview/OverviewTab";
import { useDashboard, ROUTE_PATH } from "@/components/dashboard/DashboardContext";

export default function OverviewPage() {
  const router = useRouter();
  const { adContent, adCopies, adImages, metricsToday, setCampaignFilter } = useDashboard();
  return (
    <OverviewTab
      adContent={adContent}
      adCopies={adCopies}
      adImages={adImages}
      metricsToday={metricsToday}
      onNavigate={(targetTab, filter) => {
        if (filter) setCampaignFilter(filter);
        router.push(ROUTE_PATH[targetTab]);
      }}
    />
  );
}
