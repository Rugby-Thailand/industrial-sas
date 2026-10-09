import { redactDimensions, type DimensionValue } from "./dimensions";

export {
  MAX_DIMENSION_LENGTH,
  OBSERVABILITY_DIMENSION_KEYS,
  redactDimensions,
} from "./dimensions";
export type { DimensionValue } from "./dimensions";

export const OBSERVABILITY_SEVERITIES = [
  "debug",
  "info",
  "warning",
  "error",
] as const;

export type ObservabilitySeverity = (typeof OBSERVABILITY_SEVERITIES)[number];

export interface ObservabilityEvent {
  readonly code: string;
  readonly severity: ObservabilitySeverity;

  readonly requestId?: string;
  readonly dimensions: Readonly<Record<string, DimensionValue>>;

  readonly occurredAt: number;
}

/** Code used when a caller passes an unreviewed event name. */
export const REJECTED_EVENT_CODE = "observability.code.rejected";

/** Current application emitters only; add a code after reviewing its payload. */
export const OBSERVABILITY_EVENT_CODES = Object.freeze([
  "application.render.failed",
  "web.vital",
  "workspace.query.failed",
  REJECTED_EVENT_CODE,
] as const);

export const MAX_REQUEST_ID_LENGTH = 64;

// Server/client UUIDs only (`mintRequestId`, `crypto.randomUUID`). Named
// fixture IDs and user-supplied slugs cannot be distinguished from content.
const REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const safeCode = (code: unknown): string =>
  typeof code === "string" &&
  (OBSERVABILITY_EVENT_CODES as readonly string[]).includes(code)
    ? code
    : REJECTED_EVENT_CODE;

const safeSeverity = (severity: unknown): ObservabilitySeverity =>
  (OBSERVABILITY_SEVERITIES as readonly unknown[]).includes(severity)
    ? (severity as ObservabilitySeverity)
    : "error";

/** Bounded opaque request ID, or undefined when absent or unsafe. */
export function normalizeRequestId(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_REQUEST_ID_LENGTH &&
    REQUEST_ID.test(value)
    ? value
    : undefined;
}

export function observabilityEvent(input: {
  readonly code: string;
  readonly severity: ObservabilitySeverity;
  readonly requestId?: string;
  readonly dimensions?: Readonly<Record<string, unknown>>;
  readonly occurredAt: number;
}): ObservabilityEvent {
  const requestId = normalizeRequestId(input.requestId);
  return Object.freeze({
    code: safeCode(input.code),
    severity: safeSeverity(input.severity),
    ...(requestId === undefined ? {} : { requestId }),
    dimensions: redactDimensions(input.dimensions ?? {}),
    occurredAt: Number.isFinite(input.occurredAt) ? input.occurredAt : 0,
  });
}

/**
 * Re-apply the policy to an event built elsewhere (for example a literal typed
 * as {@link ObservabilityEvent}). Sinks call this before writing anything.
 */
export function sanitizeObservabilityEvent(
  event: ObservabilityEvent,
): ObservabilityEvent {
  return observabilityEvent({
    code: event?.code,
    severity: event?.severity,
    ...(event?.requestId === undefined ? {} : { requestId: event.requestId }),
    dimensions: event?.dimensions ?? {},
    occurredAt: event?.occurredAt,
  });
}
