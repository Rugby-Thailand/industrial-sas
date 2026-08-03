/**
 * The Convex implementation of `TenantStoragePort` (T05b2a, `ADR-0002` §2, §5).
 *
 * Status: **adapter only.** This module is the one place in the repository that
 * calls `ctx.db`. It exports no Convex `query`, `mutation`, `action`, or HTTP
 * handler, registers nothing, and reads no environment variable — `G-102` still
 * needs the auth wrapper and the public function wrappers, and neither is here.
 *
 * What it does: turn a Convex query or mutation context into the six-method port
 * that [`convex/lib/tenantDb.ts`](./tenantDb.ts) already knows how to police. The
 * split of responsibility is deliberate and total:
 *
 * - **`createTenantDocumentAccess` owns every decision.** Whether a table may be
 *   scoped, whether a document belongs to the caller's tenant, whether a payload
 *   may choose its own `orgId`, whether a page size is bounded, whether an index
 *   is declared, whether an equality list is a legal prefix — all of it stays
 *   there. This adapter adds no decision of its own and, in particular, adds no
 *   second index allowlist: the one it consults is
 *   [`convex/lib/tenantIndexPolicy.ts`](./tenantIndexPolicy.ts), through
 *   `describeTenantIndex`, exactly as the accessor does.
 * - **This module owns translation.** A tenant table name and an opaque string ID
 *   become a Convex table and a `GenericId`; a validated equality prefix becomes a
 *   `withIndex` range; a Convex answer becomes a plain record or a checked page.
 *
 * It nevertheless re-checks everything it is handed. Not because the accessor is
 * untrusted, but because a port is an interface and an interface has more than
 * one caller: a future wrapper, a script, or a test can hold one of these ports
 * directly. Re-checking means the properties that matter — `orgId` first, a
 * declared index, a bounded page, no scan — hold for *every* caller of the
 * adapter rather than only for callers who went through the accessor. Both layers
 * consult the same policy module, so "check twice" is not "decide twice".
 *
 * Five refusals are structural rather than policed:
 *
 * - **There is no `filter`, no `collect`, no `order`, and no raw query callback.**
 *   The only query this module can construct is
 *   `db.query(table).withIndex(index, …)` followed by `take` or `paginate`. A
 *   caller cannot pass a predicate, because no parameter accepts one; the
 *   equality terms are values checked against declared index fields, never code.
 * - **A query context cannot write.** `createQueryTenantStorage` accepts a
 *   context whose `db` is a `GenericDatabaseReader`, which has no `insert`,
 *   `patch`, `replace`, or `delete` to call. The four write methods it returns
 *   are typed `Promise<never>` and refuse before touching anything. Passing a
 *   query context to `createMutationTenantStorage` is a compile error, because
 *   a reader is not assignable to a writer.
 * - **An ID is normalized by Convex, not parsed here.** `db.normalizeId` is the
 *   only thing that decides whether a string is an ID *of this table*, so a
 *   well-formed ID belonging to another table, a truncated ID, and a random
 *   string are all one answer.
 * - **Nothing unbounded is expressible.** `take` is given a checked limit and
 *   `paginate` a checked page size; neither is reachable with an absent, zero, or
 *   oversized bound.
 * - **No failure describes itself.** Every rejection this module raises is a
 *   `TenantDbError` carrying a code and the request ID, so a Convex message that
 *   would have named a table, an index, a field, or a document never reaches a
 *   caller. Convex's own `withIndex` failure, for instance, says which field it
 *   expected; the equality prefix is checked here first so that message is
 *   unreachable.
 *
 * ### Pagination and Convex's single-paginate budget
 *
 * Convex allows **one `.paginate()` per function execution**
 * (<https://docs.convex.dev/database/pagination>), and `convex-test` enforces the
 * same limit. The port, however, funnels four reads — `first`, `unique`, `take`,
 * `page` — through `indexedPage`, so an adapter that always paginated would let a
 * mutation perform exactly one indexed read and fail on the second.
 *
 * So `indexedPage` paginates only when a continuation is actually needed:
 *
 * 1. With no cursor, it reads `limit + 1` rows with `.take()`. If that is not
 *    over-full, the range is exhausted: the rows are the whole answer, `isDone` is
 *    `true`, and there is no cursor to mint. `.take()` has no budget.
 * 2. Only when a cursor was supplied, or when the probe proves more rows exist,
 *    does it call `.paginate()` — which is the only way to obtain a cursor Convex
 *    will accept back.
 *
 * The one extra row is what makes exhaustion decidable without a cursor. The cost
 * is that a genuinely continuable first page is read twice (`limit + 1` rows, then
 * `limit`), which is bounded by `TENANT_INDEX_MAX_PAGE_SIZE` and paid only on the
 * path that was going to paginate anyway.
 *
 * **Known limitation, stated rather than hidden:** a single function execution can
 * still perform only one indexed read that has a continuation. A uniqueness check
 * never trips this (an over-full `unique()` is already an `INVALID_INDEX_RESULT`
 * that aborts), and neither does any read whose range fits in its limit. A
 * `first()` over a range with more rows does, and two of them in one mutation
 * would hit Convex's limit. Fixing that properly means letting the port say
 * whether a cursor is wanted, which is a change to `TenantStoragePort` in
 * `tenantDb.ts` and belongs to the slice that owns it — not to a widening here.
 *
 * ### Convex errors are not translated
 *
 * `TenantDbError` covers what this adapter decides: a table it may not scope, an
 * index the schema does not declare, an equality prefix that is not one, an
 * unusable limit or cursor, a malformed ID, a payload no write may carry, and a
 * Convex answer that is not the documented shape. It does **not** wrap Convex's
 * own runtime failures — a write conflict, a document that vanished between the
 * accessor's ownership read and the write, a transaction or read limit. Those are
 * server-side faults: swallowing them would hide an OCC conflict that must be
 * retried, and re-coding them would claim a decision this module did not make.
 * Turning an unexpected fault into a client-safe response is the public function
 * wrapper's job (`INV-0002-07`, plan §7.4).
 *
 * Baseline:
 * [ADR-0002](../../docs/adr/0002-convex-tenant-boundary-and-index-discipline.md),
 * [ADR-0001](../../docs/adr/0001-multi-tenant-saas-and-identity-ownership.md),
 * [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §6.1, §6.2, §7.3, §7.4.
 */
