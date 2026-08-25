import { observabilityEvent, type ObservabilityEvent } from "./event";

export const WEB_VITAL_CODE = "web.vital";

export interface WebVitalMeasurement {
  readonly name: string;
  readonly value: number;
  readonly delta: number;
  readonly rating: "good" | "needs-improvement" | "poor";
  readonly navigationType: string;
}

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
