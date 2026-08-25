import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  TENANT_DB_ERROR_MESSAGE,
  TENANT_INDEX_MAX_CURSOR_LENGTH,
  TENANT_INDEX_MAX_PAGE_SIZE,
  TenantDbError,
  createTenantDocumentAccess,
  type TenantIndexEquality,
  type TenantOwnedDocument,
  type TenantStoragePort,
  type TenantTableName,
} from "../../convex/lib/tenantDb";
import {
  createMutationTenantStorage,
  createQueryTenantStorage,
  type TenantMutationContext,
} from "../../convex/lib/tenantStorage";
import {
  FIXTURE_REQUEST_ID as REQUEST_ID,
  createConvexTenantWorld,
  storedWarehouse,
  storedWarehouses,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

const TABLE: TenantTableName = "warehouses";

const BY_CODE = "by_orgId_code";

const BY_STATUS_CODE = "by_orgId_status_code";

interface WarehouseLike extends TenantOwnedDocument {
  readonly _id: GenericId<"warehouses">;
  readonly code: string;
  readonly status: "ACTIVE" | "INACTIVE";
}

async function denial(call: () => Promise<unknown>): Promise<TenantDbError> {
  try {
    await call();
  } catch (error) {
    if (!(error instanceof TenantDbError)) {
      throw new Error(
        `Expected a TenantDbError, received ${String(error)}. The adapter must ` +
          "raise exactly one error type, so no Convex message can escape.",
      );
    }
    return error;
  }
  throw new Error("Expected the call to reject, but it resolved.");
}

/* Structural stub, for answers convex-test cannot produce                     */

interface StubLog {
  readonly index: string[];
  readonly eq: { field: string; value: unknown }[];
  readonly take: number[];
  readonly paginate: { numItems: number; cursor: string | null }[];
}

interface StubBehaviour {
  readonly take?: () => unknown;
  readonly paginate?: () => unknown;
}

function stubMutationContext(behaviour: StubBehaviour): {
  readonly ctx: TenantMutationContext;
  readonly log: StubLog;
} {
  const log: StubLog = { index: [], eq: [], take: [], paginate: [] };

  const forbidden = (name: string) => (): never => {
    throw new Error(
      `The adapter must never call ${name}: an unbounded read of a tenant ` +
        "table is how cross-tenant reads happen (INV-0002-04).",
    );
  };

  const builder = {
    eq: (field: string, value: unknown) => {
      log.eq.push({ field, value });
      return builder;
    },
  };

  const boundedQuery = {
    take: async (count: number): Promise<unknown> => {
      log.take.push(count);

      return behaviour.take === undefined ? [] : behaviour.take();
    },
    paginate: async (options: {
      numItems: number;
      cursor: string | null;
    }): Promise<unknown> => {
      log.paginate.push(options);
      return behaviour.paginate === undefined
        ? { page: [], isDone: true, continueCursor: "" }
        : behaviour.paginate();
    },
    filter: forbidden("filter"),
    collect: forbidden("collect"),
    order: forbidden("order"),
    first: forbidden("first"),
    unique: forbidden("unique"),
  };

  const db = {
    normalizeId: (_table: string, id: string): string | null =>
      typeof id === "string" && id.length > 0 ? id : null,
    get: async (): Promise<unknown> => null,
    query: (_table: string) => ({
      withIndex: (index: string, range: (b: typeof builder) => unknown) => {
        log.index.push(index);
        range(builder);
        return boundedQuery;
      },
      filter: forbidden("filter"),
      collect: forbidden("collect"),
      fullTableScan: forbidden("fullTableScan"),
      order: forbidden("order"),
    }),
    insert: async (): Promise<unknown> => "stub",
    patch: async (): Promise<void> => undefined,
    replace: async (): Promise<void> => undefined,
    delete: async (): Promise<void> => undefined,
  };

  return { ctx: { db } as unknown as TenantMutationContext, log };
}

describe("the port a Convex context yields", () => {
  it("exposes exactly the six port methods, frozen, and no database", async () => {
    const world = await createConvexTenantWorld();

    await world.t.run(async (ctx) => {
      const port = createMutationTenantStorage(ctx, REQUEST_ID);

      expect(Object.keys(port).sort()).toEqual([
        "delete",
        "get",
        "indexedPage",
        "insert",
        "patch",
        "replace",
      ]);
      expect(Object.isFrozen(port)).toBe(true);
      for (const value of Object.values(port)) {
        expect(value).not.toBe(ctx.db);
      }
      for (const name of ["db", "ctx", "query", "filter", "collect", "scan"]) {
        expect((port as unknown as Record<string, unknown>)[name]).toBe(
          undefined,
        );
      }
    });
  });

  it("touches no storage until a method is called", async () => {
    const { ctx, log } = stubMutationContext({});
    createMutationTenantStorage(ctx, REQUEST_ID);
    createQueryTenantStorage(ctx, REQUEST_ID);

    expect(log).toEqual({ index: [], eq: [], take: [], paginate: [] });
  });
});

describe("a read by document ID", () => {
  it("answers this tenant's document through the accessor", async () => {
    const world = await createConvexTenantWorld();

    const document = await world.t.run(async (ctx) => {
      const access = createTenantDocumentAccess(
        { orgId: world.orgA, requestId: REQUEST_ID },
        createMutationTenantStorage(ctx, REQUEST_ID),
      );
      return await access.getX<WarehouseLike>(TABLE, world.warehouses.alphaA);
    });

    expect(document.code).toBe("ALPHA");
    expect(document.orgId).toBe(world.orgA);
  });

  it("answers an unusable ID exactly as it answers an absent document", async () => {
    const world = await createConvexTenantWorld();

    const answers = await world.t.run(async (ctx) => {
      const port = createMutationTenantStorage(ctx, REQUEST_ID);
      return await Promise.all(
        [
          world.vanishedWarehouse,
          world.userA,
          "not-an-id",
          "",
          "__proto__",
          " ".repeat(32),
        ].map(async (id) => await port.get(TABLE, id)),
      );
    });

    expect(answers).toEqual([null, null, null, null, null, null]);
  });

  it("refuses a table it cannot scope, before Convex is asked", async () => {
    const { ctx, log } = stubMutationContext({});
    const port = createMutationTenantStorage(ctx, REQUEST_ID);

    for (const table of ["organizations", "users", "permissions", "invoices"]) {
      const error = await denial(
        async () => await port.get(table as TenantTableName, "anything"),
      );
      expect(error.code).toBe("INVALID_TENANT_TABLE");
    }
    expect(log.index).toEqual([]);
  });
});

describe("a write through a mutation context", () => {
  it("stamps the scope's tenant and stores a readable document", async () => {
    const world = await createConvexTenantWorld();

    const id = await world.t.run(async (ctx) => {
      const access = createTenantDocumentAccess(
        { orgId: world.orgA, requestId: REQUEST_ID },
        createMutationTenantStorage(ctx, REQUEST_ID),
      );
      return await access.insert(TABLE, {
        code: "ECHO",
        name: "Warehouse ECHO",
        status: "ACTIVE",
      });
    });

    const stored = await storedWarehouse(
      world,
      id as ConvexTenantWorld["warehouses"]["alphaA"],
    );
    expect(stored).toMatchObject({ orgId: world.orgA, code: "ECHO" });
  });

  it("patches, replaces, and deletes a document this tenant owns", async () => {
    const world = await createConvexTenantWorld();
    const target = world.warehouses.bravoA;

    await world.t.run(async (ctx) => {
      const access = createTenantDocumentAccess(
        { orgId: world.orgA, requestId: REQUEST_ID },
        createMutationTenantStorage(ctx, REQUEST_ID),
      );
      await access.patch(TABLE, target, { status: "INACTIVE" });
    });
    expect(await storedWarehouse(world, target)).toMatchObject({
      code: "BRAVO",
      status: "INACTIVE",
    });

    await world.t.run(async (ctx) => {
      const access = createTenantDocumentAccess(
        { orgId: world.orgA, requestId: REQUEST_ID },
        createMutationTenantStorage(ctx, REQUEST_ID),
      );
      await access.replace(TABLE, target, {
        code: "BRAVO2",
        name: "Warehouse BRAVO2",
        status: "ACTIVE",
      });
    });
    // The tenant is re-derived by the accessor and re-checked by the adapter, so a
    // replace cannot leave an untenanted row.
    expect(await storedWarehouse(world, target)).toMatchObject({
      orgId: world.orgA,
      code: "BRAVO2",
      status: "ACTIVE",
    });

    await world.t.run(async (ctx) => {
      const access = createTenantDocumentAccess(
        { orgId: world.orgA, requestId: REQUEST_ID },
        createMutationTenantStorage(ctx, REQUEST_ID),
      );
      await access.delete(TABLE, target);
    });
    expect(await storedWarehouse(world, target)).toBe(null);
  });

  it("refuses a document that names a Convex system field", async () => {
    const world = await createConvexTenantWorld();
    const before = await storedWarehouses(world);

    await world.t.run(async (ctx) => {
      const port = createMutationTenantStorage(ctx, REQUEST_ID);

      for (const document of [
        { orgId: world.orgA, _id: "x", code: "F" },
        { orgId: world.orgA, _creationTime: 1, code: "F" },
      ]) {
        const error = await denial(
          async () => await port.insert(TABLE, document),
        );
        expect(error.code).toBe("INVALID_WRITE");
      }
    });

    expect(await storedWarehouses(world)).toEqual(before);
  });

  it("refuses an insert with no tenant and a patch that names one", async () => {
    const world = await createConvexTenantWorld();
    const before = await storedWarehouses(world);

    await world.t.run(async (ctx) => {
      const port = createMutationTenantStorage(ctx, REQUEST_ID);

      for (const document of [
        { code: "F", name: "F", status: "ACTIVE" },
        { orgId: "", code: "F" },
        { orgId: "not-an-id", code: "F" },
        { orgId: world.userA, code: "F" },
      ]) {
        expect(
          (await denial(async () => await port.insert(TABLE, document))).code,
        ).toBe("INVALID_WRITE");
      }

      expect(
        (
          await denial(
            async () =>
              await port.patch(TABLE, world.warehouses.alphaA, {
                orgId: world.orgA,
              }),
          )
        ).code,
      ).toBe("INVALID_WRITE");
    });

    expect(await storedWarehouses(world)).toEqual(before);
  });

  it("refuses an unusable ID as NOT_FOUND and writes nothing", async () => {
    const world = await createConvexTenantWorld();
    const before = await storedWarehouses(world);

    await world.t.run(async (ctx) => {
      const port = createMutationTenantStorage(ctx, REQUEST_ID);

      for (const id of [world.vanishedWarehouse, world.userA, "", "nope"]) {
        expect(
          (await denial(async () => await port.patch(TABLE, id, { code: "X" })))
            .code,
        ).toBe("NOT_FOUND");
        expect(
          (
            await denial(
              async () => await port.replace(TABLE, id, { orgId: world.orgA }),
            )
          ).code,
        ).toBe("NOT_FOUND");
        expect(
          (await denial(async () => await port.delete(TABLE, id))).code,
        ).toBe("NOT_FOUND");
      }
    });

    expect(await storedWarehouses(world)).toEqual(before);
  });
});

describe("an indexed read", () => {
  it("applies the equality fields in order, beginning with orgId", async () => {
    const { ctx, log } = stubMutationContext({});
    const port = createMutationTenantStorage(ctx, REQUEST_ID);

    await port.indexedPage(
      TABLE,
      BY_STATUS_CODE,
      [
        { field: "orgId", value: "org-1" },
        { field: "status", value: "ACTIVE" },
        { field: "code", value: "ALPHA" },
      ],
      { limit: 5, cursor: null },
    );

    expect(log.index).toEqual([BY_STATUS_CODE]);
    expect(log.eq).toEqual([
      { field: "orgId", value: "org-1" },
      { field: "status", value: "ACTIVE" },
      { field: "code", value: "ALPHA" },
    ]);
  });

  it("reads a partial prefix and a bare orgId prefix", async () => {
    const world = await createConvexTenantWorld();

    const rows = await world.t.run(async (ctx) => {
      const access = createTenantDocumentAccess(
        { orgId: world.orgA, requestId: REQUEST_ID },
        createMutationTenantStorage(ctx, REQUEST_ID),
      );
      const active = await access
        .byIndex<WarehouseLike>(TABLE, BY_STATUS_CODE, [
          { field: "status", value: "ACTIVE" },
        ])
        .take(TENANT_INDEX_MAX_PAGE_SIZE);
      const all = await access
        .byIndex<WarehouseLike>(TABLE, BY_CODE)
        .take(TENANT_INDEX_MAX_PAGE_SIZE);
      return { active, all };
    });

    expect(rows.active.map((row) => row.code)).toEqual([
      "ALPHA",
      "BRAVO",
      "CHARLIE",
    ]);
    expect(rows.all.map((row) => row.code)).toEqual([
      "ALPHA",
      "BRAVO",
      "CHARLIE",
      "DELTA",
    ]);
  });

  it("finds exactly one row for a key that is unique by contract", async () => {
    const world = await createConvexTenantWorld();

    const found = await world.t.run(async (ctx) => {
      const access = createTenantDocumentAccess(
        { orgId: world.orgA, requestId: REQUEST_ID },
        createMutationTenantStorage(ctx, REQUEST_ID),
      );
      return {
        alpha: await access
          .byIndex<WarehouseLike>(TABLE, BY_CODE, [
            { field: "code", value: "ALPHA" },
          ])
          .unique(),
        missing: await access
          .byIndex<WarehouseLike>(TABLE, BY_CODE, [
            { field: "code", value: "NOWHERE" },
          ])
          .unique(),
      };
    });

    expect(found.alpha?._id).toBe(world.warehouses.alphaA);
    expect(found.missing).toBe(null);
  });

  it("spends no pagination budget on a read whose range fits", async () => {
    const world = await createConvexTenantWorld();

    const counts = await world.t.run(async (ctx) => {
      const access = createTenantDocumentAccess(
        { orgId: world.orgA, requestId: REQUEST_ID },
        createMutationTenantStorage(ctx, REQUEST_ID),
      );
      const reader = access.byIndex<WarehouseLike>(TABLE, BY_CODE);
      return [
        (await reader.take(TENANT_INDEX_MAX_PAGE_SIZE)).length,
        (await reader.take(TENANT_INDEX_MAX_PAGE_SIZE)).length,
        (
          await access
            .byIndex<WarehouseLike>(TABLE, BY_CODE, [
              { field: "code", value: "ALPHA" },
            ])
            .unique()
        )?.code.length,
        (await reader.page({ limit: TENANT_INDEX_MAX_PAGE_SIZE })).page.length,
      ];
    });

    expect(counts).toEqual([4, 4, 5, 4]);
  });

  it("probes one row past the limit, then paginates only when there is more", async () => {
    const equality: TenantIndexEquality = [{ field: "orgId", value: "org-1" }];

    const exhausted = stubMutationContext({ take: () => [{ orgId: "org-1" }] });
    const page = await createMutationTenantStorage(
      exhausted.ctx,
      REQUEST_ID,
    ).indexedPage(TABLE, BY_CODE, equality, { limit: 2, cursor: null });

    expect(exhausted.log.take).toEqual([3]);
    expect(exhausted.log.paginate).toEqual([]);
    expect(page).toEqual({
      page: [{ orgId: "org-1" }],
      isDone: true,
      continueCursor: "",
    });

    const overfull = stubMutationContext({
      take: () => [{ orgId: "org-1" }, { orgId: "org-1" }, { orgId: "org-1" }],
      paginate: () => ({
        page: [{ orgId: "org-1" }, { orgId: "org-1" }],
        isDone: false,
        continueCursor: "cursor-2",
      }),
    });
    await createMutationTenantStorage(overfull.ctx, REQUEST_ID).indexedPage(
      TABLE,
      BY_CODE,
      equality,
      { limit: 2, cursor: null },
    );

    expect(overfull.log.take).toEqual([3]);
    expect(overfull.log.paginate).toEqual([{ numItems: 2, cursor: null }]);

    const resumed = stubMutationContext({
      paginate: () => ({ page: [], isDone: true, continueCursor: "end" }),
    });
    await createMutationTenantStorage(resumed.ctx, REQUEST_ID).indexedPage(
      TABLE,
      BY_CODE,
      equality,
      { limit: 7, cursor: "cursor-2" },
    );

    expect(resumed.log.take).toEqual([]);
    expect(resumed.log.paginate).toEqual([{ numItems: 7, cursor: "cursor-2" }]);
  });

  it("pages through a range with a cursor Convex minted", async () => {
    const world = await createConvexTenantWorld();

    const scope = { orgId: world.orgA, requestId: REQUEST_ID };
    const reader = (ctx: TenantMutationContext) =>
      createTenantDocumentAccess(
        scope,
        createMutationTenantStorage(ctx, REQUEST_ID),
      ).byIndex<WarehouseLike>(TABLE, BY_CODE);

    const first = await world.t.run(
      async (ctx) => await reader(ctx).page({ limit: 2 }),
    );
    expect(first.page.map((row) => row.code)).toEqual(["ALPHA", "BRAVO"]);
    expect(first.isDone).toBe(false);
    expect(first.continueCursor.length).toBeGreaterThan(0);

    const second = await world.t.run(
      async (ctx) =>
        await reader(ctx).page({ limit: 2, cursor: first.continueCursor }),
    );
    expect(second.page.map((row) => row.code)).toEqual(["CHARLIE", "DELTA"]);
    expect(second.isDone).toBe(true);
  });

  it("refuses an index the schema does not declare on that table", async () => {
    const { ctx, log } = stubMutationContext({});
    const port = createMutationTenantStorage(ctx, REQUEST_ID);
    const equality: TenantIndexEquality = [{ field: "orgId", value: "org-1" }];

    for (const index of [
      "by_orgId_name",
      "by_code",
      "by_orgId_userId",
      "",
      "__proto__",
    ]) {
      const error = await denial(
        async () =>
          await port.indexedPage(TABLE, index, equality, {
            limit: 1,
            cursor: null,
          }),
      );
      expect(error.code).toBe("INVALID_INDEX_QUERY");
    }
    expect(log.index).toEqual([]);
  });

  it("refuses an equality list that is not a declared prefix", async () => {
    const { ctx, log } = stubMutationContext({});
    const port = createMutationTenantStorage(ctx, REQUEST_ID);

    const rejected: readonly {
      readonly index: string;
      readonly equality: TenantIndexEquality;
    }[] = [
      { index: BY_CODE, equality: [] },

      { index: BY_CODE, equality: [{ field: "code", value: "ALPHA" }] },
      {
        index: BY_STATUS_CODE,
        equality: [
          { field: "status", value: "ACTIVE" },
          { field: "orgId", value: "org-1" },
        ],
      },
      // A gap: an index cannot answer an equality on its third field without one
      // on its second.
      {
        index: BY_STATUS_CODE,
        equality: [
          { field: "orgId", value: "org-1" },
          { field: "code", value: "ALPHA" },
        ],
      },

      {
        index: BY_CODE,
        equality: [
          { field: "orgId", value: "org-1" },
          { field: "code", value: "ALPHA" },
          { field: "extra", value: 1 },
        ],
      },

      { index: BY_CODE, equality: ["orgId"] as unknown as TenantIndexEquality },

      { index: BY_CODE, equality: [{ field: "orgId", value: "" }] },
      { index: BY_CODE, equality: [{ field: "orgId", value: 7 }] },

      { index: BY_CODE, equality: [{ field: "orgId", value: undefined }] },
    ];

    for (const { index, equality } of rejected) {
      const error = await denial(
        async () =>
          await port.indexedPage(TABLE, index, equality, {
            limit: 1,
            cursor: null,
          }),
      );
      expect(error.code).toBe("INVALID_INDEX_QUERY");

      expect(error.message).toBe(TENANT_DB_ERROR_MESSAGE);
      expect(Object.keys(error.toPublic()).sort()).toEqual([
        "code",
        "requestId",
      ]);
    }
    expect(log.index).toEqual([]);
  });

  it("refuses a page size that is absent, zero, fractional, or over the cap", async () => {
    const { ctx, log } = stubMutationContext({});
    const port = createMutationTenantStorage(ctx, REQUEST_ID);
    const equality: TenantIndexEquality = [{ field: "orgId", value: "org-1" }];

    for (const limit of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      TENANT_INDEX_MAX_PAGE_SIZE + 1,
      undefined as unknown as number,
    ]) {
      const error = await denial(
        async () =>
          await port.indexedPage(TABLE, BY_CODE, equality, {
            limit,
            cursor: null,
          }),
      );
      expect(error.code).toBe("INVALID_LIMIT");
    }
    expect(log.take).toEqual([]);
  });

  it("refuses a cursor that is empty or absurdly large", async () => {
    const { ctx, log } = stubMutationContext({});
    const port = createMutationTenantStorage(ctx, REQUEST_ID);
    const equality: TenantIndexEquality = [{ field: "orgId", value: "org-1" }];

    for (const cursor of ["", "x".repeat(TENANT_INDEX_MAX_CURSOR_LENGTH + 1)]) {
      const error = await denial(
        async () =>
          await port.indexedPage(TABLE, BY_CODE, equality, {
            limit: 1,
            cursor,
          }),
      );
      expect(error.code).toBe("INVALID_INDEX_QUERY");
    }
    expect(log.paginate).toEqual([]);
  });
});

