/**
 * Isolation tier — cross-tenant properties of bounded indexed reads
 * (`createTenantDocumentAccess(...).byIndex` in `convex/lib/tenantDb.ts`,
 * T05b1c).
 *
 * The isolation tier is a blocking merge gate (`RG-031`). This file does not close
 * it, and it does not close `RG-013` or `G-102`: there is still no Convex adapter
 * and no deployed function, so nothing here proves that a *deployed* query is
 * confined to one tenant. What it proves is the layer such a query will be built
 * on, by attacking it — two tenants, one permissive store, and a port that is
 * allowed to lie.
 *
 * An indexed read has one more way to go wrong than a read by ID, and it is the
 * dangerous one: a read by ID answers with one document, so "is this mine?" is one
 * question. An indexed read answers with a *page*, produced by an index this
 * module did not build and an adapter this module did not write. Three things can
 * therefore be false at once — the index may not have honoured the tenant term,
 * the page may be longer than was asked for, and a row may not be a document at
 * all — and none of them is visible in the shape of the answer.
 *
 * The properties under attack:
 *
 * - an index that ignores the `orgId` term produces `INVALID_INDEX_RESULT`, and
 *   the foreign rows it yielded are **not** silently filtered out of the page:
 *   a boundary that trims a bad page teaches its caller that the page was fine;
 * - a port that answers with more rows than were asked for, an unparseable page,
 *   or a cursor that is not a cursor fails closed rather than being interpreted;
 * - a read whose table, index, equality prefix, limit, or cursor cannot be proved
 *   bounded reaches no port method at all, so a rejected read is not a read that
 *   happened and was thrown away;
 * - every declared tenant index is reachable *only* with `orgId` as its first
 *   equality term (`INV-0002-02`);
 * - no failure carries a table name, an index name, a field name, an `orgId`, or
 *   any part of a row (`INV-0002-07`).
 *
 * Both tenants' rows are given the same key on purpose. Similarity of shape must
 * buy an attacker nothing: ownership is decided by comparing keys.
 */
import { describe, expect, it } from "vitest";

import { TENANT_TABLES } from "../../convex/lib/schemaPolicy";
import {
  TENANT_INDEX_MAX_CURSOR_LENGTH,
  TENANT_INDEX_MAX_PAGE_SIZE,
  TENANT_DB_ERROR_MESSAGE,
  TenantDbError,
  createTenantDocumentAccess,
  type TenantDocumentAccess,
  type TenantIndexEquality,
  type TenantOrgId,
  type TenantOwnedDocument,
  type TenantStoragePort,
  type TenantTableName,
} from "../../convex/lib/tenantDb";
import { TENANT_INDEX_METADATA } from "../../convex/lib/tenantIndexPolicy";
import { fixtureId } from "../fixtures/tenant-context-world";
import {
  createTenantStoragePortFixture,
  type TenantStoragePortFixture,
} from "../fixtures/tenant-storage-port";

const REQUEST_ID = "req_01JBZ0000000000000000000";

/** The reader's tenant. */
const ORG_HOME: TenantOrgId = fixtureId("organizations", "home");
/** Another customer's tenant. Same shape, different key. */
const ORG_FOREIGN: TenantOrgId = fixtureId("organizations", "foreign");

const TABLE: TenantTableName = "warehouses";
const BY_CODE = "by_orgId_code";
const BY_STATUS_CODE = "by_orgId_status_code";

const HOME_ROW = {
  orgId: ORG_HOME,
  code: "NORTH",
  status: "ACTIVE",
} as const;

/** The foreign row, verbatim: nothing here may ever surface in a failure. */
const FOREIGN_ROW = {
  orgId: ORG_FOREIGN,
  code: "NORTH",
  status: "ACTIVE",
  supplierPriceThb: 1234,
} as const;

