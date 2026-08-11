/**
 * The structured event every observability sink receives, and the redaction it
 * passes through first.
 *
 * `INT-05` (`docs/integration-contracts/observability-port.md`) names the port;
 * this is its payload. Two decisions shape it:
 *
 * ### A closed set of fields, not a bag
 *
 * An event carries a code, a request ID, a severity, and a small map of
 * *dimensions* whose values are constrained to numbers, booleans, and strings
 * from closed sets. It cannot carry a message, a stack, a document, or a
 * quantity. That is the whole point: this repository's tenants are Thai
 * manufacturers under PDPA, the operator is a data processor (`ADR-0012` §15),
 * and the cheapest way to leak tenant data is a telemetry call that took
 * `error.message` and shipped it somewhere.
 *
 * A free-text field would be used within a week. There isn't one.
 *
 * ### Redaction is enforced, not documented
 *
 * `redactDimensions` drops any value that could be an identifier or free text,
 * and it does so by allowlisting shapes rather than blocklisting patterns. A
 * blocklist of "things that look like an email" is a guess; an allowlist of
 * "numbers, booleans, and members of this enum" is a decision.
 *
 * Request IDs survive because they are server-minted, opaque, and the only
 * thing that makes a support conversation possible — they name a request, not a
 * person or a value.
 */

export const OBSERVABILITY_SEVERITIES = [
  "debug",
  "info",
  "warning",
  "error",
] as const;

export type ObservabilitySeverity = (typeof OBSERVABILITY_SEVERITIES)[number];

/**
 * A dimension value, after redaction.
 *
 * `string` is permitted because closed-set codes are strings — `"DENIED"`,
 * `"CURSOR_INVALID"`, `"th"`. `redactDimensions` is what stops an arbitrary
 * string from becoming one.
 */
export type DimensionValue = string | number | boolean;

export interface ObservabilityEvent {
  /** A code-owned event name, e.g. `ledger.read.denied`. Never user text. */
  readonly code: string;
  readonly severity: ObservabilitySeverity;
  /** The server-minted correlation ID, when one is in hand. */
  readonly requestId?: string;
  readonly dimensions: Readonly<Record<string, DimensionValue>>;
  /** Milliseconds since the epoch, supplied by the caller so this stays pure. */
  readonly occurredAt: number;
}

/**
 * The longest a dimension value may be.
 *
 * Short enough that a leaked free-text field is truncated into uselessness, and
 * long enough for every code this repository mints — the longest today is
 * `TRANSACTION_OUT_OF_WAREHOUSE_SCOPE` at 34 characters.
 */
export const MAX_DIMENSION_LENGTH = 64;

/** Dimension keys follow the same shape as the codes they describe. */
const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/**
 * A value that is *structurally* safe to report.
 *
 * The string rule is the load-bearing one: upper-case codes, lower-case dotted
 * or dashed identifiers, and locale tags. A SKU, a lot code, a person's name,
 * and a free-text error message all fail it — a SKU deliberately so, because
 * "which SKU errored" is a tenant's data even when it is convenient telemetry.
 */
const SAFE_STRING = /^[A-Za-z][A-Za-z0-9._-]*$/;

const isSafeString = (value: string): boolean =>
  value.length > 0 &&
  value.length <= MAX_DIMENSION_LENGTH &&
  SAFE_STRING.test(value);

/**
 * Keep only the dimensions that are safe to send anywhere.
 *
 * Total: a value it cannot vouch for is dropped, never coerced and never
 * truncated into something that looks like a code. Dropping is the honest
 * failure, because a truncated identifier is still an identifier.
 */
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
      // A non-finite number serializes as `null` in JSON, which reads as
      // "absent" rather than "wrong"; drop it instead.
      if (Number.isFinite(value)) safe[key] = value;
      continue;
    }
    if (typeof value === "string" && isSafeString(value)) {
      safe[key] = value;
    }
  }

  return Object.freeze(safe);
}

/** Build a redacted event. The only sanctioned way to make one. */
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