import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";

import type { DataModel } from "../schema";
import {
  TENANT_INDEX_MAX_CURSOR_LENGTH,
  TENANT_INDEX_MAX_PAGE_SIZE,
  TenantDbError,
  assertTenantTableName,
  type TenantIndexEquality,
  type TenantStorageDocument,
  type TenantStoragePort,
  type TenantTableName,
} from "./tenantDb";
import {
  describeTenantIndex,
  type TenantIndexFacts,
} from "./tenantIndexPolicy";
import { TENANT_DISCRIMINATOR } from "./tenantTable";

/* -------------------------------------------------------------------------- */
/* Contexts                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The tenant root table. Named here so the `orgId` checks below can ask Convex
 * whether a value really is an organization ID.
 *
 * Not a second source of truth: `orgIdField` in `convex/lib/tenantTable.ts` is
 * `v.id("organizations")`, and `schemaPolicy` proves every tenant table declares
 * it. This constant is that name, used for `normalizeId`.
 */
const ORGANIZATION_TABLE = "organizations";

/**
 * What this adapter needs from a Convex query context: a read-only database.
 *
 * Structural rather than `GenericQueryCtx<DataModel>`, so a caller can pass a
 * real `QueryCtx` (which has `auth`, `storage`, `runQuery`, and more) without this
 * module claiming to know or want any of it. The narrower the accepted shape, the
 * less a future wrapper can accidentally hand over.
 */
export interface TenantQueryContext {
  readonly db: GenericDatabaseReader<DataModel>;
}

/** The same, for a mutation context: a database that may also write. */
export interface TenantMutationContext {
  readonly db: GenericDatabaseWriter<DataModel>;
}

/**
 * The port a query context yields: the full six methods, with the four writes
 * typed as never returning.
 *
 * `Promise<never>` is assignable to `Promise<string>` and `Promise<void>`, so this
 * is a `TenantStoragePort` and `createTenantDocumentAccess` accepts it. What the
 * type adds is a compile-time statement that no value ever comes back from a
 * write here: code that awaits one is unreachable, and a reviewer does not have to
 * read the implementation to learn that a query cannot write.
 */
