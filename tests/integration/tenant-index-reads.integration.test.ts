/**
 * Integration tier — bounded `orgId`-first indexed reads
 * (`createTenantDocumentAccess(...).byIndex` in `convex/lib/tenantDb.ts`,
 * T05b1c).
 *
 * This tier proves the reader's contract: what it validates before storage is
 * touched, what it asks the port for, what it refuses, and what it hands back.
 * The cross-tenant properties — a broken index, a lying port, a foreign row that
 * must never be quietly dropped — are proved in
 * `tests/isolation/tenant-index-reads.isolation.test.ts`, because those are the
 * properties that block the merge gate (`RG-031`).
 *
 * Storage is the in-memory port fixture. Its `indexedPage` is an honest bounded
 * page and nothing more: it filters by the equality terms it is handed and slices
 * by limit and cursor. It has no allowlist, no metadata, and no opinion about
 * tenancy, so every guard observed here is the accessor's own. There is no Convex
 * deployment, no generated code, no `convex-test`, and no environment variable;
 * `G-102` stays open until the Convex adapter and the function wrappers exist.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  TENANT_INDEX_MAX_CURSOR_LENGTH,
  TENANT_INDEX_MAX_PAGE_SIZE,
  TenantDbError,
  createTenantDocumentAccess,
  type TenantDocumentAccess,
  type TenantIndexEquality,
  type TenantOrgId,
  type TenantOwnedDocument,
  type TenantTableName,
} from "../../convex/lib/tenantDb";
import { fixtureId } from "../fixtures/tenant-context-world";
import {
  createTenantStoragePortFixture,
  type TenantStoragePortFixture,
} from "../fixtures/tenant-storage-port";

const REQUEST_ID = "req_01JBZ0000000000000000000";
const ORG_A: TenantOrgId = fixtureId("organizations", "a");
const ORG_B: TenantOrgId = fixtureId("organizations", "b");

const TABLE: TenantTableName = "warehouses";
/** `["orgId", "code"]` — one field after the discriminator. */
const BY_CODE = "by_orgId_code";
/** `["orgId", "status", "code"]` — two fields after the discriminator. */
const BY_STATUS_CODE = "by_orgId_status_code";

interface WarehouseLike extends TenantOwnedDocument {
  readonly code: string;
  readonly status: "ACTIVE" | "INACTIVE";
}

let storage: TenantStoragePortFixture;
let access: TenantDocumentAccess;

/** Three of this tenant's rows, one of another's, seeded in a known order. */
beforeEach(() => {
  storage = createTenantStoragePortFixture();
  access = createTenantDocumentAccess(
    { orgId: ORG_A, requestId: REQUEST_ID },
    storage.port,
  );

  storage.seed(TABLE, fixtureId(TABLE, "a-north"), {
    orgId: ORG_A,
    code: "NORTH",
    status: "ACTIVE",
  });
  storage.seed(TABLE, fixtureId(TABLE, "a-south"), {
    orgId: ORG_A,
    code: "SOUTH",
    status: "ACTIVE",
  });
  storage.seed(TABLE, fixtureId(TABLE, "a-old"), {
    orgId: ORG_A,
    code: "OLD",
    status: "INACTIVE",
  });
  storage.seed(TABLE, fixtureId(TABLE, "b-north"), {
    orgId: ORG_B,
    code: "NORTH",
    status: "ACTIVE",
  });
});

/** The failure a caller can observe, reduced to what is comparable. */
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

/** The same, for `byIndex` itself, which validates synchronously. */
function syncDenial(call: () => unknown): TenantDbError {
  try {
    call();
  } catch (error) {
    if (!(error instanceof TenantDbError)) {
      throw new Error(
        `Expected a TenantDbError, received ${String(error)}. The boundary must ` +
          "raise exactly one error type.",
      );
    }
    return error;
  }
  throw new Error("Expected the call to throw, but it returned.");
}

describe("the reader a caller is handed", () => {
  it("exposes exactly the four bounded reads and nothing else", () => {
    const reader = access.byIndex(TABLE, BY_CODE);

    expect(Object.keys(reader).sort()).toEqual([
      "first",
      "page",
      "take",
      "unique",
    ]);
    for (const name of [
      "filter",
      "collect",
      "all",
      "scan",
      "count",
      "order",
      "withIndex",
      "paginate",
      "port",
      "db",
      "scope",
      "orgId",
    ]) {
      expect((reader as unknown as Record<string, unknown>)[name]).toBe(
        undefined,
      );
    }
  });

  it("is frozen and keeps the port to itself", () => {
    const reader = access.byIndex(TABLE, BY_CODE);
    const mutable = reader as unknown as Record<string, unknown>;

    expect(Object.isFrozen(reader)).toBe(true);
    expect(() => {
      mutable.filter = () => undefined;
    }).toThrow(TypeError);
    for (const value of Object.values(reader)) {
      expect(value).not.toBe(storage.port);
    }
  });

  it("touches no storage until a read is asked for", () => {
    access.byIndex(TABLE, BY_STATUS_CODE, [
      { field: "status", value: "ACTIVE" },
    ]);

    expect(storage.calls()).toEqual([]);
  });
});

