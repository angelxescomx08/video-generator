import type { ReactNode } from "react";
import { AnalyticsTabs } from "@/components/analytics-tabs";

export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <AnalyticsTabs />
      {children}
    </div>
  );
}
