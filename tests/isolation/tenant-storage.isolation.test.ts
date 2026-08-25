import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  TENANT_DB_ERROR_MESSAGE,
  TENANT_INDEX_MAX_PAGE_SIZE,
  TenantDbError,
  createTenantDocumentAccess,
  type TenantDocumentAccess,
  type TenantOrgId,
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
} from "../fixtures/convex-tenant-world";

const TABLE: TenantTableName = "warehouses";
const BY_CODE = "by_orgId_code";
const BY_STATUS_CODE = "by_orgId_status_code";

interface WarehouseLike extends TenantOwnedDocument {
  readonly _id: GenericId<"warehouses">;
  readonly code: string;
  readonly status: "ACTIVE" | "INACTIVE";
}

function accessFor(
  ctx: TenantMutationContext,
  orgId: TenantOrgId,
): TenantDocumentAccess {
  return createTenantDocumentAccess(
    { orgId, requestId: REQUEST_ID },
    createMutationTenantStorage(ctx, REQUEST_ID),
  );
}

async function denial(call: () => Promise<unknown>): Promise<TenantDbError> {
  try {
    await call();
  } catch (error) {
    if (!(error instanceof TenantDbError)) {
      throw new Error(
        `Expected a TenantDbError, received ${String(error)}. A cross-tenant ` +
          "attempt must not surface a Convex message.",
      );
    }
    return error;
  }
  throw new Error("Expected the call to reject, but it resolved.");
}

describe("another tenant's document ID", () => {
  it("is refused, and is refused identically to an ID that never existed", async () => {
    const world = await createConvexTenantWorld();

    const payloads = await world.t.run(async (ctx) => {
      const access = accessFor(ctx, world.orgA);

      const foreign = await denial(
        async () => await access.getX(TABLE, world.warehouses.alphaB),
      );
      const vanished = await denial(
        async () => await access.getX(TABLE, world.vanishedWarehouse),
      );
      const malformed = await denial(
        async () => await access.getX(TABLE, "not-an-id"),
      );

      return [foreign, vanished, malformed].map((error) => ({
        code: error.code,
        message: error.message,
        keys: Object.keys(error.toPublic()).sort(),
        public: error.toPublic(),
      }));
    });

    expect(payloads[0]).toEqual(payloads[1]);
    expect(payloads[1]).toEqual(payloads[2]);
    expect(payloads[0]?.code).toBe("NOT_FOUND");
    expect(payloads[0]?.message).toBe(TENANT_DB_ERROR_MESSAGE);
    expect(payloads[0]?.keys).toEqual(["code", "requestId"]);
    expect(JSON.stringify(payloads[0]?.public)).not.toContain(world.orgB);
  });

  it("answers null through the non-throwing read as well", async () => {
    const world = await createConvexTenantWorld();

    const answers = await world.t.run(async (ctx) => {
      const access = accessFor(ctx, world.orgA);
      return [
        await access.get(TABLE, world.warehouses.alphaB),
        await access.get(TABLE, world.vanishedWarehouse),
      ];
    });

    expect(answers).toEqual([null, null]);
  });

  it("is readable by the tenant that owns it, so the refusal was tenancy", async () => {
    const world = await createConvexTenantWorld();

    const document = await world.t.run(async (ctx) => {
      const access = accessFor(ctx, world.orgB);
      return await access.getX<WarehouseLike>(TABLE, world.warehouses.alphaB);
    });

    expect(document.code).toBe("ALPHA");
    expect(document.orgId).toBe(world.orgB);
  });
});

