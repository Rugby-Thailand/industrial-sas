import { observabilityEvent, type ObservabilityEvent } from "./event";

export const WEB_VITAL_CODE = "web.vital";

export interface WebVitalMeasurement {
  readonly name: string;
  readonly value: number;
  readonly delta: number;
  readonly rating: "good" | "needs-improvement" | "poor";
  readonly navigationType: string;
}

/**
 * Translate Next.js's browser metric into the repository's redacted event shape.
 *
 * The metric ID and browser attribution are deliberately omitted: neither is
 * needed for the aggregate series, while attribution can contain DOM selectors
 * or other page-specific detail. Route names belong at the approved adapter,
 * where their cardinality and tenant-data implications can be reviewed.
 */
export function webVitalEvent(
  metric: WebVitalMeasurement,
  occurredAt: number,
): ObservabilityEvent {
  return observabilityEvent({
    code: WEB_VITAL_CODE,
    severity: metric.rating === "good" ? "info" : "warning",
    dimensions: {
      metric: metric.name,
      value: metric.value,
      delta: metric.delta,
      rating: metric.rating,
      navigationType: metric.navigationType,
    },
    occurredAt,
  });
}
