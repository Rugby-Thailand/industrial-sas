import type {
  TenantIndexEquality,
  TenantStorageDocument,
  TenantStoragePort,
  TenantTableName,
} from "../../convex/lib/tenantDb";

const CURSOR_PREFIX = "fixture-cursor:";

function cursorFor(offset: number): string {
  return `${CURSOR_PREFIX}${offset}`;
}

export type TenantStorageMethod =
  "get" | "insert" | "patch" | "replace" | "delete" | "indexedPage";

export const TENANT_STORAGE_MUTATIONS: readonly TenantStorageMethod[] = [
  "insert",
  "patch",
  "replace",
  "delete",
];

export interface TenantStorageCall {
  readonly method: TenantStorageMethod;
  readonly table: string;
  readonly id?: string;
  readonly payload?: unknown;

  readonly index?: string;

  readonly equality?: unknown;

  readonly limit?: number;

  readonly cursor?: string | null;
}

export interface TenantStoragePortFixture {
  readonly port: TenantStoragePort;

  calls(): readonly TenantStorageCall[];

  callsTo(method: TenantStorageMethod): readonly TenantStorageCall[];

  mutationCalls(): readonly TenantStorageCall[];

  seed(table: string, id: string, document: unknown): string;

  stored(table: string, id: string): unknown;

  size(): number;

  failOn(method: TenantStorageMethod, error: unknown): void;

  answerIndexedPageWith(answer: unknown): void;

  ignoreEqualityOn(field: string): void;

  cursorFor(offset: number): string;

  reset(): void;
}

function storageKey(table: string, id: string): string {
  return `${table}\u0000${id}`;
}

export function createTenantStoragePortFixture(): TenantStoragePortFixture {
  const documents = new Map<string, unknown>();
  const calls: TenantStorageCall[] = [];
  const failures = new Map<TenantStorageMethod, unknown>();

  const indexedPageOverride: unknown[] = [];
  const ignored = new Set<string>();
  let inserted = 0;

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
