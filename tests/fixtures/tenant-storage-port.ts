/**
 * Deterministic in-memory `TenantStoragePort` for the tenant document access
 * suites.
 *
 * This is a fixture, not a test: it is imported by
 * `tests/integration/tenant-document-access.integration.test.ts` and
 * `tests/isolation/tenant-document-access.isolation.test.ts`, and it sits outside
 * every Vitest project's `include` glob.
 *
 * What it is: one `Map` keyed by table and document ID, wired to the five methods
 * of [`TenantStoragePort`](../../convex/lib/tenantDb.ts), plus a log of every call
 * made through it. What it is not: a Convex database. There is no transaction, no
 * index, no validator, no `convex-test`, and no deployment.
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
  TenantStorageDocument,
  TenantStoragePort,
  TenantTableName,
} from "../../convex/lib/tenantDb";

/** The five things a caller can ask storage to do. */
export type TenantStorageMethod =
  "get" | "insert" | "patch" | "replace" | "delete";

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

  /** Forget all documents, all failures, and the whole call log. */
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
  };

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
    reset: () => {
      documents.clear();
      failures.clear();
      calls.length = 0;
      inserted = 0;
    },
  };
}
