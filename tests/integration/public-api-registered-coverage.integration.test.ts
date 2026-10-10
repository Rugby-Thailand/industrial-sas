import { ConvexError, type Value } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import {
  PUBLIC_API_ACTOR,
  PUBLIC_API_EXAMPLES,
  PUBLIC_API_FOREIGN_ACTOR,
  allowedValue,
  createPublicApiWorld,
  invokePublicExample,
} from "../fixtures/public-api-examples";
import { snapshotOf } from "../fixtures/public-contract";

// Vite requires literal glob expressions; use the same shipping module scope
// for registered invocation and the independent public-export inventory.
const MODULES = Object.fromEntries(
  Object.entries(
    import.meta.glob([
      "../../convex/**/*.ts",
      "!../../convex/_generated/**",
      "!../../convex/model/**",
      "!../../convex/**/*.test.ts",
      "!../../convex/schema.ts",
      "!../../convex/auth.config.ts",
    ]),
  ).map(([path, load]) => [path.replace("../../convex/", "../convex/"), load]),
);
const loaded = import.meta.glob(
  [
    "../../convex/**/*.ts",
    "!../../convex/_generated/**",
    "!../../convex/model/**",
    "!../../convex/**/*.test.ts",
    "!../../convex/schema.ts",
    "!../../convex/auth.config.ts",
  ],
  { eager: true },
) as Record<string, Record<string, unknown>>;
const current = snapshotOf(
  Object.fromEntries(
    Object.entries(loaded).map(([path, module]) => [
      path.replace("../../convex/", "").replace(/\.ts$/, ""),
      module,
    ]),
  ),
);
const transport = vi.fn<typeof fetch>();

beforeEach(() => {
  transport.mockReset().mockImplementation(async () => {
    throw new Error("Unexpected provider transport in a boundary test.");
  });
  vi.stubGlobal("fetch", transport);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function contextDenied(operation: Promise<unknown>, code: string) {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError);
    const data = (error as ConvexError<Value>).data;
    expect(data).toMatchObject({ kind: "TENANT_CONTEXT_DENIED", code });
    expect(JSON.stringify(data)).not.toMatch(
      /org_fixture|user_fixture|Tenant [AB]/,
    );
    expect(transport).not.toHaveBeenCalled();
    return;
  }
  throw new Error("Registered boundary unexpectedly allowed a denied caller.");
}

describe("representative registered coverage of every shipping public module", () => {
  it("matches runtime exports, includes every function kind and makes coverage gaps explicit", () => {
    const publicEntries = Object.entries(current).filter(
      ([, entry]) => entry.visibility === "public",
    );
    const publicModules = [
      ...new Set(publicEntries.map(([name]) => name.split(":")[0])),
    ].sort();
    const coveredModules = [
      ...new Set(PUBLIC_API_EXAMPLES.map(({ name }) => name.split(":")[0])),
    ].sort();
    expect(coveredModules).toEqual(publicModules);
    expect(coveredModules).toHaveLength(14);
    expect(new Set(PUBLIC_API_EXAMPLES.map(({ kind }) => kind))).toEqual(
      new Set(["query", "mutation", "action"]),
    );
    expect(PUBLIC_API_EXAMPLES.map(({ name }) => name)).toContain(
      "finishedGoods/jobScans:extractJobTicket",
    );
    for (const example of PUBLIC_API_EXAMPLES) {
      expect(current[example.name]).toMatchObject({
        visibility: "public",
        kind: example.kind,
      });
    }
    expect(
      PUBLIC_API_EXAMPLES.filter((example) => example.domainGuardOnly).map(
        ({ name }) => name,
      ),
    ).toEqual([
      "storageLayouts/fg1Import:preflight",
      "storageLayouts/pdImport:preflight",
    ]);
    // The inventory covers 15 representative functions, not every public export
    // or every successful payload hidden behind nested v.any() validators.
    expect(PUBLIC_API_EXAMPLES).toHaveLength(15);
    expect(publicEntries.length).toBeGreaterThan(PUBLIC_API_EXAMPLES.length);
  });

  for (const example of PUBLIC_API_EXAMPLES) {
    describe(example.name, () => {
      it("denies an anonymous registered call with valid arguments", async () => {
        const world = await createPublicApiWorld(MODULES);
        await contextDenied(invokePublicExample(world, example), "ANONYMOUS");
      });
      it("rejects an identity that is absent from the verified mirror", async () => {
        const world = await createPublicApiWorld(MODULES);
        await contextDenied(
          invokePublicExample(world, example, {
            subject: "unknown_public_fixture",
            org_id: "org_fixture_a",
          }),
          "USER_UNKNOWN",
        );
      });
      it("rejects a session without an active organization claim", async () => {
        const world = await createPublicApiWorld(MODULES);
        await contextDenied(
          invokePublicExample(world, example, {
            subject: "user_fixture_a",
          }),
          "ACTIVE_ORGANIZATION_MISSING",
        );
      });
      it("runs Convex's argument validators instead of calling a handler directly", async () => {
        const world = await createPublicApiWorld(MODULES);
        const invalid =
          example.name === "workspace/current:readCurrent"
            ? { orgId: world.orgB }
            : { ...example.args(world), warehouseId: 42 };
        await expect(
          invokePublicExample(world, example, PUBLIC_API_ACTOR, invalid),
        ).rejects.toThrow(/Validator error|extra field/i);
        expect(transport).not.toHaveBeenCalled();
      });
      if (example.name !== "workspace/current:readCurrent") {
        it("denies another tenant's warehouse without leaking its owner", async () => {
          const world = await createPublicApiWorld(MODULES);
          await contextDenied(
            invokePublicExample(world, example, PUBLIC_API_FOREIGN_ACTOR),
            "WAREHOUSE_UNKNOWN",
          );
        });
        it("denies an ungranted warehouse inside the actor's own tenant", async () => {
          const world = await createPublicApiWorld(MODULES);
          await contextDenied(
            invokePublicExample(world, example, PUBLIC_API_ACTOR, {
              ...example.args(world),
              warehouseId: world.warehouses.bravoA,
            }),
            "WAREHOUSE_OUT_OF_SCOPE",
          );
        });
      }
    });
  }
});

