/**
 * Isolation tier — the Convex storage adapter across two tenants
 * (`convex/lib/tenantStorage.ts`, T05b2a; `RG-013`, `RG-031`).
 *
 * The integration tier proves what the adapter refuses and how it translates. This
 * tier proves the property the merge gate exists for: with a real Convex database
 * underneath, one tenant's accessor cannot read, change, delete, enumerate, or
 * detect another tenant's document — and cannot learn, from a code, a message, or
 * the shape of a payload, whether the ID it was refused exists at all
 * (`INV-0002-03`, `INV-0002-07`).
 *
 * The world is deliberately adversarial in the one way that matters: both tenants
 * own a warehouse whose `code` is `ALPHA`. `code` is unique *per organization* by
 * contract, so a read that forgot its tenant would still find a plausible row, and
 * a uniqueness check that forgot its tenant would find two. That is exactly the
 * failure a hand-written fake cannot make visible, because a fake's "index" is
 * whatever its author wrote.
 *
 * Storage is `convex-test`: the real Convex database implementation, real schema
 * validators, real index semantics, offline, no deployment. See
 * `tests/fixtures/convex-tenant-world.ts`.
 *
 * `G-102` remains open: there is still no auth wrapper and no exported Convex
 * function, so nothing here proves that a *request* is confined to a tenant — only
 * that the storage boundary is, given a scope.
 */
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

/** An accessor bound to one tenant over a mutation context. */
function accessFor(
  ctx: TenantMutationContext,
  orgId: TenantOrgId,
): TenantDocumentAccess {
  return createTenantDocumentAccess(
    { orgId, requestId: REQUEST_ID },
    createMutationTenantStorage(ctx, REQUEST_ID),
  );
}

/** The failure a caller can observe, reduced to what is comparable. */
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

/* -------------------------------------------------------------------------- */
/* Reads by ID                                                                 */
/* -------------------------------------------------------------------------- */

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

    // Same code, same message, same fields, same property order. Any difference
    // between the three is an existence oracle over another tenant's IDs.
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
      // The same ID, the same transaction, a different scope. If this returned
      // nothing, the test above would prove nothing about isolation.
      const access = accessFor(ctx, world.orgB);
      return await access.getX<WarehouseLike>(TABLE, world.warehouses.alphaB);
    });

    expect(document.code).toBe("ALPHA");
    expect(document.orgId).toBe(world.orgB);
  });
});

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

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

      // Through the accessor: naming `orgId` at all is a rejected write, never an
      // overwritten field (`INV-0001-02`).
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

      // Straight at the port, which is where a future wrapper could reach: the
      // adapter still refuses a payload whose tenant is not an organization ID,
      // and does not invent one when it is absent.
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

      // A's own document, so the refusal is the context's read-only nature and
      // not ownership.
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

/* -------------------------------------------------------------------------- */
/* Indexed reads                                                               */
/* -------------------------------------------------------------------------- */

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

    // The read every "unique by contract" check owes. Two rows share the code and
    // differ only by tenant, so a `unique()` that dropped the `orgId` equality
    // would raise INVALID_INDEX_RESULT instead of answering.
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
    // One page per execution: a continuable page spends Convex's single paginate.
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

    // A owns three ACTIVE warehouses; B owns one. A prefix of
    // `["orgId", "status"]` that lost its first term would answer with four.
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

    // A page carrying another tenant's row cannot be produced by Convex here — the
    // query carries an `orgId` equality — so it is injected. What must not happen
    // is the adapter quietly filtering it: a shorter page would make a broken
    // index, or an adapter that ignored the prefix, look like an ordinary result.
    const foreignRow = await storedWarehouse(world, world.warehouses.alphaB);

    // The error is reduced to plain fields before it crosses back: `t.run`
    // serializes its result the way a Convex function does, and an `Error` is not a
    // Convex value.
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

/* -------------------------------------------------------------------------- */
/* Global tables                                                               */
/* -------------------------------------------------------------------------- */

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