describe("an answer Convex should never have given", () => {
  const equality: TenantIndexEquality = [{ field: "orgId", value: "org-1" }];

  const cases: readonly { readonly name: string; readonly answer: unknown }[] =
    [
      { name: "not an object", answer: 7 },
      { name: "null", answer: null },
      { name: "an array", answer: [] },
      { name: "a page that is not an array", answer: { page: {} } },
      {
        name: "a page longer than the limit",
        answer: {
          page: [{ orgId: "org-1" }, { orgId: "org-1" }],
          isDone: true,
          continueCursor: "",
        },
      },
      {
        name: "a non-boolean isDone",
        answer: { page: [], isDone: "yes", continueCursor: "" },
      },
      {
        name: "a cursor that is not a string",
        answer: { page: [], isDone: true, continueCursor: 1 },
      },
      {
        name: "an absurdly large cursor",
        answer: {
          page: [],
          isDone: true,
          continueCursor: "x".repeat(TENANT_INDEX_MAX_CURSOR_LENGTH + 1),
        },
      },
      {
        name: "unfinished with nothing to continue from",
        answer: { page: [], isDone: false, continueCursor: "" },
      },
    ];

  for (const { name, answer } of cases) {
    it(`rejects ${name} as INVALID_INDEX_RESULT`, async () => {
      const { ctx } = stubMutationContext({
        take: () => [{ orgId: "org-1" }, { orgId: "org-1" }],
        paginate: () => answer,
      });
      const port = createMutationTenantStorage(ctx, REQUEST_ID);

      const error = await denial(
        async () =>
          await port.indexedPage(TABLE, BY_CODE, equality, {
            limit: 1,
            cursor: null,
          }),
      );
      expect(error.code).toBe("INVALID_INDEX_RESULT");
      expect(error.requestId).toBe(REQUEST_ID);
    });
  }

  it("rejects a batch read that is not an array", async () => {
    const { ctx } = stubMutationContext({ take: () => ({ rows: [] }) });
    const port = createMutationTenantStorage(ctx, REQUEST_ID);

    const error = await denial(
      async () =>
        await port.indexedPage(TABLE, BY_CODE, equality, {
          limit: 1,
          cursor: null,
        }),
    );
    expect(error.code).toBe("INVALID_INDEX_RESULT");
  });

  it("carries only the three documented page fields back", async () => {
    const { ctx } = stubMutationContext({
      take: () => [{ orgId: "org-1" }, { orgId: "org-1" }],
      paginate: () => ({
        page: [{ orgId: "org-1" }],
        isDone: false,
        continueCursor: "next",
        splitCursor: "split",
        pageStatus: "SplitRecommended",
      }),
    });
    const port = createMutationTenantStorage(ctx, REQUEST_ID);

    const answer = await port.indexedPage(TABLE, BY_CODE, equality, {
      limit: 1,
      cursor: null,
    });

    expect(Object.keys(answer as object).sort()).toEqual([
      "continueCursor",
      "isDone",
      "page",
    ]);
    expect(Object.isFrozen(answer)).toBe(true);
  });

  it("rejects an insert whose ID Convex would not recognize", async () => {
    const { ctx } = stubMutationContext({});

    const db = (ctx as unknown as { db: { insert: () => Promise<unknown> } })
      .db;
    db.insert = async (): Promise<unknown> => "";

    const port = createMutationTenantStorage(ctx, REQUEST_ID);
    const error = await denial(
      async () => await port.insert(TABLE, { orgId: "org-1", code: "F" }),
    );

    expect(error.code).toBe("INVALID_WRITE");
  });
});