/**
 * Values that must never appear anywhere in a failure.
 *
 * The field name `code` is deliberately not in this list: it is a substring of the
 * public payload's own `code` key, which is part of the contract and discloses
 * nothing. `status` stands in for "a field name a read equality named", and
 * `by_orgId_code` for "the index a read named".
 */
const SECRETS = [
  ORG_FOREIGN,
  "foreign",
  "supplierPriceThb",
  "1234",
  TABLE,
  BY_CODE,
  "status",
] as const;

interface WarehouseLike extends TenantOwnedDocument {
  readonly code: string;
  readonly status: string;
}

/**
 * A home accessor over a store that also holds the foreign tenant's rows.
 *
 * `foreignFirst` decides which tenant's row a broken index would yield first.
 * It matters: a page bounded to one row hides a broken tenant term whenever the
 * home row happens to sort first, so the attack has to be able to put the foreign
 * row in front.
 */
function world(foreignFirst = false): {
  storage: TenantStoragePortFixture;
  home: TenantDocumentAccess;
  foreign: TenantDocumentAccess;
} {
  const storage = createTenantStoragePortFixture();

  const seedHome = (): void => {
    storage.seed(TABLE, fixtureId(TABLE, "home-north"), HOME_ROW);
  };
  const seedForeign = (): void => {
    storage.seed(TABLE, fixtureId(TABLE, "foreign-north"), FOREIGN_ROW);
  };

  if (foreignFirst) {
    seedForeign();
    seedHome();
  } else {
    seedHome();
    seedForeign();
  }

  return {
    storage,
    home: createTenantDocumentAccess(
      { orgId: ORG_HOME, requestId: REQUEST_ID },
      storage.port,
    ),
    foreign: createTenantDocumentAccess(
      { orgId: ORG_FOREIGN, requestId: REQUEST_ID },
      storage.port,
    ),
  };
}

/** An accessor over a port that answers every indexed read with `answer`. */
function accessorOverLyingPort(answer: unknown): {
  access: TenantDocumentAccess;
  calls: () => number;
} {
  let calls = 0;
  const unreachable = (): never => {
    throw new Error(
      "An indexed read must not reach any other port method. This fake has none.",
    );
  };
  const port: TenantStoragePort = {
    get: unreachable,
    insert: unreachable,
    patch: unreachable,
    replace: unreachable,
    delete: unreachable,
    indexedPage: async (): Promise<unknown> => {
      calls += 1;
      return answer;
    },
  };

  return {
    access: createTenantDocumentAccess(
      { orgId: ORG_HOME, requestId: REQUEST_ID },
      port,
    ),
    calls: () => calls,
  };
}

async function denial(call: () => Promise<unknown>): Promise<TenantDbError> {
  try {
    await call();
  } catch (error) {
    if (!(error instanceof TenantDbError)) {
      throw new Error(
        `Expected a TenantDbError, received ${String(error)}. The boundary must ` +
          "raise exactly one error type.",
      );
    }
    return error;
  }
  throw new Error("Expected the call to reject, but it resolved.");
}

/** Everything a caller could read off a failure, as one string. */
function everythingObservable(error: TenantDbError): string {
  return [
    error.message,
    error.name,
    JSON.stringify(error.toPublic()),
    JSON.stringify(Object.getOwnPropertyNames(error)),
    error.stack?.split("\n")[0] ?? "",
  ].join("\u0000");
}