describe("a write aimed at another tenant's document", () => {
  it("is refused as NOT_FOUND and leaves every row byte-identical", async () => {
    const world = await createConvexTenantWorld();
    const before = await storedWarehouses(world);
    const targetBefore = await storedWarehouse(world, world.warehouses.alphaB);

    const codes = await world.t.run(async (ctx) => {
      const access = accessFor(ctx, world.orgA);
      const target = world.warehouses.alphaB;

      return [
        (
          await denial(
            async () => await access.patch(TABLE, target, { code: "STOLEN" }),
          )
        ).code,
        (
          await denial(
            async () =>
              await access.replace(TABLE, target, {
                code: "STOLEN",
                name: "Stolen",
                status: "ACTIVE",
              }),
          )
        ).code,
        (await denial(async () => await access.delete(TABLE, target))).code,
      ];
    });

    expect(codes).toEqual(["NOT_FOUND", "NOT_FOUND", "NOT_FOUND"]);
    expect(await storedWarehouse(world, world.warehouses.alphaB)).toEqual(
      targetBefore,
    );
    expect(await storedWarehouses(world)).toEqual(before);
  });

  it("cannot smuggle another tenant into an insert", async () => {
    const world = await createConvexTenantWorld();
    const before = await storedWarehouses(world);

    await world.t.run(async (ctx) => {
      const access = accessFor(ctx, world.orgA);
      const port = createMutationTenantStorage(ctx, REQUEST_ID);

      expect(
        (
          await denial(
            async () =>
              await access.insert(TABLE, {
                orgId: world.orgB,
                code: "SMUGGLED",
              } as unknown as Record<string, unknown>),
          )
        ).code,
      ).toBe("INVALID_WRITE");

      expect(
        (
          await denial(
            async () => await port.insert(TABLE, { code: "SMUGGLED" }),
          )
        ).code,
      ).toBe("INVALID_WRITE");
    });

    expect(await storedWarehouses(world)).toEqual(before);
  });

  it("writes nothing when a read-only context is asked to write", async () => {
    const world = await createConvexTenantWorld();
    const before = await storedWarehouses(world);

    await world.t.query(async (ctx) => {
      const port: TenantStoragePort = createQueryTenantStorage(ctx, REQUEST_ID);
      const access = createTenantDocumentAccess(
        { orgId: world.orgA, requestId: REQUEST_ID },
        port,
      );

      expect(
        (
          await denial(
            async () =>
              await access.patch(TABLE, world.warehouses.alphaA, {
                code: "NOPE",
              }),
          )
        ).code,
      ).toBe("INVALID_WRITE");
      expect(
        (
          await denial(
            async () => await access.delete(TABLE, world.warehouses.alphaA),
          )
        ).code,
      ).toBe("INVALID_WRITE");
    });

    expect(await storedWarehouses(world)).toEqual(before);
  });
});

