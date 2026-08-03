/**
 * Deterministic in-memory `TenantStoragePort` for the tenant document access
 * suites.
 *
 * This is a fixture, not a test: it is imported by
 * `tests/integration/tenant-document-access.integration.test.ts` and
 * `tests/isolation/tenant-document-access.isolation.test.ts`, and it sits outside
 * every Vitest project's `include` glob.
 *
 * What it is: one `Map` keyed by table and document ID, wired to the six methods
 * of [`TenantStoragePort`](../../convex/lib/tenantDb.ts), plus a log of every call
 * made through it. Its `indexedPage` filters the table's rows by the equality
 * terms it was handed and slices them by limit and cursor — enough to be an
 * honest bounded page, and nothing more. What it is not: a Convex database. There
 * is no transaction, no real index, no validator, no `convex-test`, and no
 * deployment.
 *
 * Three properties are load-bearing for the suites, and each is a deliberate
 * refusal to be helpful:
 *
 * - **It enforces nothing.** It does not check the table allowlist, does not
 *   require an `orgId`, does not reject a forbidden field, and does not refuse to
 *   patch another tenant's document. A fake that re-implemented the guards would
 *   make a suite pass while the accessor had none: the point of these tests is
 *   that `createTenantDocumentAccess` is the only thing standing between a caller
 *   and a permissive database, so the fake is exactly that permissive database.
 *   `seed` therefore takes a plain `string` table name and an `unknown` value, so
 *   a test can store a global table's row, an untenanted row, or something that is
 *   not a document at all.
 * - **Every call is recorded, in order, with its payload.** The properties worth
 *   proving are as much about calls that must *not* happen as about answers: a
 *   denied patch must reach no mutating method, and a read that fails ownership
 *   must not be followed by a write. An answer cannot show that; a call log can.
 * - **Inserted IDs are minted from a counter**, so a suite never depends on
 *   wall-clock time, randomness, or insertion order beyond what it asserts.
 *
 * `failOn` exists for one case the accessor owes an answer to: a port that throws.
 * A `TenantDbError` raised by an adapter must reach the caller with its shape
 * intact rather than being re-wrapped or absorbed.
 *
 * All data written by the suites is synthetic — no real customer, supplier, or
 * personal data (PDPA, see `tests/fixtures/README.md`).
 */
import type {
  TenantIndexEquality,
  TenantStorageDocument,
  TenantStoragePort,
  TenantTableName,
} from "../../convex/lib/tenantDb";

/** The opaque prefix every cursor this fixture mints begins with. */
const CURSOR_PREFIX = "fixture-cursor:";

/** A cursor resuming at `offset` matching rows. Opaque to the accessor. */
function cursorFor(offset: number): string {
  return `${CURSOR_PREFIX}${offset}`;
}

/** The six things a caller can ask storage to do. */
export type TenantStorageMethod =
  "get" | "insert" | "patch" | "replace" | "delete" | "indexedPage";

/** The methods that change stored state. A denial must produce none of these. */
export const TENANT_STORAGE_MUTATIONS: readonly TenantStorageMethod[] = [
  "insert",
  "patch",
  "replace",
  "delete",
];

/**
 * One recorded call. `id` is absent for `insert` (there is none yet) and
 * `payload` is absent for `get` and `delete`.
 *
 * `payload` holds the object the accessor passed, by reference and unmodified, so
 * a test can assert both what was written and that the caller's own object was
 * not the thing written.
 */
export interface TenantStorageCall {
  readonly method: TenantStorageMethod;
  readonly table: string;
  readonly id?: string;
  readonly payload?: unknown;
  /** Index name, for `indexedPage` only. */
  readonly index?: string;
  /** The equality prefix as the accessor built it, by reference. */
  readonly equality?: unknown;
  /** The requested page size, for `indexedPage` only. */
  readonly limit?: number;
  /** The requested cursor, `null` for a first page. */
  readonly cursor?: string | null;
}

/** The fixture: a port, the log behind it, and the seams a test needs. */
export interface TenantStoragePortFixture {
  /** The port to hand to `createTenantDocumentAccess`. */
  readonly port: TenantStoragePort;

  /** Every call so far, oldest first. A snapshot: later calls do not appear. */
  calls(): readonly TenantStorageCall[];

  /** Calls to one method. */
  callsTo(method: TenantStorageMethod): readonly TenantStorageCall[];

  /** Every call that would have changed stored state. */
  mutationCalls(): readonly TenantStorageCall[];

  /**
   * Store `document` at `table`/`id` without any checking, and answer with the
   * ID for convenience. `table` is a plain `string` so a suite can seed a global
   * or unknown table and prove the accessor still refuses it.
   */
  seed(table: string, id: string, document: unknown): string;

  /** The raw stored value, bypassing the port (and therefore the call log). */
  stored(table: string, id: string): unknown;

  /** How many documents are stored, across all tables. */
  size(): number;

  /** Make every later call to `method` throw `error`. */
  failOn(method: TenantStorageMethod, error: unknown): void;

  /**
   * Answer every later `indexedPage` call with `answer`, verbatim.
   *
   * The seam behind every "the port lied" case: a page longer than was asked for,
   * a page of another tenant's rows, a page that is not an object, a cursor that
   * is not a string. The fixture does not inspect `answer` — an honest fake cannot
   * produce these shapes, and a boundary that is only ever fed honest answers has
   * only ever been tested against itself.
   */
  answerIndexedPageWith(answer: unknown): void;

  /**
   * Stop honouring the equality term on `field`.
   *
   * Simulates a broken index — one that accepts the `orgId` term and then ranges
   * over every tenant's rows anyway. `ignoreEqualityOn("orgId")` is how a
   * cross-tenant page is produced without hand-writing one, which matters because
   * the rows it yields are real seeded documents rather than a shape invented to
   * fail.
   */
  ignoreEqualityOn(field: string): void;