export interface TenantQueryStoragePort extends TenantStoragePort {
  readonly insert: (
    table: TenantTableName,
    document: TenantStorageDocument,
  ) => Promise<never>;
  readonly patch: (
    table: TenantTableName,
    id: string,
    fields: TenantStorageDocument,
  ) => Promise<never>;
  readonly replace: (
    table: TenantTableName,
    id: string,
    document: TenantStorageDocument,
  ) => Promise<never>;
  readonly delete: (table: TenantTableName, id: string) => Promise<never>;
}

/* -------------------------------------------------------------------------- */
/* The untyped view of `ctx.db`                                                */
/* -------------------------------------------------------------------------- */

/*
 * Convex's database types are keyed by a *single* literal table name: `get`,
 * `patch`, `replace`, and `delete` constrain their table argument with
 * `NonUnion<TableName>`, and `insert`/`patch`/`replace` demand the exact
 * `DocumentByName<DataModel, TableName>` shape. Both are the right types for
 * hand-written table-specific code and the wrong ones here, for two reasons this
 * module cannot design away:
 *
 * 1. A port method receives `TenantTableName`, which is a *union* of the twelve
 *    tenant tables, narrowed at runtime by `assertTenantTableName` because the
 *    value can arrive from a string the compiler never saw. A union is exactly
 *    what `NonUnion` rejects.
 * 2. A port payload is `Record<string, unknown>` on purpose: `TenantStoragePort`
 *    sits below the schema and moves opaque documents, and Convex's own schema
 *    validators — which `convex-test` and a deployment both run — are what check
 *    field shapes on the way in.
 *
 * The alternative to a cast is a twelve-branch switch that restates the schema in
 * order to satisfy the compiler, which would be a second copy of the table list
 * and a new place to forget a table. So the generic type is dropped exactly once,
 * here, behind two functions, and the interfaces below describe precisely the
 * seven Convex operations this module is allowed to reach. Nothing else in the
 * repository casts `ctx.db`.
 */

/** `q.eq(field, value)`, chained. The only range expression this module builds. */
interface ConvexIndexRangeBuilder {
  eq: (field: string, value: unknown) => ConvexIndexRangeBuilder;
}

/**
 * A query already restricted to an index range: it can be read as a bounded
 * batch or as a page, and nothing else. There is deliberately no `filter`,
 * `collect`, `order`, `first`, or `unique` here — a method absent from this
 * interface is a method this module cannot call.
 */
interface ConvexBoundedQuery {
  take: (count: number) => Promise<unknown>;
  paginate: (options: {
    readonly numItems: number;
    readonly cursor: string | null;
  }) => Promise<unknown>;
}

/** A table query before an index is chosen. `withIndex` is the only way on. */
interface ConvexQueryInitializer {
  withIndex: (
    index: string,
    range: (builder: ConvexIndexRangeBuilder) => ConvexIndexRangeBuilder,
  ) => ConvexBoundedQuery;
}

/** The reads this adapter performs, with table names as plain strings. */
interface ConvexReadDatabase {
  normalizeId: (table: string, id: string) => string | null;
  get: (table: string, id: string) => Promise<unknown>;
  query: (table: string) => ConvexQueryInitializer;
}

/** The writes a mutation context adds. */
interface ConvexWriteDatabase extends ConvexReadDatabase {
  insert: (table: string, document: TenantStorageDocument) => Promise<unknown>;
  patch: (
    table: string,
    id: string,
    fields: TenantStorageDocument,
  ) => Promise<void>;
  replace: (
    table: string,
    id: string,
    document: TenantStorageDocument,
  ) => Promise<void>;
  delete: (table: string, id: string) => Promise<void>;
}

/**
 * Cast 1 of 2 — a read-only database, table names widened to `string`.
 *
 * `as unknown as` rather than a single assertion because Convex's overloaded,
 * `NonUnion`-constrained signatures do not overlap structurally with the plain
 * ones above; TypeScript rejects the direct assertion even though every method
 * exists with a compatible runtime signature. See the note above for why the
 * generic types cannot be kept.
 */
