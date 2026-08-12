"use client";

import { useCallback } from "react";
import { useReportWebVitals } from "next/web-vitals";

import { useObservability } from "@/components/providers/ObservabilityProvider";
import { webVitalEvent } from "@/lib/observability/webVitals";

type ReportWebVitals = Parameters<typeof useReportWebVitals>[0];
type WebVitalsMetric = Parameters<ReportWebVitals>[0];

/**
 * The smallest possible client boundary for real-user performance metrics.
 *
 * The callback is stable because Next.js subscribes its six metric observers in
 * an effect keyed by this reference. Recreating it on every render would attach
 * duplicate observers and over-count a page load.
 */
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