describe("two tenants, one index, the same key", () => {
  it("answers each tenant only its own row", async () => {
    const { home, foreign } = world();
    const equality: TenantIndexEquality = [{ field: "code", value: "NORTH" }];

    const mine = await home
      .byIndex<WarehouseLike>(TABLE, BY_CODE, equality)
      .take(TENANT_INDEX_MAX_PAGE_SIZE);
    const theirs = await foreign
      .byIndex<WarehouseLike>(TABLE, BY_CODE, equality)
      .take(TENANT_INDEX_MAX_PAGE_SIZE);

    expect(mine.map((row) => row.orgId)).toEqual([ORG_HOME]);
    expect(theirs.map((row) => row.orgId)).toEqual([ORG_FOREIGN]);
    // The key they share buys neither of them the other's row.
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(1);
  });

  it("answers a unique-by-contract key without seeing the neighbour's", async () => {
    const { home } = world();

    const found = await home
      .byIndex<WarehouseLike>(TABLE, BY_CODE, [
        { field: "code", value: "NORTH" },
      ])
      .unique();

    expect(found?.orgId).toBe(ORG_HOME);
  });

  it("confines a partial-prefix read to one tenant", async () => {
    const { home, foreign } = world();
    const equality: TenantIndexEquality = [
      { field: "status", value: "ACTIVE" },
    ];

    const mine = await home
      .byIndex<WarehouseLike>(TABLE, BY_STATUS_CODE, equality)
      .page({ limit: TENANT_INDEX_MAX_PAGE_SIZE });
    const theirs = await foreign
      .byIndex<WarehouseLike>(TABLE, BY_STATUS_CODE, equality)
      .page({ limit: TENANT_INDEX_MAX_PAGE_SIZE });

    expect(mine.page.map((row) => row.orgId)).toEqual([ORG_HOME]);
    expect(theirs.page.map((row) => row.orgId)).toEqual([ORG_FOREIGN]);
  });

  it("confines a prefix-free read to one tenant", async () => {
    const { home } = world();

    const rows = await home
      .byIndex<WarehouseLike>(TABLE, BY_STATUS_CODE)
      .take(TENANT_INDEX_MAX_PAGE_SIZE);

    expect(rows.map((row) => row.orgId)).toEqual([ORG_HOME]);
  });
});

describe("an index that does not honour the tenant term", () => {
  it("fails closed rather than filtering the foreign rows out", async () => {
    const { storage, home } = world(true);
    // The index accepts the `orgId` equality and ranges over every tenant anyway.
    storage.ignoreEqualityOn("orgId");
    const reader = home.byIndex<WarehouseLike>(TABLE, BY_CODE, [
      { field: "code", value: "NORTH" },
    ]);

    for (const read of [
      () => reader.first(),
      () => reader.unique(),
      () => reader.take(TENANT_INDEX_MAX_PAGE_SIZE),
      () => reader.page({ limit: TENANT_INDEX_MAX_PAGE_SIZE }),
    ]) {
      const error = await denial(read);

      // Not "one row" and not "the home row": a page that should have been
      // impossible is a failure, not a page to be tidied up.
      expect(error.code).toBe("INVALID_INDEX_RESULT");
      expect(everythingObservable(error)).not.toContain(ORG_FOREIGN);
    }
  });

  it("fails even when the foreign row is not the first in the page", async () => {
    const { storage, home } = world();
    storage.ignoreEqualityOn("orgId");

    const error = await denial(() =>
      home.byIndex<WarehouseLike>(TABLE, BY_STATUS_CODE).take(10),
    );

    expect(error.code).toBe("INVALID_INDEX_RESULT");
  });
});