function untypedReadDatabase(
  db: GenericDatabaseReader<DataModel>,
): ConvexReadDatabase {
  return db as unknown as ConvexReadDatabase;
}

/** Cast 2 of 2 — the same, for a database that may also write. */
function untypedWriteDatabase(
  db: GenericDatabaseWriter<DataModel>,
): ConvexWriteDatabase {
  return db as unknown as ConvexWriteDatabase;
}

/* -------------------------------------------------------------------------- */
/* Shared predicates                                                           */
/* -------------------------------------------------------------------------- */

/**
 * "Is this value an organization document ID?", answered by Convex.
 *
 * A predicate over a database rather than a standalone shape test, because
 * `normalizeId` is the only thing that knows the current ID format *and* that an
 * ID belongs to the table it claims. Built once per port so the reads and the
 * writes cannot disagree about what a tenant key is.
 */
function organizationIdCheck(
  db: ConvexReadDatabase,
): (value: unknown) => boolean {
  return (value: unknown): boolean =>
    typeof value === "string" &&
    value.length > 0 &&
    db.normalizeId(ORGANIZATION_TABLE, value) !== null;
}

/* -------------------------------------------------------------------------- */
/* Checked reads                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The read half of the port, bound to one database and one request.
 *
 * Shared by both factories so a query and a mutation cannot disagree about what a
 * read is: there is one `get` and one `indexedPage` in this module, and a
 * mutation port is the read half plus four writes.
 */