describe("an indexed read over two tenants", () => {
  it("enumerates only the scope's rows, on a key both tenants share", async () => {
    const world = await createConvexTenantWorld();

    const rows = await world.t.run(async (ctx) => {
      const forA = accessFor(ctx, world.orgA);
      const forB = accessFor(ctx, world.orgB);
      return {
        a: await forA
          .byIndex<WarehouseLike>(TABLE, BY_CODE)
          .take(TENANT_INDEX_MAX_PAGE_SIZE),
        b: await forB
          .byIndex<WarehouseLike>(TABLE, BY_CODE)
          .take(TENANT_INDEX_MAX_PAGE_SIZE),
      };
    });

    expect(rows.a.map((row) => row._id)).toEqual([
      world.warehouses.alphaA,
      world.warehouses.bravoA,
      world.warehouses.charlieA,
      world.warehouses.deltaA,
    ]);
    expect(rows.b.map((row) => row._id)).toEqual([world.warehouses.alphaB]);
    for (const row of rows.a) expect(row.orgId).toBe(world.orgA);
    for (const row of rows.b) expect(row.orgId).toBe(world.orgB);
  });

  it("finds one row, not two, for a code both tenants use", async () => {
    const world = await createConvexTenantWorld();

    const found = await world.t.run(async (ctx) => {
      const equality = [{ field: "code", value: "ALPHA" }];
      return {
        a: await accessFor(ctx, world.orgA)
          .byIndex<WarehouseLike>(TABLE, BY_CODE, equality)
          .unique(),
        b: await accessFor(ctx, world.orgB)
          .byIndex<WarehouseLike>(TABLE, BY_CODE, equality)
          .unique(),
      };
    });

    expect(found.a?._id).toBe(world.warehouses.alphaA);
    expect(found.b?._id).toBe(world.warehouses.alphaB);
  });

  it("never carries a foreign row into a page", async () => {
    const world = await createConvexTenantWorld();

    const first = await world.t.run(
      async (ctx) =>
        await accessFor(ctx, world.orgA)
          .byIndex<WarehouseLike>(TABLE, BY_CODE)
          .page({ limit: 2 }),
    );

    const second = await world.t.run(
      async (ctx) =>
        await accessFor(ctx, world.orgA)
          .byIndex<WarehouseLike>(TABLE, BY_CODE)
          .page({ limit: 2, cursor: first.continueCursor }),
    );

    const ids = [...first.page, ...second.page].map((row) => row._id);
    expect(ids).toEqual([
      world.warehouses.alphaA,
      world.warehouses.bravoA,
      world.warehouses.charlieA,
      world.warehouses.deltaA,
    ]);
    expect(ids).not.toContain(world.warehouses.alphaB);
    expect(second.isDone).toBe(true);
  });

  it("restricts a partial prefix to the scope as well", async () => {
    const world = await createConvexTenantWorld();

    const active = await world.t.run(
      async (ctx) =>
        await accessFor(ctx, world.orgB)
          .byIndex<WarehouseLike>(TABLE, BY_STATUS_CODE, [
            { field: "status", value: "ACTIVE" },
          ])
          .take(TENANT_INDEX_MAX_PAGE_SIZE),
    );

    expect(active.map((row) => row._id)).toEqual([world.warehouses.alphaB]);
  });

  it("sends the scope's tenant as the first equality term, always", async () => {
    const world = await createConvexTenantWorld();

    const sent: { field: string; value: unknown }[] = [];
    const spy = (port: TenantStoragePort): TenantStoragePort => ({
      ...port,
      indexedPage: async (table, index, equality, page) => {
        sent.push(...equality.map((term) => ({ ...term })));
        return await port.indexedPage(table, index, equality, page);
      },
    });

    await world.t.run(async (ctx) => {
      for (const orgId of [world.orgA, world.orgB]) {
        await createTenantDocumentAccess(
          { orgId, requestId: REQUEST_ID },
          spy(createMutationTenantStorage(ctx, REQUEST_ID)),
        )
          .byIndex(TABLE, BY_STATUS_CODE, [
            { field: "status", value: "ACTIVE" },
          ])
          .take(1);
      }
    });

    expect(sent).toEqual([
      { field: "orgId", value: world.orgA },
      { field: "status", value: "ACTIVE" },
      { field: "orgId", value: world.orgB },
      { field: "status", value: "ACTIVE" },
    ]);
  });

  it("passes a foreign row through to be refused, never dropped", async () => {
    const world = await createConvexTenantWorld();

    const foreignRow = await storedWarehouse(world, world.warehouses.alphaB);

    const error = await world.t.run(async (ctx) => {
      const port = createMutationTenantStorage(ctx, REQUEST_ID);
      const lying: TenantStoragePort = {
        ...port,
        indexedPage: async () =>
          Object.freeze({
            page: [foreignRow],
            isDone: true,
            continueCursor: "",
          }),
      };
      const access = createTenantDocumentAccess(
        { orgId: world.orgA, requestId: REQUEST_ID },
        lying,
      );
      const raised = await denial(
        async () => await access.byIndex(TABLE, BY_CODE).take(1),
      );
      return { code: raised.code, message: raised.message };
    });

    expect(error.code).toBe("INVALID_INDEX_RESULT");
    expect(error.message).toBe(TENANT_DB_ERROR_MESSAGE);
  });
});

describe("a table this boundary cannot scope", () => {
  it("is refused for reads, writes, and indexed reads alike", async () => {
    const world = await createConvexTenantWorld();
    const before = await storedWarehouses(world);

    await world.t.run(async (ctx) => {
      const port = createMutationTenantStorage(ctx, REQUEST_ID);

      for (const table of [
        "organizations",
        "users",
        "permissions",
        "invoices",
      ] as unknown as TenantTableName[]) {
        expect(
          (await denial(async () => await port.get(table, world.userA))).code,
        ).toBe("INVALID_TENANT_TABLE");
        expect(
          (
            await denial(
              async () => await port.insert(table, { orgId: world.orgA }),
            )
          ).code,
        ).toBe("INVALID_TENANT_TABLE");
        expect(
          (
            await denial(
              async () =>
                await port.indexedPage(
                  table,
                  BY_CODE,
                  [{ field: "orgId", value: world.orgA }],
                  { limit: 1, cursor: null },
                ),
            )
          ).code,
        ).toBe("INVALID_TENANT_TABLE");
      }
    });

    expect(await storedWarehouses(world)).toEqual(before);
  });
});
