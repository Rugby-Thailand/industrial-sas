/**
 * Request identity: the UUIDv7 a client retries under, and the canonical form of
 * the arguments that retry has to match.
 *
 * Status: **implemented.** Pure module (plan §6.2): no Convex imports, and no
 * imports outside `convex/model/**`.
 *
 * Warehouse work retries. A handheld loses Wi-Fi mid-mutation, an operator taps
 * confirm twice because the screen did not repaint, a scanner fires on both the
 * press and the release. The plan's answer is a client-generated request ID that
 * is stable across retries of one intent (`ADR-0003` §4, §5 Q30, `OPS-0003-03`),
 * namespaced per organization so one tenant's IDs can neither collide with nor
 * disclose another's.
 *
 * Three things live here:
 *
 * 1. **UUIDv7 validation.** Not "looks like a UUID": the version nibble must be
 *    `7` and the variant bits must be `10`. A v4 UUID, a nil UUID, a Mongo
 *    ObjectId, or a 36-character string of the right shape are all refused. The
 *    reason to insist is that a v7's leading 48 bits are a millisecond timestamp,
 *    which is what makes request IDs sort by creation and makes an expiry sweep of
 *    idempotency records a range scan instead of a table scan. A v4 in that column
 *    is silently unsortable.
 *
 * 2. **The request namespace.** `(orgId, operation, requestId)` — the exact key
 *    `idempotencyRecords.by_orgId_operation_requestId` is declared on. Encoded
 *    with the same length-prefixed scheme as a bucket key and for the same
 *    reason: two different triples must never render the same string.
 *
 * 3. **Canonical argument form.** A replay under an existing key either hashes
 *    equal to the original arguments — a retry, which replays the original result
 *    — or it does not, and is refused. That decision needs a *canonical* rendering
 *    of the arguments: object key order, `-0`, and a sparse array must not change
 *    the digest, and a value the domain cannot compare must not be silently
 *    accepted. This module produces the string; hashing it is the Convex layer's
 *    job, because a digest is not domain algebra and `crypto.subtle` is not
 *    available to a pure module by contract.
 *
 * Every public function re-validates its input and answers a `Result`; nothing
 * throws, and nothing recurses without a bound.
 */
import { isArray, isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";

/* -------------------------------------------------------------------------- */
/* UUIDv7                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Canonical UUID text form, case-insensitive on input.
 *
 * Groups are captured so the version and variant nibbles can be read without a
 * second pass.
 */
const UUID_PATTERN =
  /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i;

/** The nibble RFC 9562 reserves for a time-ordered v7. */
const UUID_VERSION_7 = "7";

/** Variant `10x`: the first hex digit of the fourth group is 8, 9, a, or b. */
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

/**
 * A validated, lower-cased UUIDv7.
 *
 * Case is folded because `A1B2…` and `a1b2…` are the same UUID, and treating them
 * as two request IDs would let one intent post twice. Folding is ASCII-only by
 * construction: the pattern admits nothing else.
 */
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

/**
 * The millisecond timestamp encoded in a v7's leading 48 bits.
 *
 * Read with `Number.parseInt` on the hex text rather than by byte arithmetic:
 * 48 bits fit exactly in a double, so the parse is lossless, and there is no
 * buffer to get an endianness wrong in. Answers a `Result` because an invalid
 * request ID has no timestamp — not `0`, which would sort as 1970.
 */
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

/* -------------------------------------------------------------------------- */
/* Operation names and the request namespace                                   */
/* -------------------------------------------------------------------------- */

/**
 * `domain.subject.action`, the same shape a permission code has
 * ([catalogue](../../../docs/permissions.md) §1).
 *
 * The operation is part of the idempotency key, so it is a code-owned constant of
 * the mutation and never a client string; validating the shape here is what stops
 * a caller from widening the namespace with `"…"` or a 4 KB label.
 */
const OPERATION_PATTERN = /^[a-z][A-Za-z]*(?:\.[a-z][A-Za-z]*){1,4}$/;

/** The ledger's own operation names. Code-owned; a client never chooses one. */
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

/** Prefix, so a namespace key can never equal a bucket or conservation key. */
export const REQUEST_NAMESPACE_PREFIX = "RQ1";

const NAMESPACE_COMPONENT_PATTERN = /^[A-Za-z0-9_.-]+$/;
const MAX_NAMESPACE_COMPONENT_LENGTH = 96;

/**
 * The canonical `(orgId, operation, requestId)` key.
 *
 * Length-prefixed for the same reason a bucket key is: `("a", "bc")` and
 * `("ab", "c")` must not render alike, and an organization ID is not a value this
 * module gets to assume anything about.
 */
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

/* -------------------------------------------------------------------------- */
/* Canonical argument form                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How deep a canonicalizable argument tree may be.
 *
 * A bound rather than cycle detection: a bound is a constant-space check that
 * also refuses a legitimately absurd payload, whereas a visited-set catches only
 * the cyclic case and costs a set per call. Ledger arguments are two levels deep
 * in practice; eight is generous.
 */
export const MAX_CANONICAL_DEPTH = 8;

/**
 * A deterministic, injective-enough text form of an argument value.
 *
 * "Injective-enough" is precise: every distinct value this function accepts
 * renders to a distinct string, because strings are length-prefixed, numbers are
 * tagged, and object keys are sorted and length-prefixed too. That is what a
 * digest of the result can rely on.
 *
 * Accepted: `null`, booleans, finite numbers, strings, arrays, and plain objects.
 * Refused, each by name rather than by coercion:
 *
 * - `undefined` **as a value** — because `{ a: undefined }` and `{}` would
 *   otherwise hash alike, making "removed the field" look like a retry. An
 *   `undefined` *property* is dropped, which is the shape a Convex optional
 *   argument arrives in, and is why the two cases are distinguished.
 * - `NaN`, `Infinity`, `-Infinity` — no canonical text form that round-trips.
 * - `-0` — normalized to `0`, so two zero quantities do not hash differently.
 * - `bigint`, `symbol`, functions, `Date`, `Map`, `Set`, class instances — a
 *   caller that means one of these means something this domain cannot compare.
 *
 * A sparse array's holes are `null`, matching what `JSON.stringify` does and what
 * a Convex array can hold.
 */
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
    // A non-plain object is refused: `Object.getPrototypeOf` is `null` for a
    // null-prototype record and `Object.prototype` for a literal, and anything
    // else is a class instance whose fields are not its identity.
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