function createReads(
  db: ConvexReadDatabase,
  requestId: string,
): Pick<TenantStoragePort, "get" | "indexedPage"> {
  const invalidQuery = (): TenantDbError =>
    new TenantDbError("INVALID_INDEX_QUERY", requestId);
  const invalidResult = (): TenantDbError =>
    new TenantDbError("INVALID_INDEX_RESULT", requestId);

  /**
   * Narrow a table name, then hand it back as a plain string for the untyped
   * database. Rejects a global table and an unknown name identically.
   */
  const checkedTable = (table: TenantTableName): string => {
    assertTenantTableName(table, requestId);
    return table;
  };

  /**
   * Convex's own answer to "is this string an ID of this table?".
   *
   * Used rather than a hand-written shape test because the format of a Convex ID
   * is Convex's to change, and because `normalizeId` also rejects a well-formed ID
   * belonging to a *different* table — which a length or character check cannot.
   * `null` for every reason: empty, malformed, foreign table, `__proto__`.
   */
  const normalizedId = (table: string, id: string): string | null => {
    if (typeof id !== "string" || id.length === 0) return null;
    return db.normalizeId(table, id);
  };

  /** An `orgId` term is usable only if Convex agrees it is an organization ID. */
  const isOrganizationId = organizationIdCheck(db);

  /**
   * Re-check the equality prefix against the declared index fields, positionally.
   *
   * Position is the whole check: term `i` must name `facts.fields[i]`, so the
   * first term is necessarily `orgId`, the prefix is necessarily contiguous, no
   * field can repeat (the metadata guarantees the index does not), and a
   * reordered or gapped prefix cannot be expressed. A shorter prefix is legal — it
   * is still a bounded index range — but an empty one is not: a read of a tenant
   * table with no `orgId` equality is the scan this boundary exists to forbid.
   *
   * The accessor already checked all of this. Repeating it here is what makes the
   * guarantee hold for a caller who did not go through the accessor, and it uses
   * the same metadata rather than a private copy of it.
   */
  const checkedTerms = (
    facts: TenantIndexFacts,
    supplied: TenantIndexEquality,
  ): readonly { readonly field: string; readonly value: unknown }[] => {
    if (!Array.isArray(supplied)) throw invalidQuery();
    if (supplied.length === 0) throw invalidQuery();
    if (supplied.length > facts.fields.length) throw invalidQuery();

    const terms: { readonly field: string; readonly value: unknown }[] = [];

    for (let position = 0; position < supplied.length; position += 1) {
      const term: unknown = supplied[position];
      if (term === null || typeof term !== "object") throw invalidQuery();
      if (Array.isArray(term)) throw invalidQuery();

      const record = term as Record<string, unknown>;
      const field: unknown = record.field;
      if (typeof field !== "string") throw invalidQuery();
      if (field !== facts.fields[position]) throw invalidQuery();
      if (!Object.hasOwn(record, "value")) throw invalidQuery();

      const value: unknown = record.value;
      if (value === undefined) throw invalidQuery();
      if (field === TENANT_DISCRIMINATOR && !isOrganizationId(value)) {
        throw invalidQuery();
      }

      terms.push({ field, value });
    }

    return terms;
  };

  /** A page size Convex may be asked for: a safe integer within the cap. */
  const checkedLimit = (limit: number): number => {
    if (typeof limit !== "number" || !Number.isSafeInteger(limit)) {
      throw new TenantDbError("INVALID_LIMIT", requestId);
    }
    if (limit < 1 || limit > TENANT_INDEX_MAX_PAGE_SIZE) {
      throw new TenantDbError("INVALID_LIMIT", requestId);
    }
    return limit;
  };

  /**
   * A cursor Convex may be handed back: `null`, or a non-empty string within the
   * documented bound. Never decoded here — it is Convex's value, and this module
   * only refuses to forward something absurd.
   */
  const checkedCursor = (cursor: string | null): string | null => {
    if (cursor === null) return null;
    if (typeof cursor !== "string") throw invalidQuery();
    if (cursor.length === 0) throw invalidQuery();
    if (cursor.length > TENANT_INDEX_MAX_CURSOR_LENGTH) throw invalidQuery();
    return cursor;
  };

  /**
   * The page shape the port promises, frozen.
   *
   * Built field by field from checked values rather than by spreading Convex's
   * result, so `splitCursor`, `pageStatus`, and anything a later Convex version
   * adds stay on this side of the boundary. The accessor validates this again; it
   * should never have to reject what this module produced.
   */
  const answeredPage = (
    rows: readonly unknown[],
    isDone: boolean,
    continueCursor: string,
  ): unknown =>
    Object.freeze({
      page: Object.freeze([...rows]),
      isDone,
      continueCursor,
    });

  const get = async (table: TenantTableName, id: string): Promise<unknown> => {
    const name = checkedTable(table);
    const documentId = normalizedId(name, id);

    // A malformed or foreign-table ID answers exactly as an absent document does.
    // The accessor turns both into `NOT_FOUND`, so a caller holding an ID it was
    // never shown cannot tell which of the two it holds (`INV-0002-03`).
    if (documentId === null) return null;

    return await db.get(name, documentId);
  };

  const indexedPage = async (
    table: TenantTableName,
    index: string,
    equality: TenantIndexEquality,
    page: { readonly limit: number; readonly cursor: string | null },
  ): Promise<unknown> => {
    const name = checkedTable(table);

    // The declared metadata decides, before a query object exists: an index the
    // schema does not declare `orgId`-first on this table is not a read this
    // adapter can bound. Same lookup the accessor made, same module, one
    // allowlist.
    const facts = describeTenantIndex(name, index);
    if (facts === undefined) throw invalidQuery();

    const terms = checkedTerms(facts, equality);

    if (page === null || typeof page !== "object") throw invalidQuery();
    const limit = checkedLimit(page.limit);
    const cursor = checkedCursor(page.cursor);

    /**
     * A fresh query for each read: a Convex query object is consumed when it is
     * read, so the probe and the pagination below cannot share one.
     */
    const bounded = (): ConvexBoundedQuery =>
      db.query(name).withIndex(facts.name, (builder) => {
        let range = builder;
        for (const term of terms) {
          range = range.eq(term.field, term.value);
        }
        return range;
      });

    if (cursor === null) {
      // One row beyond the limit, which is what makes "the range is exhausted"
      // decidable without minting a cursor. `.take()` is not subject to Convex's
      // one-paginate-per-execution budget.
      const probe: unknown = await bounded().take(limit + 1);
      if (!Array.isArray(probe)) throw invalidResult();

      if (probe.length <= limit) {
        // Exhausted: these rows are the whole answer and there is nothing to
        // continue from. The accessor accepts an empty cursor only when `isDone`.
        return answeredPage(probe as readonly unknown[], true, "");
      }
    }

    // Either resuming, or the probe proved there is more. Only Convex can mint a
    // cursor it will accept back, so only now is the single paginate spent.
    const answer: unknown = await bounded().paginate({
      numItems: limit,
      cursor,
    });

    if (answer === null || typeof answer !== "object") throw invalidResult();
    if (Array.isArray(answer)) throw invalidResult();

    const record = answer as Record<string, unknown>;
    const rows: unknown = record.page;
    if (!Array.isArray(rows)) throw invalidResult();

    // Refused, not truncated: a page longer than was asked for means the answer
    // is not the bounded page it claims to be, and trimming it would hide that.
    if (rows.length > limit) throw invalidResult();

    const isDone: unknown = record.isDone;
    if (typeof isDone !== "boolean") throw invalidResult();

    const continueCursor: unknown = record.continueCursor;
    if (typeof continueCursor !== "string") throw invalidResult();
    if (continueCursor.length > TENANT_INDEX_MAX_CURSOR_LENGTH) {
      throw invalidResult();
    }
    if (!isDone && continueCursor.length === 0) throw invalidResult();

    return answeredPage(rows as readonly unknown[], isDone, continueCursor);
  };

  return { get, indexedPage };
}

