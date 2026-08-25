import { observabilityEvent, type ObservabilityEvent } from "./event";

export const APPLICATION_RENDER_ERROR_CODE = "application.render.failed";

export function applicationRenderErrorEvent(
  boundary: "locale" | "global",
  occurredAt: number,
): ObservabilityEvent {
  return observabilityEvent({
    code: APPLICATION_RENDER_ERROR_CODE,
    severity: "error",
    dimensions: { boundary },
    occurredAt,
  });
}