describe("the table and index a read names", () => {
  it("refuses a table this accessor cannot scope, before storage", () => {
    for (const table of ["organizations", "users", "permissions", "invoices"]) {
      const error = syncDenial(() =>
        access.byIndex(table as TenantTableName, BY_CODE),
      );

      expect(error.code).toBe("INVALID_TENANT_TABLE");
    }
    expect(storage.calls()).toEqual([]);
  });

  it("refuses an index the schema does not declare on that table", () => {
    for (const index of [
      "by_orgId_name",
      "by_code",
      "by_orgId_userId",
      "",
      "__proto__",
    ]) {
      expect(syncDenial(() => access.byIndex(TABLE, index)).code).toBe(
        "INVALID_INDEX_QUERY",
      );
    }
    expect(storage.calls()).toEqual([]);
  });
});

describe("the equality prefix a read supplies", () => {
  it("accepts a full prefix, a partial prefix, and none at all", async () => {
    await access
      .byIndex<WarehouseLike>(TABLE, BY_STATUS_CODE, [
        { field: "status", value: "ACTIVE" },
        { field: "code", value: "NORTH" },
      ])
      .first();
    await access
      .byIndex<WarehouseLike>(TABLE, BY_STATUS_CODE, [
        { field: "status", value: "ACTIVE" },
      ])
      .first();
    await access.byIndex<WarehouseLike>(TABLE, BY_STATUS_CODE).first();

    expect(storage.callsTo("indexedPage").map((call) => call.equality)).toEqual(
      [
        [
          { field: "orgId", value: ORG_A },
          { field: "status", value: "ACTIVE" },
          { field: "code", value: "NORTH" },
        ],
        [
          { field: "orgId", value: ORG_A },
          { field: "status", value: "ACTIVE" },
        ],
        [{ field: "orgId", value: ORG_A }],
      ],
    );
  });

  it("puts the scope's orgId first, always", async () => {
    await access
      .byIndex(TABLE, BY_CODE, [{ field: "code", value: "NORTH" }])
      .first();

    const [call] = storage.callsTo("indexedPage");
    expect((call?.equality as TenantIndexEquality)[0]).toEqual({
      field: "orgId",
      value: ORG_A,
    });
  });

  it("refuses a caller-supplied orgId rather than correcting it", () => {
    for (const supplied of [
      [{ field: "orgId", value: ORG_A }],
      [{ field: "orgId", value: ORG_B }],
      [
        { field: "code", value: "NORTH" },
        { field: "orgId", value: ORG_B },
      ],
    ]) {
      expect(
        syncDenial(() => access.byIndex(TABLE, BY_CODE, supplied)).code,
      ).toBe("INVALID_INDEX_QUERY");
    }
    expect(storage.calls()).toEqual([]);
  });

  it("refuses anything that is not a contiguous prefix in index order", () => {
    const rejected: TenantIndexEquality[] = [
      // A field the index does not have.
      [{ field: "name", value: "x" }],
      // The second field without the first: an index cannot answer that.
      [{ field: "code", value: "NORTH" }],
      // The right fields, the wrong order.
      [
        { field: "code", value: "NORTH" },
        { field: "status", value: "ACTIVE" },
      ],
      // More terms than the index has fields.
      [
        { field: "status", value: "ACTIVE" },
        { field: "code", value: "NORTH" },
        { field: "extra", value: 1 },
      ],
      // A repeated field.
      [
        { field: "status", value: "ACTIVE" },
        { field: "status", value: "INACTIVE" },
      ],
    ];

    for (const supplied of rejected) {
      expect(
        syncDenial(() => access.byIndex(TABLE, BY_STATUS_CODE, supplied)).code,
      ).toBe("INVALID_INDEX_QUERY");
    }
    expect(storage.calls()).toEqual([]);
  });

  it("refuses a term that is not a { field, value } pair", () => {
    for (const term of [
      null,
      undefined,
      "code",
      42,
      [],
      ["code", "NORTH"],
      { field: 1, value: "NORTH" },
      { value: "NORTH" },
      // Present but absent: "equal to nothing" is not an equality.
      { field: "code", value: undefined },
      // `value` inherited rather than own.
      Object.create({ value: "NORTH" }, { field: { value: "code" } }) as object,
    ]) {
      expect(
        syncDenial(() =>
          access.byIndex(TABLE, BY_CODE, [term] as TenantIndexEquality),
        ).code,
      ).toBe("INVALID_INDEX_QUERY");
    }
    expect(storage.calls()).toEqual([]);
  });

  it("refuses an equality argument that is not an array", () => {
    for (const supplied of [null, "code", 1, { field: "code", value: "x" }]) {
      expect(
        syncDenial(() =>
          access.byIndex(
            TABLE,
            BY_CODE,
            supplied as unknown as TenantIndexEquality,
          ),
        ).code,
      ).toBe("INVALID_INDEX_QUERY");
    }
    expect(storage.calls()).toEqual([]);
  });

  it("neither mutates nor trusts the caller's array after the fact", async () => {
    const term = { field: "code", value: "NORTH" };
    const supplied = [term];
    const reader = access.byIndex<WarehouseLike>(TABLE, BY_CODE, supplied);

    // The caller's own objects are untouched: not frozen, not rewritten.
    expect(supplied).toEqual([{ field: "code", value: "NORTH" }]);
    expect(Object.isFrozen(supplied)).toBe(false);
    expect(Object.isFrozen(term)).toBe(false);

    // And a later mutation of them cannot change what the reader queries.
    supplied.push({ field: "status", value: "ACTIVE" });
    term.value = "SOUTH";
    const found = await reader.first();

    expect(found?.code).toBe("NORTH");
    expect(storage.callsTo("indexedPage")[0]?.equality).toEqual([
      { field: "orgId", value: ORG_A },
      { field: "code", value: "NORTH" },
    ]);
  });
});