/* -------------------------------------------------------------------------- */
/* Checked writes                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Reject a payload Convex must not be asked to store.
 *
 * Three properties, all of which the accessor already enforces and all of which
 * are re-stated because a port has more than one possible caller:
 *
 * - it is a plain record, not `null`, an array, or a primitive;
 * - it names no `_`-prefixed field, so Convex's own namespace (`_id`,
 *   `_creationTime`, and anything it adds later) cannot be written;
 * - it carries `orgId` exactly when the operation should carry one. An insert or
 *   a replace writes a whole document into a tenant table, so it must name a real
 *   organization; a patch must not mention `orgId` at all, because a patch that
 *   re-states the tenant is a patch that could move a document between tenants.
 *
 * The failure is `INVALID_WRITE` with no detail: which field was wrong is a
 * server-side question (plan §7.4).
 */
function checkedDocument(
  document: TenantStorageDocument,
  tenancy: "required" | "forbidden",
  isOrganizationId: (value: unknown) => boolean,
  requestId: string,
): TenantStorageDocument {
  const invalid = (): TenantDbError =>
    new TenantDbError("INVALID_WRITE", requestId);

  if (document === null || typeof document !== "object") throw invalid();
  if (Array.isArray(document)) throw invalid();

  for (const key of Object.keys(document)) {
    if (key.startsWith("_")) throw invalid();
  }

  const hasTenant = Object.hasOwn(document, TENANT_DISCRIMINATOR);
  if (tenancy === "forbidden") {
    if (hasTenant) throw invalid();
    return document;
  }

  if (!hasTenant) throw invalid();
  if (!isOrganizationId(document[TENANT_DISCRIMINATOR])) throw invalid();
  return document;
}

/* -------------------------------------------------------------------------- */
/* Factories                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A read-only port over a Convex query context.
 *
 * The four write methods exist because `TenantStoragePort` has six, and they
 * refuse with `INVALID_WRITE` before touching anything. That refusal is a
 * backstop, not the guarantee: the guarantee is that `ctx.db` here is a
 * `GenericDatabaseReader`, so there is no write method in scope for this function
 * to have called even by mistake.
 *
 * `requestId` is the server-minted correlation ID every failure is quoted by
 * (plan §7.4). It is the same value the accessor's scope carries; passing it
 * twice is what lets a port raise a correlated failure without holding a scope.
 */
export function createQueryTenantStorage(
  ctx: TenantQueryContext,
  requestId: string,
): TenantQueryStoragePort {
  const db = untypedReadDatabase(ctx.db);

  const refuse = async (): Promise<never> => {
    throw new TenantDbError("INVALID_WRITE", requestId);
  };

  return Object.freeze({
    ...createReads(db, requestId),
    insert: refuse,
    patch: refuse,
    replace: refuse,
    delete: refuse,
  });
}

