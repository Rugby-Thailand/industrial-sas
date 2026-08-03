/**
 * Tenant document boundary — the table names, the failure vocabulary, the
 * ownership assertion, the write shapes, and the direct-ID document access the
 * tenant-bound accessor (`G-102`, `ADR-0002` §2) is being assembled from.
 *
 * Status: **primitives, adapter-backed document access by ID, and bounded
 * `orgId`-first indexed reads.** Nothing here touches Convex. There is no
 * `ctx.db`, no `ConvexError`, and no `query`/`mutation` wrapper. Storage is
 * reached only through `TenantStoragePort` (below): six async methods over a
 * tenant table name, opaque string IDs, plain records, and one indexed page
 * request. `createTenantDocumentAccess` binds one port to one tenant and one
 * request, and is the only thing a caller is given.
 *
 * `G-102` is **not** closed by this. What is missing is everything that makes the
 * boundary reachable: the Convex adapter that implements the port over `ctx.db`,
 * the auth wrapper that mints the scope from a resolved tenant context, and the
 * public function wrappers. Each is a later slice, and each is expected to be
 * written *in terms of* what is here rather than re-deriving any of it.
 *
 * Why an injected port rather than `ctx.db` directly: isolation is a property of
 * the decision sequence around a read, not of the read — and a decision sequence
 * that can only run inside a Convex transaction can only be tested inside one.
 * With the port injected, the interesting cases are all reachable from an
 * in-memory fake: a lookup that answers with another tenant's document, a lookup
 * that answers with something that is not a document at all, and a mutation that
 * must be proved *not* to have been called. The adapter that lands later supplies
 * the same five methods over `ctx.db`; the sequence below does not change shape
 * when it does. Same arrangement, same reason, as `convex/lib/tenantContext.ts`.
 *
 * Every property this boundary has to hold is decidable without a database.
 *
 * - "this table is tenant-scoped" is a fact about `TENANT_TABLES`
 *   (`convex/lib/schemaPolicy.ts`), and the accessor needs it at *runtime*, not
 *   only in the type system, because a table name can arrive from a `string`
 *   the compiler never saw.
 * - "this document belongs to the caller's tenant" is a comparison between a
 *   document's `orgId` and the resolved context's organization — one function,
 *   one code, no branch a caller can distinguish.
 * - "this write does not choose its own tenant" is a property of the payload
 *   (`INV-0001-02`): the discriminator is derived from the resolved context, and
 *   a caller-supplied `orgId` is a rejected write, never an overwritten field.
 *
 * Three rules govern everything below.
 *
 * 1. **Absent and foreign are the same answer** (`INV-0002-03`). A document that
 *    does not exist and a document belonging to another tenant both raise
 *    `NOT_FOUND` with an identical public payload. Any distinction — a different
 *    code, a different message, an extra field, a different property order —
 *    turns the accessor into an existence oracle over other tenants' IDs.
 * 2. **The public payload carries a code and a request ID and nothing else**
 *    (`INV-0002-07`). No table name, no document ID, no `orgId`, no field name,
 *    no payload echo. The message is one fixed string, identical for every code,
 *    so it cannot become a channel either. Diagnosis is server-side, keyed by the
 *    request ID (plan §7.4).
 * 3. **Every write by ID is preceded by a read that proves ownership.** A patch,
 *    a replace, or a delete re-reads the document through the port and asserts
 *    ownership before the port is asked to change anything. A document ID needs
 *    no index, so a document ID is exactly the value a caller can hold without
 *    ever having been allowed to see it (`ADR-0002` §2).
 *
 * Baseline:
 * [ADR-0002](../../docs/adr/0002-convex-tenant-boundary-and-index-discipline.md),
 * [ADR-0001](../../docs/adr/0001-multi-tenant-saas-and-identity-ownership.md),
 * [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §6.1, §7.1.
 */
import type { GenericId } from "convex/values";

import { TENANT_TABLES, type TenantTableName } from "./schemaPolicy";
import {
  describeTenantIndex,
  type TenantIndexFacts,
} from "./tenantIndexPolicy";
import { TENANT_DISCRIMINATOR } from "./tenantTable";

/**
 * The tenant table names, re-exported so a caller of the accessor never has to
 * decide which module owns the vocabulary. `schemaPolicy` remains the single
 * definition; this is a view of it.
 */
export type { TenantTableName };

/* -------------------------------------------------------------------------- */
/* Runtime table allowlist                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Build a set that cannot be extended after construction.
 *
 * `Object.freeze` alone is not enough for a `Set`: `add`, `delete`, and `clear`
 * mutate internal slots rather than properties, so a frozen `Set` is still a
 * writable `Set`. Shadowing the three mutators with throwing own properties is
 * what makes the allowlist actually immutable at runtime — and an allowlist that
 * any imported module could widen is not an allowlist.
 *
 * The failure is a plain `Error`, not a `TenantDbError`: mutating the allowlist is
 * a programming mistake with no request behind it, so there is no request ID to
 * quote and nothing for a client to see.
 */
