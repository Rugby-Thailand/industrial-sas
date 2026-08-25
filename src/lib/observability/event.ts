export const OBSERVABILITY_SEVERITIES = [
  "debug",
  "info",
  "warning",
  "error",
] as const;

export type ObservabilitySeverity = (typeof OBSERVABILITY_SEVERITIES)[number];

export type DimensionValue = string | number | boolean;

export interface ObservabilityEvent {
  readonly code: string;
  readonly severity: ObservabilitySeverity;

  readonly requestId?: string;
  readonly dimensions: Readonly<Record<string, DimensionValue>>;

  readonly occurredAt: number;
}

export const MAX_DIMENSION_LENGTH = 64;

const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

const SAFE_STRING = /^[A-Za-z][A-Za-z0-9._-]*$/;

const isSafeString = (value: string): boolean =>
  value.length > 0 &&
  value.length <= MAX_DIMENSION_LENGTH &&
  SAFE_STRING.test(value);

export function redactDimensions(
  dimensions: Readonly<Record<string, unknown>>,
): Readonly<Record<string, DimensionValue>> {
  const safe: Record<string, DimensionValue> = {};

  for (const [key, value] of Object.entries(dimensions)) {
    if (!KEY_PATTERN.test(key)) continue;

    if (typeof value === "boolean") {
      safe[key] = value;
      continue;
    }
    if (typeof value === "number") {
      if (Number.isFinite(value)) safe[key] = value;
      continue;
    }
    if (typeof value === "string" && isSafeString(value)) {
      safe[key] = value;
    }
  }

  return Object.freeze(safe);
}

export function observabilityEvent(input: {
  readonly code: string;
  readonly severity: ObservabilitySeverity;
  readonly requestId?: string;
  readonly dimensions?: Readonly<Record<string, unknown>>;
  readonly occurredAt: number;
}): ObservabilityEvent {
  return Object.freeze({
    code: input.code,
    severity: input.severity,
    ...(input.requestId === undefined || input.requestId.length === 0
      ? {}
      : { requestId: input.requestId }),
    dimensions: redactDimensions(input.dimensions ?? {}),
    occurredAt: input.occurredAt,
  });
}