  /**
   * A cursor this fixture will honour, resuming at `offset` matching rows.
   *
   * Opaque to the accessor and meaningful only here: the boundary never parses a
   * cursor, so the fixture is free to make one out of an offset.
   */
  cursorFor(offset: number): string;

  /** Forget all documents, all failures, all overrides, and the whole call log. */
  reset(): void;
}

/** `table` and `id` are both part of the key: IDs are unique per table only. */
function storageKey(table: string, id: string): string {
  return `${table}\u0000${id}`;
}

/**
 * Build a fresh fixture. Each test gets its own, so no suite can depend on
 * another's writes.
 */
export function createTenantStoragePortFixture(): TenantStoragePortFixture {
  const documents = new Map<string, unknown>();
  const calls: TenantStorageCall[] = [];
  const failures = new Map<TenantStorageMethod, unknown>();
  /** A one-element box, so `undefined` is a settable override like any other. */
  const indexedPageOverride: unknown[] = [];
  const ignored = new Set<string>();
  let inserted = 0;

  /** Record the call, then throw if this method is configured to fail. */
  function record(call: TenantStorageCall): void {
    calls.push(call);
    if (failures.has(call.method)) throw failures.get(call.method);
  }

  const port: TenantStoragePort = {
    get: async (table: TenantTableName, id: string): Promise<unknown> => {
      record({ method: "get", table, id });

      const key = storageKey(table, id);
      // `has` before `get`, so a deliberately seeded `undefined` is answered as
      // `undefined` rather than being indistinguishable from an absent row: both
      // are cases the ownership assertion has to reject.
      return documents.has(key) ? documents.get(key) : null;
    },

    insert: async (
      table: TenantTableName,
      document: TenantStorageDocument,
    ): Promise<string> => {
      record({ method: "insert", table, payload: document });

      inserted += 1;
      const id = `${table}:inserted-${inserted}`;
      documents.set(storageKey(table, id), document);
      return id;
    },

    patch: async (
      table: TenantTableName,
      id: string,
      fields: TenantStorageDocument,
    ): Promise<void> => {
      record({ method: "patch", table, id, payload: fields });

      const key = storageKey(table, id);
      const existing = documents.get(key);
      // A shallow merge over whatever is there, in Convex's spirit and with none
      // of its checking: an unchecked merge is what makes an unguarded patch
      // visible in `stored()`.
      documents.set(key, {
        ...(typeof existing === "object" && existing !== null ? existing : {}),
        ...fields,
      });
    },

    replace: async (
      table: TenantTableName,
      id: string,
      document: TenantStorageDocument,
    ): Promise<void> => {
      record({ method: "replace", table, id, payload: document });
      documents.set(storageKey(table, id), document);
    },

    delete: async (table: TenantTableName, id: string): Promise<void> => {
      record({ method: "delete", table, id });
      documents.delete(storageKey(table, id));
    },

    indexedPage: async (
      table: TenantTableName,
      index: string,
      equality: TenantIndexEquality,
      page: { readonly limit: number; readonly cursor: string | null },
    ): Promise<unknown> => {
      record({
        method: "indexedPage",
        table,
        index,
        equality,
        limit: page.limit,
        cursor: page.cursor,
      });

      if (indexedPageOverride.length > 0) return indexedPageOverride[0];

      // No index exists here: "using the index" is filtering the table's rows by
      // the equality terms, in insertion order. That is enough for the properties
      // under test, and deliberately not enough to be mistaken for Convex.
      const matching = [...documents.entries()]
        .filter(([key]) => key.startsWith(`${table}\u0000`))
        .map(([, document]) => document)
        .filter((document) => matchesEquality(document, equality));

      const start = decodeCursor(page.cursor);
      const rows = matching.slice(start, start + page.limit);
      const next = start + rows.length;

      return {
        page: rows,
        isDone: next >= matching.length,
        continueCursor: cursorFor(next),
      };
    },
  };

  /** Every equality term holds, except on a field a test has disabled. */
  function matchesEquality(
    document: unknown,
    equality: TenantIndexEquality,
  ): boolean {
    if (document === null || typeof document !== "object") return false;
    const record_ = document as Record<string, unknown>;

    return equality.every(
      (term) => ignored.has(term.field) || record_[term.field] === term.value,
    );
  }

  /** An unrecognised cursor resumes at the start: the fixture enforces nothing. */
  function decodeCursor(cursor: string | null): number {
    if (cursor === null || !cursor.startsWith(CURSOR_PREFIX)) return 0;
    const offset = Number(cursor.slice(CURSOR_PREFIX.length));
    return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  }

  return {
    port,
    calls: () => [...calls],
    callsTo: (method) => calls.filter((call) => call.method === method),
    mutationCalls: () =>
      calls.filter((call) => TENANT_STORAGE_MUTATIONS.includes(call.method)),
    seed: (table, id, document) => {
      documents.set(storageKey(table, id), document);
      return id;
    },
    stored: (table, id) => documents.get(storageKey(table, id)),
    size: () => documents.size,
    failOn: (method, error) => {
      failures.set(method, error);
    },
    answerIndexedPageWith: (answer) => {
      indexedPageOverride.length = 0;
      indexedPageOverride.push(answer);
    },
    ignoreEqualityOn: (field) => {
      ignored.add(field);
    },
    cursorFor,
    reset: () => {
      documents.clear();
      failures.clear();
      indexedPageOverride.length = 0;
      ignored.clear();
      calls.length = 0;
      inserted = 0;
    },
  };
}