describe("first", () => {
  it("asks for one row and answers with it", async () => {
    const found = await access
      .byIndex<WarehouseLike>(TABLE, BY_CODE, [
        { field: "code", value: "NORTH" },
      ])
      .first();

    expect(found?.code).toBe("NORTH");
    expect(found?.orgId).toBe(ORG_A);
    expect(storage.callsTo("indexedPage")).toEqual([
      {
        method: "indexedPage",
        table: TABLE,
        index: BY_CODE,
        equality: [
          { field: "orgId", value: ORG_A },
          { field: "code", value: "NORTH" },
        ],
        limit: 1,
        cursor: null,
      },
    ]);
  });

  it("answers null when the prefix matches nothing", async () => {
    const found = await access
      .byIndex<WarehouseLike>(TABLE, BY_CODE, [
        { field: "code", value: "NEVER_WRITTEN" },
      ])
      .first();

    expect(found).toBeNull();
  });
});

describe("unique", () => {
  it("asks for two rows and answers with the only one", async () => {
    const found = await access
      .byIndex<WarehouseLike>(TABLE, BY_CODE, [
        { field: "code", value: "SOUTH" },
      ])
      .unique();

    expect(found?.code).toBe("SOUTH");
    expect(storage.callsTo("indexedPage")[0]?.limit).toBe(2);
  });

  it("answers null when there is none", async () => {
    const found = await access
      .byIndex<WarehouseLike>(TABLE, BY_CODE, [
        { field: "code", value: "NONE" },
      ])
      .unique();

    expect(found).toBeNull();
  });

  it("refuses to pick one when a unique-by-contract key has two rows", async () => {
    // Convex has no unique constraint, so this is a state the database allows and
    // the mutation that owes the check has not prevented.
    storage.seed(TABLE, fixtureId(TABLE, "a-north-duplicate"), {
      orgId: ORG_A,
      code: "NORTH",
      status: "ACTIVE",
    });

    const error = await denial(() =>
      access
        .byIndex<WarehouseLike>(TABLE, BY_CODE, [
          { field: "code", value: "NORTH" },
        ])
        .unique(),
    );

    expect(error.code).toBe("INVALID_INDEX_RESULT");
  });
});

