/** A refused customer write, as the form needs it: the code, and which field. */
export interface CustomerWriteFailure {
  readonly code: string;
  readonly field?: string | undefined;
  readonly reason?: string | undefined;
}

export type CustomerWriteResult =
  | { readonly ok: true; readonly customerId: string }
  | { readonly ok: false; readonly failure: CustomerWriteFailure };

/** Customer error codes with their own copy; anything else reads as UNKNOWN. */
export const CUSTOMER_WRITE_CODES = [
  "FIELD_INVALID",
  "DUPLICATE_KEY",
  "VERSION_CONFLICT",
  "NOT_FOUND",
  "CUSTOMER_ARCHIVED",
  "CUSTOMER_ALREADY_ARCHIVED",
  "CUSTOMER_ALREADY_ACTIVE",
  "DENIED",
  "UNKNOWN",
] as const;

function known(code: unknown): string {
  return typeof code === "string" &&
    (CUSTOMER_WRITE_CODES as readonly string[]).includes(code)
    ? code
    : "UNKNOWN";
}

/**
 * Reads the authorization envelope (`ok`/`denial`) around the customer
 * outcome (`ok`/`customerId` or `ok`/`code`/`field`).
 */
export function readCustomerWrite(outcome: unknown): CustomerWriteResult {
  if (typeof outcome !== "object" || outcome === null)
    return { ok: false, failure: { code: "UNKNOWN" } };
  const envelope = outcome as {
    ok?: unknown;
    value?: unknown;
    denial?: unknown;
  };
  if (envelope.ok !== true) return { ok: false, failure: { code: "DENIED" } };
  const value = envelope.value as
    | { ok?: unknown; customerId?: unknown; code?: unknown; field?: unknown }
    | null
    | undefined;
  if (value?.ok === true && typeof value.customerId === "string")
    return { ok: true, customerId: value.customerId };
  return {
    ok: false,
    failure: {
      code: known(value?.code),
      ...(typeof value?.field === "string" ? { field: value.field } : {}),
    },
  };
}
