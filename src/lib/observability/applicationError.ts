import { observabilityEvent, type ObservabilityEvent } from "./event";

export const APPLICATION_RENDER_ERROR_CODE = "application.render.failed";

/**
 * Report that a React route boundary caught a render failure without recording
 * the Error object. Messages, stacks, and digests can contain tenant data or
 * implementation detail and are deliberately kept out of this event.
 */
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