describe("take", () => {
  it("answers at most the requested rows, frozen", async () => {
    const rows = await access
      .byIndex<WarehouseLike>(TABLE, BY_STATUS_CODE, [
        { field: "status", value: "ACTIVE" },
      ])
      .take(2);

    expect(rows.map((row) => row.code)).toEqual(["NORTH", "SOUTH"]);
    expect(Object.isFrozen(rows)).toBe(true);
    expect(storage.callsTo("indexedPage")[0]?.limit).toBe(2);
  });

  it("answers every matching row of this tenant and none of another's", async () => {
    const rows = await access
      .byIndex<WarehouseLike>(TABLE, BY_CODE, [
        { field: "code", value: "NORTH" },
      ])
      .take(TENANT_INDEX_MAX_PAGE_SIZE);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.orgId).toBe(ORG_A);
  });

  it("caps the page size rather than clamping it, and asks nothing first", async () => {
    for (const limit of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      TENANT_INDEX_MAX_PAGE_SIZE + 1,
      1000,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER + 2,
      "10" as unknown as number,
    ]) {
      const error = await denial(() =>
        access.byIndex(TABLE, BY_CODE).take(limit),
      );

      expect(error.code).toBe("INVALID_LIMIT");
    }
    expect(storage.calls()).toEqual([]);
  });

  it("accepts exactly the documented maximum", async () => {
    await access.byIndex(TABLE, BY_CODE).take(TENANT_INDEX_MAX_PAGE_SIZE);

    expect(storage.callsTo("indexedPage")[0]?.limit).toBe(
      TENANT_INDEX_MAX_PAGE_SIZE,
    );
  });
});

describe("page", () => {
  it("answers a frozen page, its rows, and the cursor to resume from", async () => {
    const first = await access
      .byIndex<WarehouseLike>(TABLE, BY_STATUS_CODE)
      .page({ limit: 2 });

    expect(first.page.map((row) => row.code)).toEqual(["NORTH", "SOUTH"]);
    expect(first.isDone).toBe(false);
    expect(first.continueCursor.length).toBeGreaterThan(0);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.page)).toBe(true);
    expect(storage.callsTo("indexedPage")[0]?.cursor).toBeNull();
  });

  it("resumes from a cursor it was given, verbatim", async () => {
    const first = await access
      .byIndex<WarehouseLike>(TABLE, BY_STATUS_CODE)
      .page({ limit: 2 });
    const second = await access
      .byIndex<WarehouseLike>(TABLE, BY_STATUS_CODE)
      .page({ limit: 2, cursor: first.continueCursor });

    expect(second.page.map((row) => row.code)).toEqual(["OLD"]);
    expect(second.isDone).toBe(true);
    expect(storage.callsTo("indexedPage")[1]?.cursor).toBe(
      first.continueCursor,
    );
  });

  it("caps the page size the same way take does", async () => {
    for (const limit of [0, -1, 1.5, TENANT_INDEX_MAX_PAGE_SIZE + 1]) {
      const error = await denial(() =>
        access.byIndex(TABLE, BY_CODE).page({ limit }),
      );

      expect(error.code).toBe("INVALID_LIMIT");
    }
    expect(storage.calls()).toEqual([]);
  });

  it("refuses a cursor that is not a usable opaque string", async () => {
    for (const cursor of [
      "",
      "x".repeat(TENANT_INDEX_MAX_CURSOR_LENGTH + 1),
      null as unknown as string,
      42 as unknown as string,
      {} as unknown as string,
    ]) {
      const error = await denial(() =>
        access.byIndex(TABLE, BY_CODE).page({ limit: 10, cursor }),
      );

      expect(error.code).toBe("INVALID_INDEX_QUERY");
    }
    expect(storage.calls()).toEqual([]);
  });

  it("accepts a cursor of exactly the documented maximum length", async () => {
    const cursor = "x".repeat(TENANT_INDEX_MAX_CURSOR_LENGTH);
    await access.byIndex(TABLE, BY_CODE).page({ limit: 1, cursor });

    expect(storage.callsTo("indexedPage")[0]?.cursor).toBe(cursor);
  });

  it("refuses a request that is not a request", async () => {
    for (const request of [null, undefined, 10, "10"]) {
      const error = await denial(() =>
        access
          .byIndex(TABLE, BY_CODE)
          .page(request as unknown as { limit: number }),
      );

      expect(["INVALID_INDEX_QUERY", "INVALID_LIMIT"]).toContain(error.code);
    }
    expect(storage.calls()).toEqual([]);
  });

  it("reads the limit before the cursor, so an unbounded ask is named as one", async () => {
    const error = await denial(() =>
      access.byIndex(TABLE, BY_CODE).page({ limit: 1000, cursor: "" }),
    );

    expect(error.code).toBe("INVALID_LIMIT");
  });
});

describe("a port that throws", () => {
  it("lets a TenantDbError travel unchanged", async () => {
    const raised = new TenantDbError("NOT_FOUND", REQUEST_ID);
    storage.failOn("indexedPage", raised);

    const error = await denial(() => access.byIndex(TABLE, BY_CODE).first());

    expect(error).toBe(raised);
  });
});
