import { isArray, isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";

const UUID_PATTERN =
  /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i;

const UUID_VERSION_7 = "7";

const UUID_VARIANT_NIBBLES: ReadonlySet<string> = new Set(["8", "9", "a", "b"]);

export type RequestIdentityError =
  | { readonly code: "REQUEST_ID_NOT_A_STRING"; readonly received: string }
  | { readonly code: "REQUEST_ID_MALFORMED"; readonly received: string }
  | {
      readonly code: "REQUEST_ID_WRONG_VERSION";
      readonly received: string;
      readonly version: string;
      readonly expected: string;
    }
  | {
      readonly code: "REQUEST_ID_WRONG_VARIANT";
      readonly received: string;
      readonly variant: string;
    }
  | { readonly code: "OPERATION_MALFORMED"; readonly received: string }
  | { readonly code: "NAMESPACE_COMPONENT_INVALID"; readonly component: string }
  | {
      readonly code: "ARGUMENT_NOT_CANONICALIZABLE";
      readonly path: string;
      readonly received: string;
    }
  | {
      readonly code: "ARGUMENT_TOO_DEEP";
      readonly path: string;
      readonly limit: number;
    };

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (isString(value)) {
    return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  }
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "non-finite";
  if (typeof value === "boolean" || typeof value === "bigint")
    return String(value);
  if (isArray(value)) return "array";
  return typeof value;
}

export function validateRequestId(
  requestId: string,
): Result<string, RequestIdentityError> {
  if (!isString(requestId)) {
    return fail({
      code: "REQUEST_ID_NOT_A_STRING",
      received: describe(requestId),
    });
  }
  const match = UUID_PATTERN.exec(requestId);
  if (match === null) {
    return fail({ code: "REQUEST_ID_MALFORMED", received: requestId });
  }
  const normalized = requestId.toLowerCase();
  const version = normalized[14]!;
  if (version !== UUID_VERSION_7) {
    return fail({
      code: "REQUEST_ID_WRONG_VERSION",
      received: normalized,
      version,
      expected: UUID_VERSION_7,
    });
  }
  const variant = normalized[19]!;
  if (!UUID_VARIANT_NIBBLES.has(variant)) {
    return fail({
      code: "REQUEST_ID_WRONG_VARIANT",
      received: normalized,
      variant,
    });
  }
  return ok(normalized);
}

export function requestIdTimestamp(
  requestId: string,
): Result<number, RequestIdentityError> {
  const validated = validateRequestId(requestId);
  if (!validated.ok) return validated;
  const hex = validated.value.slice(0, 8) + validated.value.slice(9, 13);
  const milliseconds = Number.parseInt(hex, 16);
  return isSafeInt(milliseconds)
    ? ok(milliseconds)
    : fail({ code: "REQUEST_ID_MALFORMED", received: validated.value });
}

const OPERATION_PATTERN = /^[a-z][A-Za-z]*(?:\.[a-z][A-Za-z]*){1,4}$/;

export const LEDGER_OPERATIONS = Object.freeze({
  post: "inventory.transaction.post",
  reverse: "inventory.transaction.reverse",
} as const);

export type LedgerOperation =
  (typeof LEDGER_OPERATIONS)[keyof typeof LEDGER_OPERATIONS];

export function validateOperation(
  operation: string,
): Result<string, RequestIdentityError> {
  if (!isString(operation) || !OPERATION_PATTERN.test(operation)) {
    return fail({ code: "OPERATION_MALFORMED", received: describe(operation) });
  }
  return ok(operation);
}

export const REQUEST_NAMESPACE_PREFIX = "RQ1";

const NAMESPACE_COMPONENT_PATTERN = /^[A-Za-z0-9_.-]+$/;
const MAX_NAMESPACE_COMPONENT_LENGTH = 96;

export function encodeRequestNamespace(input: {
  readonly orgId: string;
  readonly operation: string;
  readonly requestId: string;
}): Result<string, RequestIdentityError> {
  if (!isRecord(input)) {
    return fail({ code: "NAMESPACE_COMPONENT_INVALID", component: "input" });
  }
  if (
    !isString(input.orgId) ||
    input.orgId.length === 0 ||
    input.orgId.length > MAX_NAMESPACE_COMPONENT_LENGTH ||
    !NAMESPACE_COMPONENT_PATTERN.test(input.orgId)
  ) {
    return fail({ code: "NAMESPACE_COMPONENT_INVALID", component: "orgId" });
  }
  const operation = validateOperation(input.operation);
  if (!operation.ok) return operation;
  const requestId = validateRequestId(input.requestId);
  if (!requestId.ok) return requestId;

  const fields = [input.orgId, operation.value, requestId.value];
  return ok(
    REQUEST_NAMESPACE_PREFIX +
      fields.map((value) => `|${value.length}:${value}`).join(""),
  );
}

export const MAX_CANONICAL_DEPTH = 8;

export function canonicalArgumentText(
  value: unknown,
): Result<string, RequestIdentityError> {
  return renderCanonical(value, "$", 0);
}

function renderCanonical(
  value: unknown,
  path: string,
  depth: number,
): Result<string, RequestIdentityError> {
  if (depth > MAX_CANONICAL_DEPTH) {
    return fail({
      code: "ARGUMENT_TOO_DEEP",
      path,
      limit: MAX_CANONICAL_DEPTH,
    });
  }
  if (value === null) return ok("z");
  if (typeof value === "boolean") return ok(value ? "t" : "f");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return fail({
        code: "ARGUMENT_NOT_CANONICALIZABLE",
        path,
        received: describe(value),
      });
    }
    const normalized = value === 0 ? 0 : value;
    const text = String(normalized);
    return ok(`n${text.length}:${text}`);
  }
  if (isString(value)) return ok(`s${value.length}:${value}`);
  if (isArray(value)) {
    const parts: string[] = [];
    for (const [index, element] of value.entries()) {
      const rendered = renderCanonical(
        element === undefined ? null : element,
        `${path}[${index}]`,
        depth + 1,
      );
      if (!rendered.ok) return rendered;
      parts.push(rendered.value);
    }
    return ok(`a${parts.length}:${parts.join("")}`);
  }
  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== null && prototype !== Object.prototype) {
      return fail({
        code: "ARGUMENT_NOT_CANONICALIZABLE",
        path,
        received: describe(value),
      });
    }
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    const parts: string[] = [];
    for (const key of keys) {
      const rendered = renderCanonical(value[key], `${path}.${key}`, depth + 1);
      if (!rendered.ok) return rendered;
      parts.push(`k${key.length}:${key}${rendered.value}`);
    }
    return ok(`o${parts.length}:${parts.join("")}`);
  }
  return fail({
    code: "ARGUMENT_NOT_CANONICALIZABLE",
    path,
    received: describe(value),
  });
}
