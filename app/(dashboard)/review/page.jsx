"use client";
import ReviewTab from "@/components/features/review/ReviewTab";
import { normalizeBrandConfig } from "@/components/features/generate/GenerateTab";
import { useDashboard } from "@/components/dashboard/DashboardContext";

export default function ReviewPage() {
  const { adCopies, adImages, settings, loadAll } = useDashboard();
  return (
    <ReviewTab
      adCopies={adCopies}
      adImages={adImages}
      brandConfig={normalizeBrandConfig(settings.brand_assets)}
      onChanged={loadAll}
    />
  );
}
