"use client";

import { useCallback } from "react";
import { useReportWebVitals } from "next/web-vitals";

import { useObservability } from "@/components/providers/ObservabilityProvider";
import { webVitalEvent } from "@/lib/observability/webVitals";

type ReportWebVitals = Parameters<typeof useReportWebVitals>[0];
type WebVitalsMetric = Parameters<ReportWebVitals>[0];

export function WebVitals() {
  const observability = useObservability();
  const report = useCallback(
    (metric: WebVitalsMetric) => {
      observability.record(webVitalEvent(metric, Date.now()));
    },
    [observability],
  );

  useReportWebVitals(report);
  return null;
}