function immutableSet<Value>(values: Iterable<Value>): ReadonlySet<Value> {
  const set = new Set(values);

  for (const method of ["add", "delete", "clear"] as const) {
    Object.defineProperty(set, method, {
      value: (): never => {
        throw new Error(
          `The tenant table allowlist is immutable; "${method}" is not ` +
            "available. Add the table to TENANT_TABLES in " +
            "convex/lib/schemaPolicy.ts instead.",
        );
      },
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  return Object.freeze(set);
}

/**
 * The runtime allowlist of tenant-scoped tables, derived from `TENANT_TABLES`.
 *
 * Derived, not restated: a second hand-written list would be a second place to
 * forget a table, and the table that gets forgotten is the one that then reads
 * without a tenant. `schemaPolicy` already proves that this list and the declared
 * schema agree, so this set is exactly "the tables whose documents carry
 * `orgId`".
 *
 * Exposed as a `ReadonlySet` because membership is the only question worth
 * asking of it. Iterating the allowlist to build a query is not a use case; the
 * accessor takes one table at a time.
 */
export const TENANT_TABLE_NAMES: ReadonlySet<TenantTableName> =
  immutableSet(TENANT_TABLES);

/* -------------------------------------------------------------------------- */
/* Failure vocabulary                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The stable, PII-free codes this boundary may raise.
 *
 * Coarse on purpose, in the same way `TenantContextDenialCode` is coarse.
 * `NOT_FOUND` deliberately covers "no such document", "malformed document", and
 * "another tenant's document" so that the three are indistinguishable from
 * outside (`INV-0002-03`).
 *
 * - `INVALID_TENANT_TABLE` — a table name that is not tenant-scoped: a global
 *   table, or a name in no part of the schema.
 * - `NOT_FOUND` — the document is absent, unusable, or not this tenant's.
 * - `INVALID_WRITE` — the payload tried to choose its own tenant or to write a
 *   Convex system field.
 * - `INVALID_LIMIT` — a read asked for an unbounded or nonsensical page size.
 * - `INVALID_INDEX_RESULT` — an index-backed read produced a document that does
 *   not satisfy the tenant predicate the index claims to enforce.
 * - `INVALID_INDEX_QUERY` — an index-backed read was *asked for* in a shape this
 *   boundary cannot bound: an index the schema does not declare on that table, an
 *   equality prefix that is not a contiguous prefix of that index after `orgId`,
 *   or a pagination cursor that is not a usable opaque string.
 *
 * `INVALID_INDEX_QUERY` is the one code added after the vocabulary was first
 * declared, and it is added rather than folded into `INVALID_TENANT_TABLE`
 * because the two are different mistakes with different fixes: one names a table
 * this accessor may not scope, the other names a read this accessor cannot prove
 * bounded. Both are decided before storage is touched, and neither payload says
 * which table, index, or field was at fault. Renaming any code here is a
 * breaking change, in the same way renaming a permission code is (D-22).
 */
export const TENANT_DB_ERROR_CODES = [
  "INVALID_TENANT_TABLE",
  "NOT_FOUND",
  "INVALID_WRITE",
  "INVALID_LIMIT",
  "INVALID_INDEX_QUERY",
  "INVALID_INDEX_RESULT",
] as const;

export type TenantDbErrorCode = (typeof TENANT_DB_ERROR_CODES)[number];

/**
 * The single message every `TenantDbError` carries.
 *
 * One message for every code, matching the wording
 * `convex/lib/tenantContext.ts` uses for denials: a caller learns *that* the
 * request failed and which request to quote. The text is fixed and interpolates
 * nothing, so `error.message` can be logged, surfaced, or serialized without
 * anyone having to re-audit whether it leaks.
 */
export const TENANT_DB_ERROR_MESSAGE =
  "This request was denied. Quote the request ID when asking for help.";

/**
 * Everything a client may learn about a boundary failure: a coarse code and the
 * request ID to quote.
 *
 * No message field, because the message is a constant this module already
 * exports — putting it in the payload would invite interpolation. No cause, no
 * table, no ID, no field name.
 */
export interface PublicTenantDbError {
  readonly code: TenantDbErrorCode;
  readonly requestId: string;
}

/**
 * The one error type this boundary throws.
 *
 * The instance carries no data beyond the code and the request ID, which means
 * the "does this leak?" question has a single answer for every throw site: it
 * cannot, because there is nothing else to leak. That is stricter than a
 * conventional error, and deliberately so — the alternative is a helpful message
 * ("warehouse abc123 belongs to org xyz") that is exactly the cross-tenant
 * disclosure the isolation tier exists to prevent.
 *
 * `toPublic` is the only sanctioned way to turn one of these into a payload. The
 * Convex layer that owns the transport is expected to do
 * `throw new ConvexError(error.toPublic())` and nothing else.
 */
export class TenantDbError extends Error {
  override readonly name = "TenantDbError";

  readonly code: TenantDbErrorCode;
  readonly requestId: string;

  constructor(code: TenantDbErrorCode, requestId: string) {
    super(TENANT_DB_ERROR_MESSAGE);
    this.code = code;
    this.requestId = requestId;
  }

  /** The payload a client may receive. Frozen: a caller cannot enrich it. */
  toPublic(): PublicTenantDbError {
    return Object.freeze({ code: this.code, requestId: this.requestId });
  }
}

/* -------------------------------------------------------------------------- */
/* Table names                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Narrow a `string` to a tenant table name, or fail closed.
 *
 * A global table (`organizations`, `users`, `permissions`) is rejected with the
 * *same* code as a nonexistent table, because both mean the same thing to this
 * boundary: the caller asked the tenant-scoped accessor for something it cannot
 * scope. Global tables are readable without a tenant in hand by definition
 * (`ADR-0002` §1), so they are read through their own path, not by relaxing this
 * one.
 *
 * Deviation worth naming: the assertion takes a `requestId` as well as the value,
 * because `TenantDbError` has no other way to be correlated. TypeScript allows
 * additional parameters on an assertion signature; the call site still has to
 * reference this function through a declaration with an explicit type, which a
 * `function` declaration is.
 */
export function assertTenantTableName(
  value: string,
  requestId: string,
): asserts value is TenantTableName {
  if (!TENANT_TABLE_NAMES.has(value as TenantTableName)) {
    throw new TenantDbError("INVALID_TENANT_TABLE", requestId);
  }
}

/* -------------------------------------------------------------------------- */
/* Ownership                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The internal tenant key: the Convex document ID of the organization
 * (`ADR-0001` §1, `G-002`). The Clerk organization ID is an external correlation
 * key and is never used for scoping.
 */
export type TenantOrgId = GenericId<"organizations">;

/**
 * The minimum a document must be for this boundary to reason about it: something
 * with an `orgId`.
 *
 * Structural on purpose. Binding the primitives to `DataModel` document types
 * would mean the ownership check could only be exercised through the schema, and
 * the cases worth testing hardest — a document with no `orgId`, a document whose
 * `orgId` is the wrong type, a document from another tenant — are precisely the
 * ones the schema's types say cannot happen. They can happen: a document arrives
 * from a database, not from the type system.
 */
export interface TenantOwnedDocument {
  readonly orgId: TenantOrgId;
}

/**
 * Assert that a lookup result is a usable document owned by the expected tenant,
 * and return it; otherwise throw `NOT_FOUND`.
 *
 * Every rejection produces the identical public payload — same code, same
 * message, same fields — for all five reasons a document can fail here:
 *
 * - the lookup found nothing (`null` or `undefined`);
 * - the value is not a document (a primitive, an array, a function);
 * - the value has no own `orgId`;
 * - its `orgId` is not a usable string;
 * - its `orgId` is another tenant's.
 *
 * Collapsing "absent" and "foreign" is the whole point (`INV-0002-03`). A caller
 * holding a document ID from another organization must not be able to tell,
 * through a code, a message, or a timing-free difference in shape, whether that
 * ID exists at all.
 *
 * A malformed `expectedOrgId` fails the same way rather than throwing something
 * more descriptive: an ownership check that cannot name the owner has no safe
 * answer, and the safe failure is "not found".
 *
 * The `Document` type parameter is the *caller's* claim about what the table
 * holds, carried through unchanged. This function verifies ownership, not the
 * document's field types; the schema and its validators own that. Nothing is
 * copied, frozen, or otherwise touched, so the returned reference is the one that
 * came in.
 */
export function assertOwnedDocument<
  Document extends TenantOwnedDocument = TenantOwnedDocument,
>(document: unknown, expectedOrgId: TenantOrgId, requestId: string): Document {
  // Constructed lazily: every read passes through here, and an `Error` built on
  // the success path would capture a stack trace for nothing.
  const notFound = (): TenantDbError =>
    new TenantDbError("NOT_FOUND", requestId);

  if (!isUsableKey(expectedOrgId)) throw notFound();
  if (document === null || typeof document !== "object") throw notFound();
  if (Array.isArray(document)) throw notFound();
  if (!Object.hasOwn(document, TENANT_DISCRIMINATOR)) throw notFound();

  const owner: unknown = (document as Record<string, unknown>)[
    TENANT_DISCRIMINATOR
  ];
  if (!isUsableKey(owner)) throw notFound();
  if (owner !== expectedOrgId) throw notFound();

  return document as Document;
}

/**
 * A tenant key is usable when it is a non-empty string with no surrounding
 * whitespace.
 *
 * The whitespace clause is not cosmetic: `" orgA"` and `"orgA"` are different
 * strings and would compare unequal, so accepting a padded key would make
 * ownership depend on how a value was transported. Rejecting it keeps the
 * comparison the only thing that decides ownership. No format or length check
 * beyond that — the shape of a Convex ID is Convex's to change.
 */
function isUsableKey(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.trim() === value
  );
}

/* -------------------------------------------------------------------------- */
/* Write payloads                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Fields a caller may never supply in a write.
 *
 * `orgId` because the tenant is derived from the resolved context and never taken
 * from the caller (`INV-0001-02`); `_id` and `_creationTime` because they are
 * Convex's. Presence is what is rejected, not value: a payload that mentions
 * `orgId` at all is a payload written by code that believes it may choose a
 * tenant, and silently dropping the field would leave that belief in place.
 */
export const FORBIDDEN_WRITE_FIELDS = [
  TENANT_DISCRIMINATOR,
  "_id",
  "_creationTime",
] as const;

type ForbiddenWriteField = (typeof FORBIDDEN_WRITE_FIELDS)[number];

/**
 * A write payload as a caller may express it: any record that does not mention a
 * forbidden field.
 *
 * The `?: never` members make `{ orgId }` a compile error, so the runtime check
 * below is the second line of defence rather than the only one — the same
 * two-layer arrangement `tenantFields` uses in `convex/lib/tenantTable.ts`, and
 * for the same reason: a cast, a spread the compiler cannot see, or plain
 * JavaScript can defeat the type.
 */
export type TenantWritePayload = Record<string, unknown> & {
  readonly [Key in ForbiddenWriteField]?: never;
};

/** A caller's payload with the derived tenant discriminator prepended. */
export type TenantInsertPayload<Payload extends TenantWritePayload> = {
  readonly orgId: TenantOrgId;
} & Payload;

/**
 * Reject a payload that is not a writable record, or that mentions a field the
 * caller does not own.
 *
 * Any key beginning with `_` is refused, not only the two named ones: the
 * underscore prefix is Convex's namespace, so a payload reaching into it is
 * wrong whether or not this list has caught up. It also disposes of an own
 * `__proto__` key, which `JSON.parse` can produce and which would otherwise be
 * copied onto a fresh object.
 */
function assertWritableFields(
  payload: unknown,
  requestId: string,
): Record<string, unknown> {
  const invalid = (): TenantDbError =>
    new TenantDbError("INVALID_WRITE", requestId);

  if (payload === null || typeof payload !== "object") throw invalid();
  if (Array.isArray(payload)) throw invalid();

  for (const key of Object.keys(payload)) {
    if (key === TENANT_DISCRIMINATOR || key.startsWith("_")) throw invalid();
  }

  return payload as Record<string, unknown>;
}

/**
 * Build the document to insert: the derived `orgId`, then the caller's fields.
 *
 * The discriminator is written first so the stored document reads the way the
 * schema declares it (`tenantFields`, D-18), and it comes from `orgId` — a value
 * the accessor will take from the resolved tenant context, never from a client
 * (`INV-0001-02`).
 *
 * Returns a new frozen object. New, because mutating the caller's payload to add
 * a tenant would make the caller's object silently tenant-specific, and reusing
 * it would let a later mutation of that object change what was inserted. Frozen,
 * because nothing between here and `db.insert` has any business adding a field —
 * least of all a second opinion about `orgId`.
 */
export function tenantInsertPayload<Payload extends TenantWritePayload>(
  payload: Payload,
  orgId: TenantOrgId,
  requestId: string,
): TenantInsertPayload<Payload> {
  const fields = assertWritableFields(payload, requestId);

  if (!isUsableKey(orgId)) {
    throw new TenantDbError("INVALID_WRITE", requestId);
  }

  const document: Record<string, unknown> = { [TENANT_DISCRIMINATOR]: orgId };
  for (const [key, value] of Object.entries(fields)) {
    document[key] = value;
  }

  return Object.freeze(document) as TenantInsertPayload<Payload>;
}

/**
 * Validate a patch payload and return it unchanged.
 *
 * No `orgId` is added, because a patch that re-states the tenant is a patch that
 * could move a document between tenants; the discriminator is written once, at
 * insert, and is never part of an update.
 *
 * The caller's object is returned by reference rather than copied. A copy would
 * have to decide what to do with an explicitly `undefined` field — which Convex
 * reads as "delete this field" — and a helper whose job is to reject unsafe
 * fields has no business making that decision. It is returned unfrozen for the
 * same reason it is not copied: freezing it would mutate the caller's input.
 */
export function tenantUpdatePayload<Payload extends TenantWritePayload>(
  payload: Payload,
  requestId: string,
): Payload {
  assertWritableFields(payload, requestId);
  return payload;
}

/* -------------------------------------------------------------------------- */
/* Storage port                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A stored or storable document as this boundary handles one: a plain record of
 * unknown values.
 *
 * The port deals in records, not in `DataModel` document types, because the port
 * is below the schema: its job is to move an opaque payload to and from storage,
 * and the moment it knows what a `warehouses` row looks like it has an opinion
 * that belongs in the schema and its validators.
 */
export type TenantStorageDocument = Record<string, unknown>;

/* -------------------------------------------------------------------------- */
/* Bounded indexed reads                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One equality term of an index prefix: a declared index field and the value it
 * must equal.
 *
 * Values are `unknown` because an index field can be a string, a number, a
 * boolean, or a document ID, and the boundary compares nothing — it passes the
 * value to the index. What it does check is that the *field* is the next declared
 * field of the index, which is what keeps a read on a declared prefix.
 */
export interface TenantIndexEqualityTerm {
  readonly field: string;
  readonly value: unknown;
}

/** An ordered equality prefix, as a caller supplies it (without `orgId`). */
export type TenantIndexEquality = readonly TenantIndexEqualityTerm[];

/**
 * The largest page any single indexed read may ask for.
 *
 * A cap, not a default, and a rejection rather than a silent clamp: a caller that
 * asked for 5,000 rows has a plan that a quietly truncated answer would corrupt,
 * and finding that out at the boundary is cheaper than finding it out in a
 * report. 100 is the plan's page size for handheld list views (§7.3); a larger
 * page is a cursor loop, which `page` exists to make available.
 */
export const TENANT_INDEX_MAX_PAGE_SIZE = 100;

/**
 * The largest pagination cursor this boundary will carry, in UTF-16 code units.
 *
 * Cursors are opaque: this boundary never parses, decodes, or interprets one, so
 * the only properties it can check are "is a non-empty string" and "is not
 * absurdly large". 4,096 is a deliberately conservative bound — comfortably above
 * any cursor Convex is documented to mint, comfortably below a value worth
 * passing to an adapter that may decode it. It exists so an attacker-supplied
 * cursor cannot become an unbounded input to whatever parses it downstream.
 */
export const TENANT_INDEX_MAX_CURSOR_LENGTH = 4096;

/** What `page` is asked for: a bounded size and, optionally, where to resume. */
export interface TenantIndexPageRequest {
  readonly limit: number;
  /** An opaque cursor from a previous page. Absent means the first page. */
  readonly cursor?: string | undefined;
}

/**
 * One page of an indexed read: the rows, whether the index is exhausted, and the
 * cursor to resume from.
 *
 * Named to match Convex's `paginate` result so the adapter is a rename and not a
 * translation, and returned frozen so a caller cannot append to a page it was
 * handed and pass it on as a wider result.
 */
export interface TenantIndexPage<
  Document extends TenantOwnedDocument = TenantOwnedDocument,
> {
  readonly page: readonly Document[];
  readonly isDone: boolean;
  /** Opaque; pass it back verbatim as `cursor`. Never parsed here. */
  readonly continueCursor: string;
}

/**
 * The single seam between this boundary and a database. Five methods, all async,
 * all keyed by a tenant table name and an opaque document ID.
 *
 * This is the *only* object in the tenant read/write path that touches storage.
 * `createTenantDocumentAccess` holds one in a closure and never hands it back, so
 * "what can reach the database from here?" has one answer: whatever is written in
 * this file.
 *
 * Three deliberate narrownesses:
 *
 * - **`get` answers `unknown`.** Not `TenantOwnedDocument | null`, which would be
 *   the adapter asserting the very thing the boundary exists to check. A
 *   database answers with whatever is stored — including a row written before a
 *   schema change, or one written by a path that predates this module — so the
 *   type says so and `assertOwnedDocument` decides.
 * - **IDs are `string`.** A `GenericId<Table>` is a branded string, and a brand
 *   is a compile-time claim, not a proof that the ID belongs to the table, the
 *   tenant, or the database. Treating an inbound ID as opaque keeps the runtime
 *   checks the only thing that decides anything; the adapter is where a `string`
 *   becomes a Convex ID, and it is the adapter's business if that fails.
 * - **There is no filter, no scan, and no arbitrary predicate.** Reads are either
 *   by document ID or by a declared `orgId`-first index with an equality prefix
 *   and a bounded page size (`indexedPage`). A `filter` would make the cheapest
 *   correct-looking query a full scan, and a scan of a tenant table is how
 *   cross-tenant reads happen (`INV-0002-04`).
 *
 * A port method may throw. If it throws a `TenantDbError`, that error travels
 * unchanged — it is already the safe shape, and re-wrapping it would either lose
 * the request ID or invent a second error identity for the same failure.
 */
export interface TenantStoragePort {
  /** The stored value at `table`/`id`, or `null`/`undefined` when there is none. */
  readonly get: (table: TenantTableName, id: string) => Promise<unknown>;

  /** Store `document` in `table` and answer with its new ID. */
  readonly insert: (
    table: TenantTableName,
    document: TenantStorageDocument,
  ) => Promise<string>;

  /** Shallow-merge `fields` into the document at `table`/`id`. */
  readonly patch: (
    table: TenantTableName,
    id: string,
    fields: TenantStorageDocument,
  ) => Promise<void>;

  /** Replace the document at `table`/`id` with `document` in full. */
  readonly replace: (
    table: TenantTableName,
    id: string,
    document: TenantStorageDocument,
  ) => Promise<void>;

  /** Remove the document at `table`/`id`. */
  readonly delete: (table: TenantTableName, id: string) => Promise<void>;

  /**
   * One page of `table`'s `index`, restricted to the equality prefix in
   * `equality` and to at most `page.limit` rows.
   *
   * The only non-ID read on this port, and deliberately the only shape of one:
   * a declared index name, an ordered equality prefix whose first term is always
   * `orgId`, a bounded limit, and an opaque cursor. There is no field selection,
   * no ordering argument, no range, and no predicate — each of those is a way to
   * express a read whose cost and tenancy this boundary could not check.
   *
   * Answers `unknown`, exactly as `get` does, and for the same reason: a page is
   * whatever the adapter produced, and the boundary — not the adapter — decides
   * whether it is a bounded page of owned, well-formed documents. An adapter that
   * returned `TenantIndexPage` would be asserting the property the caller of this
   * port exists to verify.
   */
  readonly indexedPage: (
    table: TenantTableName,
    index: string,
    equality: TenantIndexEquality,
    page: { readonly limit: number; readonly cursor: string | null },
  ) => Promise<unknown>;
}

/* -------------------------------------------------------------------------- */
/* Tenant-scoped document access                                               */
/* -------------------------------------------------------------------------- */

/**
 * What a bound accessor is bound to: one tenant and one request.
 *
 * Both values are server-derived. `orgId` is the resolved context's organization
 * document ID (`ActiveTenantContext.organization._id`, never a client-supplied
 * value, `INV-0001-02`) and `requestId` is the server-minted correlation ID
 * (plan §7.4). The auth wrapper that lands later is what builds this from
 * `resolveTenantContext`; the structural shape is stated here so this module
 * does not have to import the resolver to be usable or testable.
 *
 * Nothing is validated at construction time. An unusable `orgId` does not throw
 * a distinctive error here — it makes every read answer "not found" and every
 * write refuse, which is the same failure a caller would see for any other reason
 * they may not touch a document. Fail closed, and fail identically.
 */
export interface TenantDocumentAccessScope {
  /** The tenant every operation is confined to. */
  readonly orgId: TenantOrgId;
  /** The request every failure is correlated by. */
  readonly requestId: string;
}

/**
 * A bounded reader over one declared index, one equality prefix, and one tenant.
 *
 * Four methods, all of which answer a bounded number of rows. There is
 * deliberately no `filter`, no `collect`, no `all`, no `count`, and no way to ask
 * for an unbounded result: every method either reads at most one or two rows, or
 * takes a limit that is checked against `TENANT_INDEX_MAX_PAGE_SIZE`. A reader
 * that could return "everything" would make the expensive read the convenient
 * one, and the expensive read on a tenant table is the one that scans it
 * (`INV-0002-04`).
 *
 * Every row a reader answers with has been proved to be a well-formed document
 * owned by this tenant. A row that is not is `INVALID_INDEX_RESULT` — never
 * dropped from the result. Filtering it out would mean an index that had gone
 * wrong, an adapter that had ignored the prefix, or a document that had been
 * written untenanted would all show up as a slightly shorter list, which is
 * precisely the failure nobody notices.
 *
 * The reader is frozen and stateless. Calling `first` and then `page` twice
 * issues three independent port calls; nothing is cached, for the same reason
 * ownership is never cached.
 */
export interface TenantIndexReader<
  Document extends TenantOwnedDocument = TenantOwnedDocument,
> {
  /** The first matching row, or `null`. Asks storage for one row. */
  readonly first: () => Promise<Document | null>;

  /**
   * The only matching row, `null` when there is none, or `INVALID_INDEX_RESULT`
   * when there is more than one.
   *
   * Asks storage for two rows: one to answer with, one to detect the collision.
   * This is the read every "unique by contract" check owes — Convex has no unique
   * constraint, so a second row under a key that is supposed to be unique is a
   * broken invariant, and a reader that answered with the first of them would be
   * how the breakage stays invisible.
   */
  readonly unique: () => Promise<Document | null>;

  /** At most `limit` matching rows. `limit` is capped, not clamped. */
  readonly take: (limit: number) => Promise<readonly Document[]>;

  /** One page, with the cursor to resume from. */
  readonly page: (
    request: TenantIndexPageRequest,
  ) => Promise<TenantIndexPage<Document>>;
}

/**
 * Tenant-confined document access by ID.
 *
 * Each `Document` type parameter is the *caller's* claim about what the table
 * holds, carried through unchanged, exactly as in `assertOwnedDocument`:
 * ownership is verified here, field types are the schema's business.
 */
export interface TenantDocumentAccess {
  /**
   * The document at `table`/`id` when this tenant owns it, otherwise `null`.
   *
   * `null` covers every reason there is no readable document: absent, another
   * tenant's, or unusable (not an object, no `orgId`, an `orgId` that is not a
   * usable key). One answer for all of them, so a caller holding a foreign ID
   * learns nothing from the fact that it got `null` (`INV-0002-03`).
   *
   * Throws only `INVALID_TENANT_TABLE`, for a table this accessor may not scope.
   */
  readonly get: <Document extends TenantOwnedDocument = TenantOwnedDocument>(
    table: TenantTableName,
    id: string,
  ) => Promise<Document | null>;

  /**
   * The document at `table`/`id`, or `NOT_FOUND` — the same code, message, and
   * payload for absent, foreign, and malformed.
   *
   * The `X` suffix follows Convex's own `getX` convention: the variant that
   * throws rather than answering `null`.
   */
  readonly getX: <Document extends TenantOwnedDocument = TenantOwnedDocument>(
    table: TenantTableName,
    id: string,
  ) => Promise<Document>;

  /**
   * Insert `payload` into `table` under this tenant, and answer with the new ID.
   *
   * The tenant discriminator is derived from the scope; a payload that mentions
   * `orgId`, `_id`, `_creationTime`, or any other `_`-prefixed field is refused
   * with `INVALID_WRITE` rather than corrected.
   */
  readonly insert: <Payload extends TenantWritePayload>(
    table: TenantTableName,
    payload: Payload,
  ) => Promise<string>;

  /** Shallow-merge `fields` into a document this tenant owns. */
  readonly patch: <Payload extends TenantWritePayload>(
    table: TenantTableName,
    id: string,
    fields: Payload,
  ) => Promise<void>;

  /**
   * Replace a document this tenant owns, re-deriving the discriminator.
   *
   * `document` is the whole document minus the fields a caller never owns, so
   * the derived `orgId` is stamped again on the way in — a replace that dropped
   * it would leave an untenanted row, and one that took it from the caller could
   * move a row between tenants.
   */
  readonly replace: <Payload extends TenantWritePayload>(
    table: TenantTableName,
    id: string,
    document: Payload,
  ) => Promise<void>;

  /** Delete a document this tenant owns. */
  readonly delete: (table: TenantTableName, id: string) => Promise<void>;

  /**
   * A bounded reader over `table`'s `index`, restricted to this tenant and to the
   * equality prefix in `equalityAfterOrg`.
   *
   * `equalityAfterOrg` is the prefix *after* the discriminator, in index order:
   * `byIndex("warehouses", "by_orgId_status_code", [{ field: "status", value:
   * "ACTIVE" }])` reads `["orgId", "status"]` of `["orgId", "status", "code"]`.
   * The `orgId` term is prepended here from the scope, and a caller that supplies
   * `orgId` itself is refused rather than corrected (`INV-0001-02`) — a read that
   * names its own tenant is written by code that believes it may choose one.
   *
   * Validated *before* storage is touched, and synchronously: an unknown table
   * (`INVALID_TENANT_TABLE`), an index the schema does not declare on that table,
   * or an equality list that is not a contiguous prefix of that index
   * (`INVALID_INDEX_QUERY`) all throw from this call, so no port method is ever
   * reached with a request this boundary could not bound.
   *
   * The returned reader is frozen and holds no port, no scope, and no rows.
   */
  readonly byIndex: <
    Document extends TenantOwnedDocument = TenantOwnedDocument,
  >(
    table: TenantTableName,
    index: string,
    equalityAfterOrg?: TenantIndexEquality,
  ) => TenantIndexReader<Document>;
}

/**
 * Bind a storage port to one tenant and one request.
 *
 * The returned object is frozen and closes over the port, so there is no
 * property, getter, or method on it that answers with the port, the scope, or a
 * document belonging to anyone else. A caller that wants unscoped storage has to
 * be handed a port of its own by whoever built this one — which is the point:
 * the set of places that can do that is a list of call sites, not a capability
 * every holder of an accessor inherits.
 *
 * The read/write sequence is fixed for every method:
 *
 * 1. assert the table is tenant-scoped (`INVALID_TENANT_TABLE`);
 * 2. for anything addressed by ID, read through the port and assert ownership
 *    (`NOT_FOUND`);
 * 3. for anything that writes, validate the payload and derive the
 *    discriminator (`INVALID_WRITE`);
 * 4. only then call the port's mutating method.
 *
 * Step 2 precedes step 3 on purpose. It means the answer a caller gets for an ID
 * it may not touch is `NOT_FOUND` *whatever payload it sent*: if payload
 * validation ran first, the choice between `INVALID_WRITE` and `NOT_FOUND` would
 * tell a caller that its ID had been accepted, and a caller that can learn that
 * has an existence oracle over another tenant's IDs.
 *
 * There is no caching between step 2 and step 4. The document is re-read on
 * every operation because a stale ownership decision is an ownership decision
 * about a document that may since have moved, and because Convex gives the whole
 * mutation one transaction — the read costs a transaction-local lookup, not a
 * round trip.
 */
export function createTenantDocumentAccess(
  scope: TenantDocumentAccessScope,
  port: TenantStoragePort,
): TenantDocumentAccess {
  const { orgId, requestId } = scope;

  /** The table check every method starts with, named once. */
  const requireTenantTable = (table: TenantTableName): void => {
    // `table` is typed as a tenant table, and is checked anyway: the value can
    // arrive from a `string` the compiler never saw (an argument validator, a
    // JSON body, a cast) and the allowlist is the only thing that decides.
    assertTenantTableName(table, requestId);
  };

  /**
   * The one predicate behind every ID-addressed operation: table allowed,
   * document present, document owned. Throws `NOT_FOUND` otherwise.
   */
  const readOwned = async <
    Document extends TenantOwnedDocument = TenantOwnedDocument,
  >(
    table: TenantTableName,
    id: string,
  ): Promise<Document> => {
    requireTenantTable(table);

    // An unusable ID is answered without asking storage. Not an optimisation: it
    // keeps a value like `""` or `" abc"` from reaching an adapter that may
    // interpret it, and it is the same answer a valid-but-foreign ID gets.
    if (!isUsableKey(id)) throw new TenantDbError("NOT_FOUND", requestId);

    return assertOwnedDocument<Document>(
      await port.get(table, id),
      orgId,
      requestId,
    );
  };

  const get = async <
    Document extends TenantOwnedDocument = TenantOwnedDocument,
  >(
    table: TenantTableName,
    id: string,
  ): Promise<Document | null> => {
    try {
      return await readOwned<Document>(table, id);
    } catch (error) {
      // `get` is `getX` with one code folded, so the two cannot disagree about
      // what "owned" means. Only `NOT_FOUND` folds, and it folds whoever raised
      // it — from the port or from the ownership assertion it means the same
      // thing: there is no document here this tenant may read. Every other code,
      // and anything that is not a `TenantDbError`, travels unchanged.
      if (error instanceof TenantDbError && error.code === "NOT_FOUND") {
        return null;
      }
      throw error;
    }
  };

  const insert = async <Payload extends TenantWritePayload>(
    table: TenantTableName,
    payload: Payload,
  ): Promise<string> => {
    requireTenantTable(table);
    const document = tenantInsertPayload(payload, orgId, requestId);

    // Boundary cast: the derived document is a frozen record of unknown values,
    // which is what the port takes. The cast drops the `orgId` refinement the
    // helper's return type carries and adds nothing.
    return await port.insert(table, document as TenantStorageDocument);
  };

  const patch = async <Payload extends TenantWritePayload>(
    table: TenantTableName,
    id: string,
    fields: Payload,
  ): Promise<void> => {
    await readOwned(table, id);
    const update = tenantUpdatePayload(fields, requestId);

    // Boundary cast: `Payload` is constrained to a record of unknown values; the
    // constraint is not an index signature the compiler will infer for a type
    // parameter, so it is restated here. The object is the caller's, unchanged.
    await port.patch(table, id, update as TenantStorageDocument);
  };

  const replace = async <Payload extends TenantWritePayload>(
    table: TenantTableName,
    id: string,
    document: Payload,
  ): Promise<void> => {
    await readOwned(table, id);

    // The same derivation as `insert`, for the same reason: a replaced document
    // is a whole document, and its tenant is this scope's, not the caller's.
    const replacement = tenantInsertPayload(document, orgId, requestId);

    // Boundary cast: see `insert`.
    await port.replace(table, id, replacement as TenantStorageDocument);
  };

  const remove = async (table: TenantTableName, id: string): Promise<void> => {
    await readOwned(table, id);
    await port.delete(table, id);
  };

  /* ------------------------------------------------------------------------ */
  /* Bounded indexed reads                                                     */
  /* ------------------------------------------------------------------------ */

  const invalidQuery = (): TenantDbError =>
    new TenantDbError("INVALID_INDEX_QUERY", requestId);
  const invalidResult = (): TenantDbError =>
    new TenantDbError("INVALID_INDEX_RESULT", requestId);

  /**
   * A page size is usable when it is a positive safe integer no larger than the
   * cap. Rejected, never clamped: see `TENANT_INDEX_MAX_PAGE_SIZE`.
   *
   * `typeof` is checked although the parameter is typed `number`, for the same
   * reason the table allowlist is checked although the parameter is typed: the
   * value can arrive from an argument validator, a JSON body, or a cast. `NaN`,
   * `Infinity`, `1.5`, `0`, and `-1` all fail as one code.
   */
  const requireLimit = (limit: number): number => {
    if (typeof limit !== "number" || !Number.isSafeInteger(limit)) {
      throw new TenantDbError("INVALID_LIMIT", requestId);
    }
    if (limit < 1 || limit > TENANT_INDEX_MAX_PAGE_SIZE) {
      throw new TenantDbError("INVALID_LIMIT", requestId);
    }
    return limit;
  };

  /**
   * Normalise a cursor: absent means the first page, anything else must be a
   * non-empty string within the documented bound.
   *
   * The cursor is never parsed, decoded, or compared here. An empty string is
   * refused rather than treated as "start again", because a caller that passed one
   * meant to resume and would otherwise silently re-read page one forever.
   */
  const requireCursor = (cursor: string | undefined): string | null => {
    if (cursor === undefined) return null;
    if (typeof cursor !== "string") throw invalidQuery();
    if (cursor.length === 0) throw invalidQuery();
    if (cursor.length > TENANT_INDEX_MAX_CURSOR_LENGTH) throw invalidQuery();
    return cursor;
  };

  /**
   * Build the full equality prefix: the derived tenant term, then the caller's,
   * checked term by term against the declared index fields.
   *
   * Four things are refused, all as one code:
   *
   * - more terms than the index has fields after `orgId`;
   * - a term that is not a `{ field, value }` object, or whose `value` is absent
   *     or `undefined` — "equal to nothing" is not an equality;
   * - a field that is not the *next* declared field, which covers a reordered
   *     prefix, a gap, and a field the index does not have at all;
   * - a repeated field, including `orgId` itself (`INV-0001-02`).
   *
   * A shorter prefix is legal and is the point of the check: `["orgId"]` alone,
   * or `["orgId", "status"]` of a three-field index, is still a bounded index
   * range. What is not legal is skipping a field, because an index cannot answer
   * an equality on its third field without one on its second.
   *
   * The caller's array and its terms are read, never written: each accepted term
   * is copied into a fresh frozen object, so a later mutation of the caller's
   * objects cannot change what a reader queries.
   */
  const equalityPrefix = (
    facts: TenantIndexFacts,
    supplied: TenantIndexEquality,
  ): TenantIndexEquality => {
    if (!Array.isArray(supplied)) throw invalidQuery();
    if (supplied.length > facts.fieldsAfterOrg.length) throw invalidQuery();

    const terms: TenantIndexEqualityTerm[] = [
      Object.freeze({ field: TENANT_DISCRIMINATOR, value: orgId }),
    ];
    const seen = new Set<string>([TENANT_DISCRIMINATOR]);

    for (let position = 0; position < supplied.length; position += 1) {
      const term: unknown = supplied[position];
      if (term === null || typeof term !== "object") throw invalidQuery();
      if (Array.isArray(term)) throw invalidQuery();

      const record = term as Record<string, unknown>;
      const field: unknown = record.field;
      if (typeof field !== "string") throw invalidQuery();
      if (seen.has(field)) throw invalidQuery();
      if (field !== facts.fieldsAfterOrg[position]) throw invalidQuery();
      if (!Object.hasOwn(record, "value")) throw invalidQuery();
      if (record.value === undefined) throw invalidQuery();

      seen.add(field);
      terms.push(Object.freeze({ field, value: record.value }));
    }

    return Object.freeze(terms);
  };

  /**
   * Assert one row of an index result is a well-formed document owned by this
   * tenant, as `INVALID_INDEX_RESULT`.
   *
   * The same predicate as an ID-addressed read, with a different code: by ID,
   * "not yours" is an answer a caller is allowed to provoke and must not be able
   * to distinguish from "absent" (`NOT_FOUND`, `INV-0002-03`). Inside an index
   * result it is not an answer at all — the query carried an `orgId` equality, so
   * a foreign row means the index, the adapter, or the stored document is wrong,
   * and that is a server-side fault rather than a lookup miss. Neither payload
   * carries anything beyond a code and the request ID, so the distinction tells a
   * caller nothing about another tenant.
   */
  const assertIndexedRow = <Document extends TenantOwnedDocument>(
    row: unknown,
  ): Document => {
    try {
      return assertOwnedDocument<Document>(row, orgId, requestId);
    } catch {
      throw invalidResult();
    }
  };

  /**
   * Ask the port for one page and prove the answer is a bounded page of owned,
   * well-formed documents.
   *
   * Everything about the answer is checked, because the port is the one thing here
   * that is not this module's code: an adapter may be new, may be a fake, or may
   * be a Convex version whose pagination shape has moved. More rows than were
   * asked for, a `page` that is not an array, a non-boolean `isDone`, a cursor
   * that is not a string, an oversized cursor, or "not done" with no cursor to
   * continue from are each `INVALID_INDEX_RESULT`.
   *
   * A page longer than `limit` fails rather than being truncated. A boundary that
   * silently trims an over-long page is a boundary whose caller cannot tell a
   * complete page from a clipped one, and the whole value of a bound is knowing
   * which one you have.
   */
  const readPage = async <Document extends TenantOwnedDocument>(
    facts: TenantIndexFacts,
    equality: TenantIndexEquality,
    limit: number,
    cursor: string | null,
  ): Promise<TenantIndexPage<Document>> => {
    const answer: unknown = await port.indexedPage(
      facts.table,
      facts.name,
      equality,
      { limit, cursor },
    );

    if (answer === null || typeof answer !== "object") throw invalidResult();
    if (Array.isArray(answer)) throw invalidResult();

    const record = answer as Record<string, unknown>;
    const rows: unknown = record.page;
    if (!Array.isArray(rows)) throw invalidResult();
    if (rows.length > limit) throw invalidResult();

    const isDone: unknown = record.isDone;
    if (typeof isDone !== "boolean") throw invalidResult();

    const continueCursor: unknown = record.continueCursor;
    if (typeof continueCursor !== "string") throw invalidResult();
    if (continueCursor.length > TENANT_INDEX_MAX_CURSOR_LENGTH) {
      throw invalidResult();
    }
    if (!isDone && continueCursor.length === 0) throw invalidResult();

    const documents: Document[] = rows.map((row: unknown) =>
      assertIndexedRow<Document>(row),
    );

    return Object.freeze({
      page: Object.freeze(documents),
      isDone,
      continueCursor,
    });
  };

  const byIndex = <Document extends TenantOwnedDocument = TenantOwnedDocument>(
    table: TenantTableName,
    index: string,
    equalityAfterOrg: TenantIndexEquality = [],
  ): TenantIndexReader<Document> => {
    requireTenantTable(table);

    // A scope whose tenant key is unusable can prove nothing about ownership, so
    // it may not read by index at all. Not reachable from client input — `orgId`
    // is server-derived (`INV-0001-02`) — and refused here rather than per row,
    // so a misconfigured scope cannot reach storage even once.
    if (!isUsableKey(orgId)) throw invalidQuery();

    // The declared metadata is consulted before anything else about the read is
    // considered, and before the port exists in the sequence at all: an index
    // name that the schema does not declare on this table is not a read this
    // boundary can bound (`convex/lib/tenantIndexPolicy.ts`).
    const facts = describeTenantIndex(table, index);
    if (facts === undefined) throw invalidQuery();

    const equality = equalityPrefix(facts, equalityAfterOrg);

    const first = async (): Promise<Document | null> => {
      const { page } = await readPage<Document>(facts, equality, 1, null);
      return page[0] ?? null;
    };

    const unique = async (): Promise<Document | null> => {
      // Two rows, not one: the second row is what makes a broken uniqueness
      // contract visible instead of arbitrary.
      const { page } = await readPage<Document>(facts, equality, 2, null);
      if (page.length > 1) throw invalidResult();
      return page[0] ?? null;
    };

    const take = async (limit: number): Promise<readonly Document[]> => {
      const bounded = requireLimit(limit);
      const { page } = await readPage<Document>(facts, equality, bounded, null);
      return page;
    };

    const page = async (
      request: TenantIndexPageRequest,
    ): Promise<TenantIndexPage<Document>> => {
      if (request === null || typeof request !== "object") throw invalidQuery();
      // Limit before cursor, so an unbounded request is refused by the code that
      // names the problem rather than by whichever check happens to run first.
      const bounded = requireLimit(request.limit);
      const cursor = requireCursor(request.cursor);
      return await readPage<Document>(facts, equality, bounded, cursor);
    };

    return Object.freeze({ first, unique, take, page });
  };

  return Object.freeze({
    get,
    // `getX` *is* the shared predicate: there is no second implementation that
    // could drift from the one `get` folds a code out of.
    getX: readOwned,
    insert,
    patch,
    replace,
    delete: remove,
    byIndex,
  });
}
