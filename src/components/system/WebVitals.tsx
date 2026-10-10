"use client";

import { useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";

import { useObservability } from "@/components/providers/ObservabilityProvider";
import { webVitalEvent } from "@/lib/observability/webVitals";
import { SpeedInsights } from "./SpeedInsights";
import { finishRouteTrace } from "@/lib/observability/sentryTraceBridge";

type ReportWebVitals = Parameters<typeof useReportWebVitals>[0];
type WebVitalsMetric = Parameters<ReportWebVitals>[0];

export function WebVitals() {
  const pathname = usePathname();
  useEffect(() => {
    if (
      process.env.NEXT_PUBLIC_SENTRY_ENABLED === "1" &&
      process.env.NEXT_PUBLIC_SENTRY_DSN
    ) {
      finishRouteTrace();
    }
  }, [pathname]);
  const observability = useObservability();
  const report = useCallback(
    (metric: WebVitalsMetric) => {
      observability.record(webVitalEvent(metric, Date.now()));
    },
    [observability],
  );

  useReportWebVitals(report);
  return <SpeedInsights />;
}