describe("representative previous-client success payloads through registered APIs", () => {
  it("keeps batch, product, pallet and storage detail fields used by existing clients", async () => {
    const world = await createPublicApiWorld(MODULES);
    const expected: Readonly<Record<string, object>> = {
      "finishedGoods/batches:getBatch": {
        batch: { _id: world.batchId, status: "DRAFT", revision: 1 },
        product: { _id: world.productId, sku: "PUBLIC-1" },
        units: [],
        history: expect.any(Array),
        editable: true,
      },
      "finishedGoods/batchManagement:get": {
        batch: { _id: world.batchId, status: "DRAFT", revision: 1 },
        product: { _id: world.productId, sku: "PUBLIC-1" },
        units: [],
      },
      "finishedGoods/catalogue:findSku": {
        _id: world.productId,
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        sku: "PUBLIC-1",
        name: "Public contract product",
        unit: "PCS",
        status: "ACTIVE",
      },
      "finishedGoods/jobScans:listJobScans": {
        items: [],
        continueCursor: expect.any(String),
        isDone: true,
      },
      "finishedGoods/scanning:resolvePackageCode": {
        ok: true,
        unit: {
          id: world.palletId,
          productId: world.productId,
          productName: "Public contract product",
          code: expect.any(String),
          storageFormat: "PALLET",
          status: "AWAITING_MEASUREMENT",
          version: expect.any(Number),
        },
      },
      "finishedGoods/summaryMaintenance:prepare": {
        ready: true,
        isDone: true,
        scanned: 1,
      },
      "finishedGoods/workflow:list": {
        products: [{ _id: world.productId, sku: "PUBLIC-1" }],
        pallets: [
          {
            _id: world.palletId,
            productName: "Public contract product",
            sku: "PUBLIC-1",
          },
        ],
      },
      "storageLayouts/catalogue:getStorageBuilding": {
        found: true,
        building: {
          buildingId: world.buildingId,
          code: "PUBLIC-B",
          floorCount: 1,
        },
        floors: [{ floorNumber: 1, storageZones: [], reservedBlocks: [] }],
      },
      "storageLayouts/locationCatalogue:list": [],
      "storageLayouts/writes:createStorageBuilding": {
        written: true,
        documentId: expect.any(String),
      },
      "storageLayouts/zones:resolveStorageAddress": { found: false },
      "workspace/current:readCurrent": {
        organization: { id: world.orgA, name: "Tenant A" },
        warehouses: [
          {
            id: world.warehouses.alphaA,
            code: "ALPHA",
            name: "Warehouse ALPHA",
          },
        ],
        navigationPermissions: expect.any(Array),
        complete: true,
      },
    };
    const checked: string[] = [];
    expect(Object.keys(expected).sort()).toEqual(
      PUBLIC_API_EXAMPLES.filter(
        (example) => example.kind !== "action" && !example.domainGuardOnly,
      )
        .map(({ name }) => name)
        .sort(),
    );
    for (const example of PUBLIC_API_EXAMPLES) {
      const expectedResult = expected[example.name];
      if (expectedResult === undefined) continue;
      const outcome = await invokePublicExample(
        world,
        example,
        PUBLIC_API_ACTOR,
      );
      expect(outcome).toMatchObject({
        ok: true,
        requestId: expect.any(String),
      });
      expect(allowedValue(outcome)).toMatchObject(expectedResult);
      checked.push(example.name);
    }
    expect(checked.sort()).toEqual(Object.keys(expected).sort());
    expect(transport).not.toHaveBeenCalled();
  });

  it("keeps the other tenant's workspace result isolated", async () => {
    const world = await createPublicApiWorld(MODULES);
    const example = PUBLIC_API_EXAMPLES.find(
      ({ name }) => name === "workspace/current:readCurrent",
    )!;
    const value = allowedValue(
      await invokePublicExample(world, example, PUBLIC_API_FOREIGN_ACTOR),
    );
    expect(value).toMatchObject({
      organization: { id: world.orgB },
      warehouses: [{ id: world.warehouses.alphaB }],
    });
    expect(JSON.stringify(value)).not.toContain(world.orgA);
    expect(JSON.stringify(value)).not.toContain(world.warehouses.alphaA);
  });

  it.each(PUBLIC_API_EXAMPLES.filter((example) => example.domainGuardOnly))(
    "fails safely at the real domain guard for $name without inventing an import rehearsal",
    async (example) => {
      const world = await createPublicApiWorld(MODULES);
      try {
        await invokePublicExample(world, example, PUBLIC_API_ACTOR);
      } catch (error) {
        expect(error).toBeInstanceOf(ConvexError);
        expect((error as ConvexError<Value>).data).toMatchObject({
          code: "INTERNAL_ERROR",
          requestId: expect.any(String),
        });
        expect(String(error)).not.toMatch(/WRONG_ORGANIZATION|Tenant A/);
        expect(transport).not.toHaveBeenCalled();
        return;
      }
      throw new Error(
        "Import unexpectedly accepted an ordinary planner fixture.",
      );
    },
  );
});