describe("a query context", () => {
  it("reads by ID and by index", async () => {
    const world = await createConvexTenantWorld();

    const read = await world.t.query(async (ctx) => {
      const access = createTenantDocumentAccess(
        { orgId: world.orgA, requestId: REQUEST_ID },
        createQueryTenantStorage(ctx, REQUEST_ID),
      );
      return {
        byId: await access.getX<WarehouseLike>(TABLE, world.warehouses.alphaA),
        byIndex: await access
          .byIndex<WarehouseLike>(TABLE, BY_CODE)
          .take(TENANT_INDEX_MAX_PAGE_SIZE),
      };
    });

    expect(read.byId.code).toBe("ALPHA");
    expect(read.byIndex.map((row) => row.code)).toEqual([
      "ALPHA",
      "BRAVO",
      "CHARLIE",
      "DELTA",
    ]);
  });

  it("refuses every write and changes nothing", async () => {
    const world = await createConvexTenantWorld();
    const before = await storedWarehouses(world);

    await world.t.query(async (ctx) => {
      const port: TenantStoragePort = createQueryTenantStorage(ctx, REQUEST_ID);

      const attempts: (() => Promise<unknown>)[] = [
        async () => await port.insert(TABLE, { orgId: world.orgA, code: "F" }),
        async () =>
          await port.patch(TABLE, world.warehouses.alphaA, { code: "F" }),
        async () =>
          await port.replace(TABLE, world.warehouses.alphaA, {
            orgId: world.orgA,
            code: "F",
          }),
        async () => await port.delete(TABLE, world.warehouses.alphaA),
      ];

      for (const attempt of attempts) {
        const error = await denial(attempt);
        expect(error.code).toBe("INVALID_WRITE");
        expect(error.requestId).toBe(REQUEST_ID);
      }

      const db = ctx.db as unknown as Record<string, unknown>;
      for (const method of ["insert", "patch", "replace", "delete"]) {
        expect(typeof db[method]).not.toBe("function");
      }
    });

    expect(await storedWarehouses(world)).toEqual(before);
  });

  it("cannot be used to build a write-capable port", async () => {
    const world = await createConvexTenantWorld();

    await world.t.query(async (ctx) => {
      // @ts-expect-error a query context's database is a reader, so it is not
      // assignable to TenantMutationContext. This is the fail-closed guarantee:
      // `pnpm typecheck` fails if this call ever becomes legal.
      createMutationTenantStorage(ctx, REQUEST_ID);
    });

    expect(true).toBe(true);
  });
});