/**
 * A read-write port over a Convex mutation context.
 *
 * Every write is by document ID and is preceded — in the accessor, not here — by
 * a read that proved the caller's tenant owns it. This module normalizes the ID,
 * checks the payload, and calls Convex; it does not re-read the document to decide
 * anything, because ownership is the accessor's decision and a second read of a
 * row the accessor has already read would double the cost of every write without
 * deciding anything new.
 *
 * A `null` from `normalizeId` is `NOT_FOUND`, matching what the accessor answers
 * for an ID it cannot use, so a malformed ID and a foreign one stay
 * indistinguishable (`INV-0002-03`).
 */
export function createMutationTenantStorage(
  ctx: TenantMutationContext,
  requestId: string,
): TenantStoragePort {
  const db = untypedWriteDatabase(ctx.db);
  const reads = createReads(db, requestId);

  const notFound = (): TenantDbError =>
    new TenantDbError("NOT_FOUND", requestId);
  const invalidWrite = (): TenantDbError =>
    new TenantDbError("INVALID_WRITE", requestId);

  const isOrganizationId = organizationIdCheck(db);

  /** Narrow the table, then the ID, or fail closed as "not found". */
  const targetId = (table: TenantTableName, id: string): string => {
    assertTenantTableName(table, requestId);
    const documentId =
      typeof id === "string" && id.length > 0
        ? db.normalizeId(table, id)
        : null;
    if (documentId === null) throw notFound();
    return documentId;
  };

  /**
   * Run a write by ID, and answer `NOT_FOUND` if it failed because there was no
   * such document.
   *
   * Convex rejects a `patch`, `replace`, or `delete` of an absent document with a
   * message that **quotes the document ID**. A well-formed ID for the right table
   * survives `normalizeId` whether or not a document is there, so that message is
   * reachable — and a boundary whose failure text contains an ID a caller supplied
   * has an existence oracle in it (`INV-0002-07`).
   *
   * The existence read happens only on the failure path, so the ordinary write
   * costs nothing extra, and it decides *existence* only — never ownership, which
   * stays the accessor's. Anything that failed while the document is still there is
   * a genuine Convex fault (a write conflict, a schema validator, a transaction
   * limit) and is rethrown untouched: coding it as `NOT_FOUND` would hide an OCC
   * conflict that must be retried, and such a fault concerns the caller's own
   * payload, never another tenant's data.
   */
  const writeById = async (
    table: TenantTableName,
    documentId: string,
    write: () => Promise<void>,
  ): Promise<void> => {
    try {
      await write();
    } catch (error) {
      if ((await db.get(table, documentId)) === null) throw notFound();
      throw error;
    }
  };

  const insert = async (
    table: TenantTableName,
    document: TenantStorageDocument,
  ): Promise<string> => {
    assertTenantTableName(table, requestId);
    const value = checkedDocument(
      document,
      "required",
      isOrganizationId,
      requestId,
    );

    const inserted: unknown = await db.insert(table, value);

    // Checked before it crosses back: the accessor hands this ID to its caller,
    // and an ID that is not an ID of this table would be a value nobody could use
    // and everybody would assume was usable.
    if (
      typeof inserted !== "string" ||
      db.normalizeId(table, inserted) === null
    ) {
      throw invalidWrite();
    }
    return inserted;
  };

  const patch = async (
    table: TenantTableName,
    id: string,
    fields: TenantStorageDocument,
  ): Promise<void> => {
    const value = checkedDocument(
      fields,
      "forbidden",
      isOrganizationId,
      requestId,
    );
    const documentId = targetId(table, id);
    await writeById(table, documentId, async () => {
      await db.patch(table, documentId, value);
    });
  };

  const replace = async (
    table: TenantTableName,
    id: string,
    document: TenantStorageDocument,
  ): Promise<void> => {
    const value = checkedDocument(
      document,
      "required",
      isOrganizationId,
      requestId,
    );
    const documentId = targetId(table, id);
    await writeById(table, documentId, async () => {
      await db.replace(table, documentId, value);
    });
  };

  const remove = async (table: TenantTableName, id: string): Promise<void> => {
    const documentId = targetId(table, id);
    await writeById(table, documentId, async () => {
      await db.delete(table, documentId);
    });
  };

  return Object.freeze({
    ...reads,
    insert,
    patch,
    replace,
    delete: remove,
  });
}