describe("shipping registered job-ticket action", () => {
  it("calls only mocked provider transport and preserves the real extraction result contract", async () => {
    const world = await createPublicApiWorld(MODULES);
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-provider-test-key");
    vi.stubEnv("JOB_SCAN_DEMO_AI", "0");
    const extraction = {
      factory_order: "FO-PUBLIC-100",
      product_barcode_text: "PUBLIC-SKU",
      part_name: "Synthetic part",
      quantity: "50",
    };
    transport.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(extraction),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await world.t
      .withIdentity(PUBLIC_API_ACTOR)
      .action(api.finishedGoods.jobScans.extractJobTicket, {
        warehouseId: world.warehouses.alphaA,
        imageUrl: "https://example.test/synthetic-ticket.png",
      });
    expect(result).toMatchObject({
      ok: true,
      requestId: expect.any(String),
      value: {
        ok: true,
        mock: false,
        fields: {
          factoryOrder: "FO-PUBLIC-100",
          productBarcodeText: "PUBLIC-SKU",
          partName: "Synthetic part",
          quantity: 50,
        },
        raw: JSON.stringify(extraction),
      },
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer synthetic-provider-test-key",
        }),
      }),
    );
  });

  it("denies the real read-only role before provider transport", async () => {
    const world = await createPublicApiWorld(MODULES, "SUPERVISOR");
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-provider-test-key");
    const result = await world.t
      .withIdentity(PUBLIC_API_ACTOR)
      .action(api.finishedGoods.jobScans.extractJobTicket, {
        warehouseId: world.warehouses.alphaA,
        imageUrl: "https://example.test/synthetic-ticket.png",
      });
    expect(result).toMatchObject({
      ok: false,
      denial: { code: "AUTHORIZATION_DENIED" },
    });
    expect(transport).not.toHaveBeenCalled();
  });
});

// convex-test's withIdentity supplies already-authenticated claims. These tests
// prove claim/mirror/tenant rejection, not JWT cryptographic verification. A real
// issuer, signed convex token and expired/invalid JWT require trusted staging.