describe("a port that lies about the page", () => {
  it("refuses a page longer than was asked for", async () => {
    const { access } = accessorOverLyingPort({
      page: [HOME_ROW, HOME_ROW],
      isDone: true,
      continueCursor: "c",
    });

    const error = await denial(() => access.byIndex(TABLE, BY_CODE).first());

    expect(error.code).toBe("INVALID_INDEX_RESULT");
  });

  it("refuses a page holding another tenant's row, alone or mixed in", async () => {
    for (const rows of [
      [FOREIGN_ROW],
      [HOME_ROW, FOREIGN_ROW],
      [FOREIGN_ROW, HOME_ROW],
    ]) {
      const { access } = accessorOverLyingPort({
        page: rows,
        isDone: true,
        continueCursor: "c",
      });

      const error = await denial(() =>
        access.byIndex(TABLE, BY_CODE).take(TENANT_INDEX_MAX_PAGE_SIZE),
      );

      expect(error.code).toBe("INVALID_INDEX_RESULT");
      expect(everythingObservable(error)).not.toContain("1234");
    }
  });

  it("refuses a page holding something that is not a document", async () => {
    for (const row of [
      null,
      undefined,
      "warehouses:home-north",
      42,
      [],
      {},
      { code: "NORTH" },
      { orgId: "" },
      { orgId: ` ${ORG_HOME}` },
      { orgId: 1 },
      Object.create({ orgId: ORG_HOME }) as object,
    ]) {
      const { access } = accessorOverLyingPort({
        page: [row],
        isDone: true,
        continueCursor: "c",
      });

      const error = await denial(() => access.byIndex(TABLE, BY_CODE).first());

      expect(error.code).toBe("INVALID_INDEX_RESULT");
    }
  });

  it("refuses an answer that is not a bounded page at all", async () => {
    for (const answer of [
      null,
      undefined,
      "page",
      42,
      [HOME_ROW],
      {},
      { page: HOME_ROW, isDone: true, continueCursor: "c" },
      { page: [HOME_ROW], continueCursor: "c" },
      { page: [HOME_ROW], isDone: "yes", continueCursor: "c" },
      { page: [HOME_ROW], isDone: true },
      { page: [HOME_ROW], isDone: true, continueCursor: 1 },
      { page: [HOME_ROW], isDone: true, continueCursor: null },
      {
        page: [HOME_ROW],
        isDone: true,
        continueCursor: "x".repeat(TENANT_INDEX_MAX_CURSOR_LENGTH + 1),
      },
      // Not done, and no cursor to continue from: an unfinishable loop.
      { page: [HOME_ROW], isDone: false, continueCursor: "" },
    ]) {
      const { access } = accessorOverLyingPort(answer);

      const error = await denial(() => access.byIndex(TABLE, BY_CODE).first());

      expect(error.code).toBe("INVALID_INDEX_RESULT");
    }
  });

  it("refuses a second row under a key the schema calls unique", async () => {
    const { access } = accessorOverLyingPort({
      page: [HOME_ROW, HOME_ROW],
      isDone: true,
      continueCursor: "c",
    });

    const error = await denial(() =>
      access
        .byIndex(TABLE, BY_CODE, [{ field: "code", value: "NORTH" }])
        .unique(),
    );

    expect(error.code).toBe("INVALID_INDEX_RESULT");
  });
});

describe("a read that cannot be proved bounded reaches no storage", () => {
  it("makes no call for a table this accessor may not scope", () => {
    const { storage, home } = world();

    for (const table of ["organizations", "users", "permissions", "invoices"]) {
      expect(() => home.byIndex(table as TenantTableName, BY_CODE)).toThrow(
        TenantDbError,
      );
    }
    expect(storage.calls()).toEqual([]);
  });

  it("makes no call for an index the schema does not declare", () => {
    const { storage, home } = world();

    for (const index of ["by_code", "by_orgId_name", "", "__proto__"]) {
      expect(() => home.byIndex(TABLE, index)).toThrow(TenantDbError);
    }
    expect(storage.calls()).toEqual([]);
  });

  it("makes no call for an equality prefix that is not one", () => {
    const { storage, home } = world();

    for (const equality of [
      [{ field: "orgId", value: ORG_FOREIGN }],
      [{ field: "code", value: "NORTH" }],
      [{ field: "nope", value: "NORTH" }],
      [
        { field: "code", value: "NORTH" },
        { field: "status", value: "ACTIVE" },
      ],
    ]) {
      expect(() => home.byIndex(TABLE, BY_STATUS_CODE, equality)).toThrow(
        TenantDbError,
      );
    }
    expect(storage.calls()).toEqual([]);
  });

  it("makes no call for an unbounded limit or an unusable cursor", async () => {
    const { storage, home } = world();
    const reader = home.byIndex(TABLE, BY_CODE);

    await denial(() => reader.take(TENANT_INDEX_MAX_PAGE_SIZE + 1));
    await denial(() => reader.take(0));
    await denial(() => reader.page({ limit: 1_000_000 }));
    await denial(() => reader.page({ limit: 10, cursor: "" }));
    await denial(() =>
      reader.page({
        limit: 10,
        cursor: "x".repeat(TENANT_INDEX_MAX_CURSOR_LENGTH + 1),
      }),
    );

    expect(storage.calls()).toEqual([]);
  });

  it("makes no call, and no exception, for a scope with an unusable tenant key", async () => {
    const { storage } = world();

    for (const orgId of ["", " ", ` ${ORG_HOME}`, `${ORG_HOME} `]) {
      const access = createTenantDocumentAccess(
        { orgId: orgId as TenantOrgId, requestId: REQUEST_ID },
        storage.port,
      );

      expect(() => access.byIndex(TABLE, BY_CODE)).toThrow(TenantDbError);
    }
    expect(storage.calls()).toEqual([]);
  });
});

describe("every declared tenant index", () => {
  it("is reachable, and only with orgId as its first equality term", async () => {
    const { storage, home } = world();
    let read = 0;

    for (const table of TENANT_TABLES) {
      for (const [index, facts] of TENANT_INDEX_METADATA.get(table) ?? []) {
        expect(facts.fields[0]).toBe("orgId");

        await home.byIndex(table, index).first();
        read += 1;

        const call = storage.callsTo("indexedPage")[read - 1];
        expect(call?.table).toBe(table);
        expect(call?.index).toBe(index);
        expect((call?.equality as TenantIndexEquality)[0]).toEqual({
          field: "orgId",
          value: ORG_HOME,
        });
        expect(call?.limit).toBe(1);
      }
    }

    expect(read).toBeGreaterThan(TENANT_TABLES.length);
  });

  it("cannot be asked for its own orgId term", () => {
    const { home } = world();

    for (const table of TENANT_TABLES) {
      for (const index of TENANT_INDEX_METADATA.get(table)?.keys() ?? []) {
        expect(() =>
          home.byIndex(table, index, [{ field: "orgId", value: ORG_FOREIGN }]),
        ).toThrow(TenantDbError);
      }
    }
  });
});

describe("what a failure discloses", () => {
  it("carries a code and a request ID, and nothing else", async () => {
    const { storage, home } = world(true);
    storage.ignoreEqualityOn("orgId");

    const error = await denial(() =>
      home.byIndex(TABLE, BY_CODE, [{ field: "code", value: "NORTH" }]).first(),
    );

    expect(Object.keys(error.toPublic())).toEqual(["code", "requestId"]);
    expect(error.message).toBe(TENANT_DB_ERROR_MESSAGE);
    expect(error.toPublic().requestId).toBe(REQUEST_ID);
  });

  it("names no tenant, table, index, field, or row value", async () => {
    const { storage, home } = world(true);
    storage.ignoreEqualityOn("orgId");
    const reader = home.byIndex(TABLE, BY_CODE, [
      { field: "code", value: "NORTH" },
    ]);

    const errors = [
      await denial(() => reader.first()),
      await denial(() => reader.take(5)),
      await denial(() => reader.page({ limit: 5 })),
      // A read that named a field in its equality prefix.
      await denial(() =>
        home
          .byIndex(TABLE, BY_STATUS_CODE, [
            { field: "status", value: "ACTIVE" },
          ])
          .take(5),
      ),
      // A read refused before storage: the query shape must not leak either.
      await denial(() =>
        home.byIndex(TABLE, BY_CODE).page({ limit: 10, cursor: "" }),
      ),
      await denial(() => home.byIndex(TABLE, BY_CODE).take(0)),
    ];

    for (const error of errors) {
      const observable = everythingObservable(error);
      for (const secret of SECRETS) {
        expect(observable).not.toContain(secret);
      }
    }
  });
});
