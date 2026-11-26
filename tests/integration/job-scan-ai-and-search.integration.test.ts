import type { GenericMutationCtx } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { DataModel } from "../../convex/schema";
import * as backfill from "../../convex/finishedGoods/searchIndexBackfill";
import {
  JOB_SCAN_AI_PROVIDER_POLICY,
  JOB_SCAN_EDIT_AI_RATE_LIMIT,
  JOB_SCAN_SEARCH_AI_RATE_LIMIT,
} from "../../convex/finishedGoods/jobScans";
import {
  MAX_JOB_SCAN_AI_PROMPT_LENGTH,
  jobScanEditRequestBody,
  jobScanSearchRequestBody,
  type JobScanSearchField,
} from "../../convex/model/finishedGoods/jobScans";
import { OPENROUTER_CHAT_URL } from "../../convex/lib/searchProvider";
import { RECONCILE_MARGIN_MS } from "../../convex/lib/searchReadiness";
import {
  PUBLIC_API_ACTOR,
  PUBLIC_API_FOREIGN_ACTOR,
  createPublicApiWorld,
} from "../fixtures/public-api-examples";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

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

const IDENTITY = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const KEY_SENTINEL = "synthetic-job-scan-ai-key";
const PROMPT_SENTINEL = "SENTINEL-PROMPT-SECRET";
const RECORD_SENTINEL = "SENTINEL-PRIVATE-CUSTOMER-XYZ";

type Runtime = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};

const searchPayload = (overrides: Record<string, unknown> = {}) => ({
  supported: true,
  filter: "ALL",
  search: "",
  building: null,
  floor: null,
  storageFormat: null,
  ...overrides,
});

const editPayload = (overrides: Record<string, unknown> = {}) => ({
  supported: true,
  locationCode: null,
  factoryOrder: null,
  productBarcodeText: null,
  partName: null,
  customer: null,
  deliveryDate: null,
  manufacturingDate: null,
  quantity: null,
  factoryQuantity: null,
  customerQuantity: null,
  storageFormat: null,
  ...overrides,
});

function openRouterOk(
  content: string,
  extra: {
    finishReason?: string;
    usage?: Record<string, unknown>;
    id?: string;
  } = {},
) {
  return new Response(
    JSON.stringify({
      id: extra.id ?? "gen-job-scan-ai-1",
      model: "openai/gpt-6-luna",
      usage: extra.usage ?? {
        prompt_tokens: 120,
        completion_tokens: 40,
        total_tokens: 160,
        cost: 0.00012,
      },
      choices: [
        {
          finish_reason: extra.finishReason ?? "stop",
          message: { content },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("job-scan AI search and edit actions", () => {
  const transport = vi.fn<typeof fetch>();

  beforeEach(() => {
    transport.mockReset().mockImplementation(async () => {
      throw new Error("Unexpected provider call.");
    });
    vi.stubGlobal("fetch", transport);
    vi.stubEnv("OPENROUTER_API_KEY", KEY_SENTINEL);
    vi.stubEnv("OPENROUTER_SEARCH_MODEL", "openai/gpt-6-luna");
    vi.stubEnv("OPENROUTER_MODEL", "fallback/model");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    [
      "Change part name to Gear only if the quantity is 40",
      "Gear only if the quantity is 40",
    ],
    [
      "Set part name to Widget once this record is mapped",
      "Widget once this record is mapped",
    ],
    [
      "แก้ชื่อสินค้าเป็น กล่อง Outer 131 เฉพาะงานพาเลท",
      "กล่อง Outer 131 เฉพาะงานพาเลท",
    ],
    ["Set part name to Widget for all records", "Widget for all records"],
    [
      "Set part name to Widget and clear the barcode",
      "Widget and clear the barcode",
    ],
    [
      "Set part name to Widget and delete this scan",
      "Widget and delete this scan",
    ],
    ["แก้ชื่อสินค้าเป็น กล่อง แล้วส่งออกใบงานนี้", "กล่อง แล้วส่งออกใบงานนี้"],
    ["Set part name to Widget. Delete this scan", "Widget. Delete this scan"],
    ["Set part name to Widget & delete this scan", "Widget & delete this scan"],
    [
      "แก้ชื่อสินค้าเป็น กล่อง กรุณาส่งออกใบงานนี้",
      "กล่อง กรุณาส่งออกใบงานนี้",
    ],
    ["Change product name from Old to New", "from Old to New"],
    [
      "Set part name to Widget and create another scan",
      "Widget and create another scan",
    ],
    ["แก้ชื่อสินค้าเป็น กล่อง แล้วสร้างใบงานใหม่", "กล่อง แล้วสร้างใบงานใหม่"],
    [
      "Change product name to Blue Box and also create a new job",
      "Blue Box and also create a new job",
    ],
    [
      "Change product name to Blue Box as well as delete this record",
      "Blue Box as well as delete this record",
    ],
    [
      "Change product name to Blue Box plus delete this record",
      "Blue Box plus delete this record",
    ],
    [
      "Change product name to Outer 131 – delete this record",
      "Outer 131 – delete this record",
    ],
    [
      "Change product name to Outer 131 – also delete this record",
      "Outer 131 – also delete this record",
    ],
    [
      "Change product name to Outer 131—also delete this record",
      "Outer 131—also delete this record",
    ],
    [
      "Change product name to Outer 131 and make a copy of this record",
      "Outer 131 and make a copy of this record",
    ],
    [
      "Change product name to Blue Box and mark it as deleted",
      "Blue Box and mark it as deleted",
    ],
    [
      "Change product name to Blue Box and mark deleted",
      "Blue Box and mark deleted",
    ],
    [
      "Change product name to Blue Box and close the record",
      "Blue Box and close the record",
    ],
    [
      "Change product name to Blue Box and finish the selected ticket",
      "Blue Box and finish the selected ticket",
    ],
    [
      "Change product name to Blue Box and set the status to deleted",
      "Blue Box and set the status to deleted",
    ],
    [
      "Change product name to Blue Box and status: deleted",
      "Blue Box and status: deleted",
    ],
    [
      "Change product name to Blue Box and status to deleted",
      "Blue Box and status to deleted",
    ],
    [
      "Change product name to Blue Box and update its owner: Alex",
      "Blue Box and update its owner: Alex",
    ],
    ["แก้ชื่อสินค้าเป็น กล่อง และตั้งสถานะเป็นลบ", "กล่อง และตั้งสถานะเป็นลบ"],
    ["แก้ชื่อสินค้าเป็น กล่อง และสถานะเป็นลบ", "กล่อง และสถานะเป็นลบ"],
    [
      "Change product name to Outer 131 / please also delete this record",
      "Outer 131 / please also delete this record",
    ],
    ["แก้ชื่อสินค้าเป็น กล่อง ｜ ลบใบงานนี้", "กล่อง ｜ ลบใบงานนี้"],
    ["แก้ชื่อสินค้าเป็น กล่อง รวมทั้งลบใบงานนี้", "กล่อง รวมทั้งลบใบงานนี้"],
    [
      "แก้ชื่อสินค้าเป็น กล่อง แล้วก็ช่วยสร้างใบงานใหม่",
      "กล่อง แล้วก็ช่วยสร้างใบงานใหม่",
    ],
  ])(
    "returns manual edit when the model copies an unsupported clause in %s",
    async (prompt, partName) => {
      const world = await createPublicApiWorld(MODULES, "ORG_ADMIN");
      transport.mockResolvedValueOnce(
        openRouterOk(JSON.stringify(editPayload({ partName }))),
      );
      const result = await world.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.proposeJobScanEdit, {
          warehouseId: world.warehouses.alphaA,
          prompt,
        });
      expect(result).toMatchObject({
        ok: true,
        value: {
          ok: false,
          error: { code: "UNSUPPORTED", fallback: "MANUAL_EDIT" },
        },
      });
    },
  );

  it.each([
    "and set its quantity to 10",
    "and make the quantity 10",
    "with quantity 10",
    "along with its quantity: 10",
  ])(
    "keeps a quantity clause separate from the name with %s",
    async (clause) => {
      const world = await createPublicApiWorld(MODULES, "ORG_ADMIN");
      const client = world.t.withIdentity(PUBLIC_API_ACTOR);
      const args = {
        warehouseId: world.warehouses.alphaA,
        prompt: "Change product name to Blue Box " + clause,
      };
      transport
        .mockResolvedValueOnce(
          openRouterOk(
            JSON.stringify(
              editPayload({
                partName: "Blue Box " + clause,
              }),
            ),
          ),
        )
        .mockResolvedValueOnce(
          openRouterOk(
            JSON.stringify(
              editPayload({
                partName: "Blue Box",
                quantity: 10,
              }),
            ),
          ),
        );
      const action = api.finishedGoods.jobScans.proposeJobScanEdit;
      await expect(client.action(action, args)).resolves.toMatchObject({
        ok: true,
        value: { ok: false, error: { code: "AI_UNREADABLE" } },
      });
      await expect(client.action(action, args)).resolves.toMatchObject({
        ok: true,
        value: {
          ok: true,
          value: { fields: { partName: "Blue Box", quantity: 10 } },
        },
      });
    },
  );

  it("accepts a Thai quantity adjacent to its field name", async () => {
    const world = await createPublicApiWorld(MODULES, "ORG_ADMIN");
    transport.mockResolvedValueOnce(
      openRouterOk(JSON.stringify(editPayload({ quantity: 10 }))),
    );
    const result = await world.t
      .withIdentity(PUBLIC_API_ACTOR)
      .action(api.finishedGoods.jobScans.proposeJobScanEdit, {
        warehouseId: world.warehouses.alphaA,
        prompt: "แก้จำนวน๑๐",
      });
    expect(result).toMatchObject({
      ok: true,
      value: { ok: true, value: { fields: { quantity: 10 } } },
    });
  });

  it("keeps a barcode and its floor separate in a scoped search proposal", async () => {
    const world = await createPublicApiWorld(MODULES, "SUPERVISOR");
    const client = world.t.withIdentity(PUBLIC_API_ACTOR);
    const args = {
      warehouseId: world.warehouses.alphaA,
      prompt: "Find barcode ABC-123 from floor 2",
    };
    transport
      .mockResolvedValueOnce(
        openRouterOk(
          JSON.stringify(searchPayload({ search: "ABC-123 from floor 2" })),
        ),
      )
      .mockResolvedValueOnce(
        openRouterOk(
          JSON.stringify(searchPayload({ search: "ABC-123", floor: 2 })),
        ),
      );
    const action = api.finishedGoods.jobScans.interpretJobScanSearch;
    await expect(client.action(action, args)).resolves.toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "AI_UNREADABLE" } },
    });
    await expect(client.action(action, args)).resolves.toMatchObject({
      ok: true,
      value: {
        ok: true,
        value: {
          search: "ABC-123",
          searchField: "productBarcodeText",
          facets: { floor: 2 },
        },
      },
    });
  });

  it.each([
    [
      "Find product name Widget with quantity greater than 20",
      "Widget with quantity greater than 20",
    ],
    ["Find product name Widget, quantity 20", "Widget, quantity 20"],
    [
      "หาชื่อสินค้า Widget, วันที่ส่ง 12/12/2569",
      "Widget, วันที่ส่ง 12/12/2569",
    ],
    [
      "Find product name Widget and customer name Acme",
      "Widget and customer name Acme",
    ],
    ["หาชื่อสินค้า Widget และชื่อลูกค้า Acme", "Widget และชื่อลูกค้า Acme"],
    [
      "Find product name Widget and export the results",
      "Widget and export the results",
    ],
    [
      "Find product name Widget and move the records to A-01",
      "Widget and move the records to A-01",
    ],
    ["หาชื่อสินค้า Widget และย้ายใบงานไป A-01", "Widget และย้ายใบงานไป A-01"],
    ["หาชื่อสินค้า Widget และส่งออกผลลัพธ์", "Widget และส่งออกผลลัพธ์"],
    [
      "Find product name Blue Box and also move this job to A01",
      "Blue Box and also move this job to A01",
    ],
    [
      "Find product name Blue Box as well as delete this record",
      "Blue Box as well as delete this record",
    ],
    [
      "Find product name Blue Box plus delete this record",
      "Blue Box plus delete this record",
    ],
    [
      "Find product name Outer 131 – delete this record",
      "Outer 131 – delete this record",
    ],
    [
      "Find product name Outer 131 – also delete this record",
      "Outer 131 – also delete this record",
    ],
    [
      "Find product name Outer 131—also delete this record",
      "Outer 131—also delete this record",
    ],
    [
      "Find product name Outer 131 and make a copy of this record",
      "Outer 131 and make a copy of this record",
    ],
    [
      "Find product name Blue Box and status: deleted",
      "Blue Box and status: deleted",
    ],
    [
      "Find product name Blue Box and status is deleted",
      "Blue Box and status is deleted",
    ],
    [
      "Find product name Blue Box and priority should be urgent",
      "Blue Box and priority should be urgent",
    ],
    ["หาชื่อสินค้า กล่อง และสถานะเป็นลบ", "กล่อง และสถานะเป็นลบ"],
    ["หาชื่อสินค้า กล่อง ｜ ก็ช่วยลบใบงานนี้", "กล่อง ｜ ก็ช่วยลบใบงานนี้"],
    ["หาชื่อสินค้า กล่อง — ลบใบงานนี้", "กล่อง — ลบใบงานนี้"],
    ["หาชื่อสินค้า กล่อง รวมทั้งลบใบงานนี้", "กล่อง รวมทั้งลบใบงานนี้"],
    [
      "หาชื่อสินค้า กล่อง และก็ช่วยย้ายใบงานไป A01",
      "กล่อง และก็ช่วยย้ายใบงานไป A01",
    ],
  ])(
    "returns manual search when the model absorbs an unsupported filter in %s",
    async (prompt, search) => {
      const world = await createPublicApiWorld(MODULES, "SUPERVISOR");
      transport.mockResolvedValueOnce(
        openRouterOk(JSON.stringify(searchPayload({ search }))),
      );
      const result = await world.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.interpretJobScanSearch, {
          warehouseId: world.warehouses.alphaA,
          prompt,
        });
      expect(result).toMatchObject({
        ok: true,
        value: {
          ok: false,
          error: { code: "UNSUPPORTED", fallback: "MANUAL_SEARCH" },
        },
      });
    },
  );

  it.each([
    ["หาสินค้า Outer 131", "Outer 131", undefined],
    ["หาใบงานที่อยู่ ข้างเสา C12", "ข้างเสา C12", "location"],
    ["หาใบงานที่อยู่ F2-L12-1", "F2-L12-1", "location"],
    ["Find jobs at F2-L12-1", "F2-L12-1", "location"],
  ])(
    "accepts the saved-record search %s",
    async (prompt, search, searchField) => {
      const world = await createPublicApiWorld(MODULES, "SUPERVISOR");
      transport.mockResolvedValueOnce(
        openRouterOk(JSON.stringify(searchPayload({ search }))),
      );
      const result = await world.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.interpretJobScanSearch, {
          warehouseId: world.warehouses.alphaA,
          prompt,
        });
      expect(result).toMatchObject({
        ok: true,
        value: {
          ok: true,
          value: {
            filter: "ALL",
            search,
            ...(searchField ? { searchField } : {}),
          },
        },
      });
    },
  );

  it("applies building name and code aliases returned by the provider to the same saved tickets", async () => {
    const world = await createPublicApiWorld(MODULES, "SUPERVISOR");
    const warehouseId = world.warehouses.alphaA;
    const scanId = await world.t.run(async (ctx) => {
      await ctx.db.patch(world.buildingId, { name: "North Wing" });
      return ctx.db.insert("finishedGoodsJobScans", {
        orgId: world.orgA,
        warehouseId,
        factoryOrder: "FO12345",
        productBarcodeText: "SKU-1",
        source: "MANUAL",
        locationText: "",
        mapped: false,
        buildingId: world.buildingId,
        createdAt: 1000,
        updatedAt: 1000,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
    });
    const client = world.t.withIdentity(PUBLIC_API_ACTOR);
    for (const [prompt, building] of [
      ["Find jobs in Building PUBLIC-B", "Building PUBLIC-B"],
      ["Find jobs in Building PUBLIC-B", "PUBLIC-B"],
      ["หาใบงานในอาคาร PUBLIC-B", "อาคาร PUBLIC-B"],
      ["Find jobs in Building North Wing", "Building North Wing"],
      ["Find jobs in Building North Wing", "North Wing"],
      ["หาใบงานในอาคาร North Wing", "อาคาร North Wing"],
    ] as const) {
      transport.mockResolvedValueOnce(
        openRouterOk(JSON.stringify(searchPayload({ building }))),
      );
      const proposal = await client.action(
        api.finishedGoods.jobScans.interpretJobScanSearch,
        {
          warehouseId,
          prompt,
        },
      );
      if (!proposal.ok || !proposal.value.ok || !proposal.value.value.facets)
        throw new Error("Expected valid building search proposal");
      expect(proposal.value.value.facets.building).toBe(
        building.includes("PUBLIC-B") ? "PUBLIC-B" : "North Wing",
      );
      const results = await client.query(
        api.finishedGoods.jobScans.listJobScans,
        {
          warehouseId,
          filter: proposal.value.value.filter,
          facets: proposal.value.value.facets,
        },
      );
      expect(results).toMatchObject({
        ok: true,
        value: { items: [{ id: scanId }] },
      });
    }
  });

  it("keeps the building separate from a location status in the search proposal", async () => {
    const world = await createPublicApiWorld(MODULES, "SUPERVISOR");
    transport.mockResolvedValueOnce(
      openRouterOk(
        JSON.stringify(searchPayload({ building: "A", filter: "UNMAPPED" })),
      ),
    );
    const result = await world.t
      .withIdentity(PUBLIC_API_ACTOR)
      .action(api.finishedGoods.jobScans.interpretJobScanSearch, {
        warehouseId: world.warehouses.alphaA,
        prompt: "Find records in building A without location",
      });
    expect(result).toMatchObject({
      ok: true,
      value: {
        ok: true,
        value: { filter: "UNMAPPED", search: "", facets: { building: "A" } },
      },
    });
  });

  it("accepts the Thai prototype query and refuses a provider response that omits its pallet filter", async () => {
    const world = await createPublicApiWorld(MODULES, "SUPERVISOR");
    const client = world.t.withIdentity(PUBLIC_API_ACTOR);
    const args = {
      warehouseId: world.warehouses.alphaA,
      prompt: "หางานพาเลทชั้น 2",
    };
    transport
      .mockResolvedValueOnce(
        openRouterOk(JSON.stringify(searchPayload({ floor: 2 }))),
      )
      .mockResolvedValueOnce(
        openRouterOk(
          JSON.stringify(searchPayload({ floor: 2, storageFormat: "PALLET" })),
          { id: "gen-thai-pallet" },
        ),
      );
    expect(
      await client.action(
        api.finishedGoods.jobScans.interpretJobScanSearch,
        args,
      ),
    ).toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "AI_UNREADABLE" } },
    });
    expect(
      await client.action(
        api.finishedGoods.jobScans.interpretJobScanSearch,
        args,
      ),
    ).toMatchObject({
      ok: true,
      value: {
        ok: true,
        value: {
          filter: "ALL",
          search: "",
          facets: { floor: 2, storageFormat: "PALLET" },
        },
      },
    });
  });

  it("returns a location-scoped intent for the Thai prototype location prompt", async () => {
    const world = await createPublicApiWorld(MODULES, "SUPERVISOR");
    transport.mockResolvedValueOnce(
      openRouterOk(JSON.stringify(searchPayload({ search: "F2-L12-1" }))),
    );
    expect(
      await world.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.interpretJobScanSearch, {
          warehouseId: world.warehouses.alphaA,
          prompt: "หาใบงานที่อยู่ F2-L12-1",
        }),
    ).toMatchObject({
      ok: true,
      value: {
        ok: true,
        value: { filter: "ALL", search: "F2-L12-1", searchField: "location" },
      },
    });
  });

  it("refuses a provider response that reverses an explicit status negation", async () => {
    const world = await createPublicApiWorld(MODULES, "SUPERVISOR");
    const client = world.t.withIdentity(PUBLIC_API_ACTOR);
    const args = {
      warehouseId: world.warehouses.alphaA,
      prompt: "Find jobs that are not mapped",
    };
    transport
      .mockResolvedValueOnce(
        openRouterOk(JSON.stringify(searchPayload({ filter: "MAPPED" }))),
      )
      .mockResolvedValueOnce(
        openRouterOk(JSON.stringify(searchPayload({ filter: "UNMAPPED" })), {
          id: "gen-not-mapped",
        }),
      );
    expect(
      await client.action(
        api.finishedGoods.jobScans.interpretJobScanSearch,
        args,
      ),
    ).toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "AI_UNREADABLE" } },
    });
    expect(
      await client.action(
        api.finishedGoods.jobScans.interpretJobScanSearch,
        args,
      ),
    ).toMatchObject({
      ok: true,
      value: { ok: true, value: { filter: "UNMAPPED", search: "" } },
    });
  });

  it("enforces warehouse READ vs MANAGE scoping and tenant isolation before provider calls", async () => {
    const readOnlyWorld = await createPublicApiWorld(MODULES, "SUPERVISOR");
    transport.mockResolvedValueOnce(
      openRouterOk(JSON.stringify(searchPayload({ filter: "UNMAPPED" }))),
    );
    const searchOk = await readOnlyWorld.t
      .withIdentity(PUBLIC_API_ACTOR)
      .action(api.finishedGoods.jobScans.interpretJobScanSearch, {
        warehouseId: readOnlyWorld.warehouses.alphaA,
        prompt: "ยังไม่ระบุตำแหน่ง",
      });
    expect(searchOk).toMatchObject({
      ok: true,
      value: { ok: true, value: { filter: "UNMAPPED", search: "" } },
    });
    expect(transport).toHaveBeenCalledTimes(1);

    // READ-only role must be denied for AI edit proposal before any provider call.
    const editDenied = await readOnlyWorld.t
      .withIdentity(PUBLIC_API_ACTOR)
      .action(api.finishedGoods.jobScans.proposeJobScanEdit, {
        warehouseId: readOnlyWorld.warehouses.alphaA,
        prompt: "move to FG1-F02-Z01",
      });
    expect(editDenied).toMatchObject({
      ok: false,
      denial: { code: "AUTHORIZATION_DENIED" },
    });
    expect(transport).toHaveBeenCalledTimes(1);

    // Cross-tenant and out-of-scope warehouses are denied before any provider call.
    const adminWorld = await createPublicApiWorld(MODULES, "ORG_ADMIN");
    await expect(
      adminWorld.t
        .withIdentity(PUBLIC_API_FOREIGN_ACTOR)
        .action(api.finishedGoods.jobScans.interpretJobScanSearch, {
          warehouseId: adminWorld.warehouses.alphaA,
          prompt: "unmapped",
        }),
    ).rejects.toThrow();
    await expect(
      adminWorld.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.proposeJobScanEdit, {
          warehouseId: adminWorld.warehouses.bravoA,
          prompt: "set quantity to 50",
        }),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("sends only the untrusted prompt, writes no job scans, and records OpenRouter AI usage", async () => {
    const world = await createPublicApiWorld(MODULES, "ORG_ADMIN");
    const warehouseId = world.warehouses.alphaA;
    await world.t.run(async (ctx) => {
      await ctx.db.insert("finishedGoodsJobScans", {
        orgId: world.orgA,
        warehouseId,
        factoryOrder: "FO69070073",
        productBarcodeText: "FBN-BXVMI004-BOX-00F",
        customer: RECORD_SENTINEL,
        source: "MANUAL",
        locationText: "Dock A",
        mapped: false,
        createdAt: 1_000,
        updatedAt: 1_000,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
    });

    const searchPrompt = "pallet on floor 2 in Building A";
    transport.mockResolvedValueOnce(
      openRouterOk(
        JSON.stringify(
          searchPayload({
            building: "Building A",
            floor: 2,
            storageFormat: "PALLET",
          }),
        ),
        { id: "gen-search-1" },
      ),
    );
    const searchRes = await world.t
      .withIdentity(PUBLIC_API_ACTOR)
      .action(api.finishedGoods.jobScans.interpretJobScanSearch, {
        warehouseId,
        prompt: searchPrompt,
      });
    expect(searchRes).toMatchObject({
      ok: true,
      value: {
        ok: true,
        value: {
          filter: "ALL",
          search: "",
          facets: {
            building: "A",
            floor: 2,
            storageFormat: "PALLET",
          },
        },
      },
    });
    const [url, init] = transport.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OPENROUTER_CHAT_URL);
    expect(init.body).not.toContain(RECORD_SENTINEL);
    expect(JSON.parse(init.body as string)).toEqual(
      jobScanSearchRequestBody({
        model: "openai/gpt-6-luna",
        prompt: searchPrompt,
      }),
    );

    const editPrompt =
      "ย้ายไป FG1-F02-Z01 และเปลี่ยนจำนวนเป็น 250 และเปลี่ยนรูปแบบเป็นกล่อง";
    transport.mockResolvedValueOnce(
      openRouterOk(
        JSON.stringify(
          editPayload({
            locationCode: "FG1-F02-Z01",
            quantity: 250,
            storageFormat: "BOX",
          }),
        ),
        { id: "gen-edit-1" },
      ),
    );
    const editRes = await world.t
      .withIdentity(PUBLIC_API_ACTOR)
      .action(api.finishedGoods.jobScans.proposeJobScanEdit, {
        warehouseId,
        prompt: editPrompt,
      });
    expect(editRes).toMatchObject({
      ok: true,
      value: {
        ok: true,
        value: {
          locationCode: "FG1-F02-Z01",
          fields: { quantity: 250, storageFormat: "BOX" },
        },
      },
    });
    const [, editInit] = transport.mock.calls[1] as [string, RequestInit];
    expect(editInit.body).not.toContain(RECORD_SENTINEL);
    expect(JSON.parse(editInit.body as string)).toEqual(
      jobScanEditRequestBody({
        model: "openai/gpt-6-luna",
        prompt: editPrompt,
      }),
    );

    // No job-scan rows were modified or added; AI usage ledger recorded both calls.
    const { scans, events } = await world.t.run(async (ctx) => ({
      scans: await ctx.db.query("finishedGoodsJobScans").collect(),
      events: await ctx.db.query("aiUsageEvents").collect(),
    }));
    expect(scans).toHaveLength(1);
    expect(scans[0]!.customer).toBe(RECORD_SENTINEL);
    expect(scans[0]!.mapped).toBe(false);
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event).toMatchObject({
        orgId: world.orgA,
        warehouseId,
        feature: "AI_SEARCH",
        provider: "OPENROUTER",
        requestedModel: "openai/gpt-6-luna",
        status: "SUCCEEDED",
        billingStatus: "REPORTED",
        costUsdNano: 120_000,
      });
    }
  });

  it("handles truncation, oversized prompts/responses, untrusted output, and unsupported fallback", async () => {
    const world = await createPublicApiWorld(MODULES, "ORG_ADMIN");
    const warehouseId = world.warehouses.alphaA;
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    // Oversized prompt rejected before calling provider (no silent truncation).
    expect(
      await world.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.interpretJobScanSearch, {
          warehouseId,
          prompt: "x".repeat(MAX_JOB_SCAN_AI_PROMPT_LENGTH + 1),
        }),
    ).toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "PROMPT_INVALID" } },
    });
    expect(transport).not.toHaveBeenCalled();

    // Truncated completion (finish_reason: "length") is refused even with valid JSON.
    transport.mockResolvedValueOnce(
      openRouterOk(JSON.stringify(searchPayload({ filter: "UNMAPPED" })), {
        finishReason: "length",
        id: "gen-trunc",
      }),
    );
    expect(
      await world.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.interpretJobScanSearch, {
          warehouseId,
          prompt: `${PROMPT_SENTINEL} unmapped`,
        }),
    ).toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "AI_UNREADABLE" } },
    });

    // Oversized response body (> maxResponseBytes) is rejected without retry.
    const huge = "x".repeat(JOB_SCAN_AI_PROVIDER_POLICY.maxResponseBytes + 128);
    transport.mockResolvedValueOnce(
      new Response(huge, {
        status: 200,
        headers: { "content-length": String(huge.length) },
      }),
    );
    expect(
      await world.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.proposeJobScanEdit, {
          warehouseId,
          prompt: "set quantity to 10",
        }),
    ).toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "AI_UNREADABLE" } },
    });

    // Untrusted fake location guess and extra ID field are refused.
    transport.mockResolvedValueOnce(
      openRouterOk(
        JSON.stringify(editPayload({ locationCode: "FG1-F01-Z99" })),
      ),
    );
    expect(
      await world.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.proposeJobScanEdit, {
          warehouseId,
          prompt: "ย้ายไปที่ว่างใกล้ประตู",
        }),
    ).toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "AI_UNREADABLE" } },
    });

    transport.mockResolvedValueOnce(
      openRouterOk(
        JSON.stringify({ ...searchPayload(), jobScanId: "scan_secret" }),
      ),
    );
    expect(
      await world.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.interpretJobScanSearch, {
          warehouseId,
          prompt: "unmapped",
        }),
    ).toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "AI_UNREADABLE" } },
    });

    // Unsupported requests return an actionable manual fallback.
    transport.mockResolvedValueOnce(
      openRouterOk(JSON.stringify(searchPayload({ supported: false }))),
    );
    expect(
      await world.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.interpretJobScanSearch, {
          warehouseId,
          prompt: "delete all job scans now",
        }),
    ).toMatchObject({
      ok: true,
      value: {
        ok: false,
        error: { code: "UNSUPPORTED", fallback: "MANUAL_SEARCH" },
      },
    });

    transport.mockResolvedValueOnce(
      openRouterOk(JSON.stringify(editPayload({ supported: false }))),
    );
    expect(
      await world.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.proposeJobScanEdit, {
          warehouseId,
          prompt: "delete this record",
        }),
    ).toMatchObject({
      ok: true,
      value: {
        ok: false,
        error: { code: "UNSUPPORTED", fallback: "MANUAL_EDIT" },
      },
    });

    // Logs must never contain the user prompt or API key.
    const logged = warnSpy.mock.calls.flat().map(String).join("\n");
    expect(logged).not.toContain(PROMPT_SENTINEL);
    expect(logged).not.toContain(KEY_SENTINEL);

    // Missing provider configuration fails closed without calling fetch.
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const beforeCalls = transport.mock.calls.length;
    expect(
      await world.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.interpretJobScanSearch, {
          warehouseId,
          prompt: "unmapped",
        }),
    ).toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "AI_UNAVAILABLE" } },
    });
    expect(transport).toHaveBeenCalledTimes(beforeCalls);

    // Provider 5xx does not retry (maxRetries: 0), returns AI_UNAVAILABLE, and
    // falls back to OPENROUTER_MODEL when OPENROUTER_SEARCH_MODEL is empty.
    vi.stubEnv("OPENROUTER_API_KEY", KEY_SENTINEL);
    vi.stubEnv("OPENROUTER_SEARCH_MODEL", "");
    vi.stubEnv("OPENROUTER_MODEL", "fallback/model");
    transport.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "busy" }), { status: 503 }),
    );
    expect(
      await world.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.interpretJobScanSearch, {
          warehouseId,
          prompt: "unmapped",
        }),
    ).toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "AI_UNAVAILABLE" } },
    });
    expect(transport).toHaveBeenCalledTimes(beforeCalls + 1);
    const [, fallbackInit] = transport.mock.calls[beforeCalls] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(fallbackInit.body as string).model).toBe(
      "fallback/model",
    );

    // Timeout returns AI_TIMEOUT without retrying and records TIMEOUT in usage.
    vi.useFakeTimers();
    try {
      transport.mockImplementationOnce(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(
                Object.assign(new Error("aborted"), { name: "AbortError" }),
              ),
            );
          }),
      );
      const pending = world.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.proposeJobScanEdit, {
          warehouseId,
          prompt: "set quantity to 10",
        });
      await vi.advanceTimersByTimeAsync(
        JOB_SCAN_AI_PROVIDER_POLICY.totalDeadlineMs + 50,
      );
      expect(await pending).toMatchObject({
        ok: true,
        value: { ok: false, error: { code: "AI_TIMEOUT" } },
      });
    } finally {
      vi.useRealTimers();
    }
    const events = await world.t.run((ctx) =>
      ctx.db.query("aiUsageEvents").collect(),
    );
    expect(events.map((event) => event.status)).toContain("PROVIDER_ERROR");
    expect(events.map((event) => event.status)).toContain("TIMEOUT");
    expect(events.map((event) => event.status)).toContain("UNREADABLE");
  });

  it("enforces per-actor quotas without calling the provider once exhausted", async () => {
    const world = await createPublicApiWorld(MODULES, "ORG_ADMIN");
    const warehouseId = world.warehouses.alphaA;
    const now = Date.now();
    await world.t.run(async (ctx) => {
      await ctx.db.insert("actionQuotas", {
        orgId: world.orgA,
        actorUserId: world.userA,
        key: JOB_SCAN_SEARCH_AI_RATE_LIMIT.key,
        windowStart: now - (now % JOB_SCAN_SEARCH_AI_RATE_LIMIT.windowMs),
        count: JOB_SCAN_SEARCH_AI_RATE_LIMIT.limit,
      });
      await ctx.db.insert("actionQuotas", {
        orgId: world.orgA,
        actorUserId: world.userA,
        key: JOB_SCAN_EDIT_AI_RATE_LIMIT.key,
        windowStart: now - (now % JOB_SCAN_EDIT_AI_RATE_LIMIT.windowMs),
        count: JOB_SCAN_EDIT_AI_RATE_LIMIT.limit,
      });
    });

    expect(
      await world.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.interpretJobScanSearch, {
          warehouseId,
          prompt: "unmapped",
        }),
    ).toMatchObject({
      ok: true,
      value: {
        ok: false,
        error: { code: "RATE_LIMITED" },
        retryAfterMs: expect.any(Number),
      },
    });
    expect(
      await world.t
        .withIdentity(PUBLIC_API_ACTOR)
        .action(api.finishedGoods.jobScans.proposeJobScanEdit, {
          warehouseId,
          prompt: "set quantity to 10",
        }),
    ).toMatchObject({
      ok: true,
      value: {
        ok: false,
        error: { code: "RATE_LIMITED" },
        retryAfterMs: expect.any(Number),
      },
    });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("listJobScans exactCode and facets across index and bounded fallback", () => {
  type Fixture = Awaited<ReturnType<typeof seedListFixture>>;
  type ListedPage = {
    status: "ready" | "scanning" | "reset";
    items: { id: string; factoryOrder: string }[];
    isDone: boolean;
    continueCursor: string;
    scanCursor?: string;
  };

  async function seedListFixture() {
    const world = await createConvexTenantWorld({
      "../convex/finishedGoods/jobScanLocations.ts": () =>
        import("../../convex/finishedGoods/jobScanLocations"),
      "../convex/finishedGoods/jobScans.ts": () =>
        import("../../convex/finishedGoods/jobScans"),
      "../convex/finishedGoods/searchIndexBackfill.ts": () =>
        import("../../convex/finishedGoods/searchIndexBackfill"),
    });
    await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
    const warehouseId = world.warehouses.alphaA;
    const baseStamps = {
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
    };

    const ids = await world.t.run(async (ctx) => {
      const building = async (code: string, name: string) =>
        ctx.db.insert("storageBuildings", {
          orgId: world.orgA,
          warehouseId,
          code,
          name,
          widthMm: 10000,
          depthMm: 10000,
          defaultFloorHeightMm: 3000,
          floorCount: 2,
          totalHeightMm: 6000,
          grossAreaSqMm: 100000000,
          reservedAreaSqMm: 0,
          usableAreaSqMm: 100000000,
          status: "ACTIVE",
          version: 1,
          ...baseStamps,
        });
      const floor = async (
        buildingId: Id<"storageBuildings">,
        floorNumber: number,
      ) =>
        ctx.db.insert("storageFloors", {
          orgId: world.orgA,
          warehouseId,
          buildingId,
          floorNumber,
          widthMm: 10000,
          depthMm: 10000,
          heightMm: 3000,
          grossAreaSqMm: 100000000,
          reservedAreaSqMm: 0,
          usableAreaSqMm: 100000000,
          version: 1,
          updatedAt: 1,
          updatedByUserId: world.userA,
        });
      const zone = async (
        buildingId: Id<"storageBuildings">,
        floorId: Id<"storageFloors">,
        code: string,
        label: string,
      ) => {
        const locationId = await ctx.db.insert("locations", {
          orgId: world.orgA,
          warehouseId,
          code,
          locationType: "FLOOR_BLOCK",
          status: "ACTIVE",
          buildingId,
          floorId,
        });
        return ctx.db.insert("storageZones", {
          orgId: world.orgA,
          warehouseId,
          buildingId,
          floorId,
          locationId,
          code,
          label,
          qrValue: `ISAS:LOCATION:1:${locationId}`,
          xMm: 0,
          yMm: 0,
          widthMm: 1000,
          depthMm: 1000,
          maxStackHeightMm: 3000,
          status: "ACTIVE",
          ...baseStamps,
        });
      };

      const bNorth = await building("FG1", "อาคารเหนือ North Annex");
      const bSouth = await building("FG10", "FG10 Building B");
      const fNorth1 = await floor(bNorth, 1);
      const fNorth2 = await floor(bNorth, 2);
      const fSouth2 = await floor(bSouth, 2);
      const zNorthF1 = await zone(bNorth, fNorth1, "FG1-F01-Z01", "Zone N1");
      const zNorthF2 = await zone(bNorth, fNorth2, "FG1-F02-Z01", "Zone N2");
      const zNorthF2Prefix = await zone(
        bNorth,
        fNorth2,
        "FG1-F02-Z010",
        "Zone N2 Prefix",
      );
      const zSouthF2 = await zone(bSouth, fSouth2, "FG10-F02-Z01", "Zone S2");

      const scan = (
        createdAt: number,
        row: Partial<Doc<"finishedGoodsJobScans">> & {
          factoryOrder: string;
          productBarcodeText: string;
          locationText: string;
          mapped: boolean;
        },
      ) =>
        ctx.db.insert("finishedGoodsJobScans", {
          orgId: world.orgA,
          warehouseId,
          source: "MANUAL",
          createdAt,
          updatedAt: createdAt,
          createdByUserId: world.userA,
          updatedByUserId: world.userA,
          ...row,
        });

      return {
        exactFoPalletF2: await scan(1_010, {
          factoryOrder: "FO69070073",
          productBarcodeText: "FBN-BOX-01",
          partName: "Tray Alpha",
          customer: "Siam Packaging",
          locationText: "FG1-F02-Z01",
          locationCode: "FG1-F02-Z01",
          locationName: "Zone N2",
          mapped: true,
          buildingId: bNorth,
          floorId: fNorth2,
          zoneId: zNorthF2,
          storageFormat: "PALLET",
        }),
        prefixFoPalletF2: await scan(1_020, {
          factoryOrder: "FO690700731",
          productBarcodeText: "FBN-BOX-010",
          partName: "Tray Prefix",
          customer: "Siam Packaging",
          locationText: "FG1-F02-Z010",
          locationCode: "FG1-F02-Z010",
          locationName: "Zone N2 Prefix",
          mapped: true,
          buildingId: bNorth,
          floorId: fNorth2,
          zoneId: zNorthF2Prefix,
          storageFormat: "PALLET",
        }),
        legacyZoneOnlyPalletF2: await scan(1_030, {
          factoryOrder: "FO69070099",
          productBarcodeText: "FBN-LEGACY-01",
          partName: "Legacy Floor Lookup",
          locationText: "FG1-F02-Z01",
          locationCode: "FG1-F02-Z01",
          locationName: "Zone N2",
          mapped: true,
          buildingId: bNorth,
          // floorId intentionally omitted to verify zone fallback
          zoneId: zNorthF2,
          storageFormat: "PALLET",
        }),
        partMatchesCodeOnly: await scan(1_040, {
          factoryOrder: "FO69080001",
          productBarcodeText: "FBN-OTHER-01",
          partName: "FO69070073",
          customer: "FO69070073",
          locationText: "FG1-F01-Z01",
          locationCode: "FG1-F01-Z01",
          locationName: "Zone N1",
          mapped: true,
          buildingId: bNorth,
          floorId: fNorth1,
          zoneId: zNorthF1,
          storageFormat: "BOX",
        }),
        southPalletF2: await scan(1_050, {
          factoryOrder: "FO69090001",
          productBarcodeText: "FBN-SOUTH-01",
          partName: "South Pallet",
          locationText: "FG10-F02-Z01",
          locationCode: "FG10-F02-Z01",
          locationName: "Zone S2",
          mapped: true,
          buildingId: bSouth,
          floorId: fSouth2,
          zoneId: zSouthF2,
          storageFormat: "PALLET",
        }),
        unmappedBoxShort: await scan(1_060, {
          factoryOrder: "A1",
          productBarcodeText: "BAR-UNMAPPED-1",
          partName: "Short Code Box",
          locationText: "Dock A",
          mapped: false,
          storageFormat: "BOX",
        }),
        unmappedBoxShortPrefix: await scan(1_070, {
          factoryOrder: "A10",
          productBarcodeText: "BAR-UNMAPPED-2",
          partName: "Short Code Prefix",
          locationText: "Dock A1",
          mapped: false,
          storageFormat: "BOX",
        }),
      };
    });

    return { world, warehouseId, ids };
  }

  async function buildIndex(fixture: Fixture) {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + RECONCILE_MARGIN_MS + 1_000);
      let cursor: string | undefined;
      let runId: string | undefined;
      for (let i = 0; i < 50; i++) {
        const res = (await fixture.world.t.run((ctx) =>
          (backfill.run as unknown as Runtime)._handler(ctx, {
            warehouseId: fixture.warehouseId,
            kind: "jobScans",
            ...(cursor ? { cursor, runId } : { restart: true }),
            batchSize: 50,
          }),
        )) as {
          isDone: boolean;
          ready: boolean;
          continueCursor: string;
          runId: string;
        };
        if (res.isDone) {
          expect(res.ready).toBe(true);
          return;
        }
        cursor = res.continueCursor;
        runId = res.runId;
      }
      throw new Error("Backfill did not complete.");
    } finally {
      vi.useRealTimers();
    }
  }

  async function setReady(world: ConvexTenantWorld, ready: boolean) {
    await world.t.run(async (ctx) => {
      const row = await ctx.db
        .query("searchIndexReadiness")
        .withIndex("by_orgId_warehouseId_kind", (q) =>
          q
            .eq("orgId", world.orgA)
            .eq("warehouseId", world.warehouses.alphaA)
            .eq("kind", "jobScans"),
        )
        .unique();
      await ctx.db.patch(row!._id, { ready });
    });
  }

  async function listAll(
    fixture: Fixture,
    args: {
      filter: "ALL" | "MAPPED" | "UNMAPPED";
      search?: string;
      searchField?: JobScanSearchField;
      exactCode?: boolean;
      locationId?: string;
      facets?: {
        building?: string;
        floor?: number;
        storageFormat?: "PALLET" | "BOX" | "OTHER";
      };
      pageSize?: number;
    },
  ) {
    const client = fixture.world.t.withIdentity(IDENTITY);
    const items: string[] = [];
    let cursor: string | undefined;
    for (let pageNo = 0; pageNo < 50; pageNo++) {
      let scanCursor: string | undefined;
      let page: ListedPage;
      do {
        const outcome = (await client.query(
          api.finishedGoods.jobScans.listJobScans,
          {
            warehouseId: fixture.warehouseId,
            progressive: true,
            pageSize: args.pageSize ?? 2,
            ...args,
            ...(cursor ? { cursor } : {}),
            ...(scanCursor ? { scanCursor } : {}),
          },
        )) as { ok: true; value: ListedPage };
        expect(outcome.ok).toBe(true);
        page = outcome.value;
        scanCursor = page.scanCursor;
      } while (page.status === "scanning");
      expect(page.status).toBe("ready");
      items.push(...page.items.map((item) => item.id));
      if (page.isDone) return items;
      cursor = page.continueCursor;
    }
    throw new Error("Pagination did not finish.");
  }

  it("resolves modern and legacy QR labels to the same scoped location identity without matching old text or barcode collisions", async () => {
    const fixture = await seedListFixture();
    const { world, warehouseId, ids } = fixture;
    const code = "FG1-F02-Z01";
    const legacyQr = "warehouse-legacy-qr";
    const locationId = await world.t.run(async (ctx) => {
      const current = (await ctx.db.get(ids.exactFoPalletF2))!;
      const zone = (await ctx.db.get(current.zoneId!))!;
      await ctx.db.patch(zone._id, { qrValue: legacyQr });
      await ctx.db.patch(ids.exactFoPalletF2, { locationId: zone.locationId });
      await ctx.db.patch(ids.prefixFoPalletF2, { locationText: code });
      await ctx.db.patch(ids.southPalletF2, { productBarcodeText: code });
      return zone.locationId;
    });
    const client = world.t.withIdentity(IDENTITY);
    for (const qr of [`ISAS:LOCATION:1:${locationId}`, legacyQr]) {
      expect(
        await client.query(api.finishedGoods.jobScanLocations.resolve, {
          warehouseId,
          code: qr,
          qrOnly: true,
        }),
      ).toMatchObject({
        ok: true,
        value: { ok: true, location: { locationId, code } },
      });
    }
    expect(
      await client.query(api.finishedGoods.jobScanLocations.resolve, {
        warehouseId,
        code,
        qrOnly: true,
      }),
    ).toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "LOCATION_NOT_FOUND" } },
    });
    expect(
      await listAll(fixture, {
        filter: "ALL",
        locationId,
        search: code,
        pageSize: 1,
      }),
    ).toEqual([ids.legacyZoneOnlyPalletF2, ids.exactFoPalletF2]);
    expect(
      await listAll(fixture, {
        filter: "ALL",
        locationId: "invalid",
        search: code,
      }),
    ).toEqual([]);
  });

  it("keeps an active zone searchable after its shared default position is retired and refuses a foreign warehouse QR", async () => {
    const fixture = await seedListFixture();
    const { world, warehouseId, ids } = fixture;
    const qr = "legacy-default-position";
    const foreignQr = "foreign-location-label";
    const { locationId, positionId } = await world.t.run(async (ctx) => {
      const scan = (await ctx.db.get(ids.exactFoPalletF2))!;
      const zone = (await ctx.db.get(scan.zoneId!))!;
      const position = {
        orgId: zone.orgId,
        warehouseId,
        buildingId: zone.buildingId,
        floorId: zone.floorId,
        zoneId: zone._id,
        locationId: zone.locationId,
        code: zone.code,
        label: zone.label,
        qrValue: qr,
        kind: "DEFAULT" as const,
        isDefault: true,
        status: "ACTIVE" as const,
        createdAt: zone.createdAt,
        createdByUserId: zone.createdByUserId,
        updatedAt: zone.updatedAt,
        updatedByUserId: zone.updatedByUserId,
      };
      const positionId = await ctx.db.insert("storagePositions", position);
      await ctx.db.insert("storagePositions", {
        ...position,
        qrValue: foreignQr,
        warehouseId: world.warehouses.bravoA,
      });
      await ctx.db.patch(scan._id, { supportPositionId: positionId });
      await ctx.db.patch(ids.southPalletF2, { productBarcodeText: foreignQr });
      return { locationId: zone.locationId, positionId };
    });
    const client = world.t.withIdentity(IDENTITY);
    for (const status of ["ACTIVE", "INACTIVE"] as const) {
      await world.t.run((ctx) => ctx.db.patch(positionId, { status }));
      for (const code of [`ISAS:LOCATION:1:${locationId}`, qr]) {
        expect(
          await client.query(api.finishedGoods.jobScanLocations.resolve, {
            warehouseId,
            code,
            qrOnly: true,
          }),
        ).toMatchObject({
          ok: true,
          value: { ok: true, location: { locationId } },
        });
      }
      expect(
        await listAll(fixture, { filter: "ALL", locationId, pageSize: 1 }),
      ).toEqual([ids.legacyZoneOnlyPalletF2, ids.exactFoPalletF2]);
    }
    expect(
      await client.query(api.finishedGoods.jobScanLocations.resolve, {
        warehouseId,
        code: foreignQr,
        qrOnly: true,
      }),
    ).toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "LOCATION_UNAVAILABLE" } },
    });
  });

  it("matches exact scanned codes without matching prefixes or non-code fields in both index and fallback modes", async () => {
    const fixture = await seedListFixture();
    await buildIndex(fixture);
    const { ids } = fixture;

    for (const ready of [true, false]) {
      await setReady(fixture.world, ready);

      // Exact factoryOrder (case + fullwidth normalized): excludes prefix and partName/customer hits.
      expect(
        await listAll(fixture, {
          filter: "ALL",
          search: " ｆｏ６９０７００７３ ",
          exactCode: true,
        }),
      ).toEqual([ids.exactFoPalletF2]);

      // Default substring search still finds exact, prefix, and partName/customer matches.
      expect(
        await listAll(fixture, {
          filter: "ALL",
          search: "FO69070073",
        }),
      ).toEqual([
        ids.partMatchesCodeOnly,
        ids.prefixFoPalletF2,
        ids.exactFoPalletF2,
      ]);
      expect(
        await listAll(fixture, {
          filter: "ALL",
          search: "FO69070073",
          searchField: "factoryOrder",
        }),
      ).toEqual([ids.exactFoPalletF2]);

      // Exact productBarcodeText: excludes FBN-BOX-010 prefix collision.
      expect(
        await listAll(fixture, {
          filter: "ALL",
          search: "fbn-box-01",
          exactCode: true,
        }),
      ).toEqual([ids.exactFoPalletF2]);

      // Exact locationCode: excludes FG1-F02-Z010 prefix collision.
      expect(
        await listAll(fixture, {
          filter: "ALL",
          search: "FG1-F02-Z01",
          exactCode: true,
        }),
      ).toEqual([ids.legacyZoneOnlyPalletF2, ids.exactFoPalletF2]);

      // Exact unmapped locationText: excludes "Dock A1".
      expect(
        await listAll(fixture, {
          filter: "UNMAPPED",
          search: "dock a",
          exactCode: true,
        }),
      ).toEqual([ids.unmappedBoxShort]);

      // Short exact code (< 3 code points, always bounded scan): excludes "A10".
      expect(
        await listAll(fixture, {
          filter: "ALL",
          search: "A1",
          exactCode: true,
        }),
      ).toEqual([ids.unmappedBoxShort]);
    }
  });

  it("applies explicit field scope in both index and fallback modes without matching another field or a stale location", async () => {
    const fixture = await seedListFixture();
    const { world, ids } = fixture;
    const search = "F2-L12-1";
    const savedLabel = "ข้างเสา C12";
    await world.t.run(async (ctx) => {
      await ctx.db.patch(ids.exactFoPalletF2, { locationCode: search });
      await ctx.db.patch(ids.prefixFoPalletF2, { partName: search });
      await ctx.db.patch(ids.southPalletF2, { productBarcodeText: search });
      await ctx.db.patch(ids.legacyZoneOnlyPalletF2, { locationText: search });
      await ctx.db.patch(ids.unmappedBoxShort, { locationText: savedLabel });
      await ctx.db.patch(ids.unmappedBoxShortPrefix, { partName: savedLabel });
    });
    await buildIndex(fixture);
    for (const ready of [true, false]) {
      await setReady(world, ready);
      const args = { filter: "ALL" as const, search, pageSize: 1 };
      expect(await listAll(fixture, args)).toEqual([
        ids.southPalletF2,
        ids.legacyZoneOnlyPalletF2,
        ids.prefixFoPalletF2,
        ids.exactFoPalletF2,
      ]);
      expect(
        await listAll(fixture, { ...args, searchField: "location" }),
      ).toEqual([ids.exactFoPalletF2]);
      expect(
        await listAll(fixture, {
          ...args,
          search: savedLabel,
          searchField: "location",
        }),
      ).toEqual([ids.unmappedBoxShort]);
      expect(await listAll(fixture, { ...args, exactCode: true })).toEqual([
        ids.southPalletF2,
        ids.exactFoPalletF2,
      ]);
      expect(
        await listAll(fixture, {
          ...args,
          search: "FG1-F02-Z01",
          exactCode: true,
        }),
      ).toEqual([ids.legacyZoneOnlyPalletF2]);
      expect(
        await listAll(fixture, { ...args, searchField: "partName" }),
      ).toEqual([ids.prefixFoPalletF2]);
      expect(
        await listAll(fixture, { ...args, searchField: "productBarcodeText" }),
      ).toEqual([ids.southPalletF2]);
    }
  });

  it("filters by building, floor, and storageFormat facets across index and bounded fallback", async () => {
    const fixture = await seedListFixture();
    await buildIndex(fixture);
    const { ids } = fixture;

    for (const ready of [true, false]) {
      await setReady(fixture.world, ready);

      // "pallet on floor 2" (no text search -> bounded scan; includes legacy zone-only floor lookup).
      expect(
        await listAll(fixture, {
          filter: "ALL",
          facets: { floor: 2, storageFormat: "PALLET" },
          pageSize: 1,
        }),
      ).toEqual([
        ids.southPalletF2,
        ids.legacyZoneOnlyPalletF2,
        ids.prefixFoPalletF2,
        ids.exactFoPalletF2,
      ]);

      // Building facet matches Thai building name and building code alike.
      expect(
        await listAll(fixture, {
          filter: "ALL",
          facets: {
            building: "อาคารเหนือ",
            floor: 2,
            storageFormat: "PALLET",
          },
          pageSize: 1,
        }),
      ).toEqual([
        ids.legacyZoneOnlyPalletF2,
        ids.prefixFoPalletF2,
        ids.exactFoPalletF2,
      ]);

      expect(
        await listAll(fixture, {
          filter: "ALL",
          facets: { building: "FG1", floor: 2 },
        }),
      ).toEqual([
        ids.legacyZoneOnlyPalletF2,
        ids.prefixFoPalletF2,
        ids.exactFoPalletF2,
      ]);

      // Combined search + facets exercises the trigram index when ready and bounded fallback when unready.
      expect(
        await listAll(fixture, {
          filter: "ALL",
          search: "South Pallet",
          facets: { building: "fg1" },
        }),
      ).toEqual([]);
      expect(
        await listAll(fixture, {
          filter: "ALL",
          search: "South Pallet",
          facets: { building: "FG10" },
        }),
      ).toEqual([ids.southPalletF2]);
      expect(
        await listAll(fixture, {
          filter: "ALL",
          search: "South Pallet",
          facets: { building: "Building FG10" },
        }),
      ).toEqual([ids.southPalletF2]);

      expect(
        await listAll(fixture, {
          filter: "ALL",
          search: "Siam Packaging",
          facets: {
            building: "North Annex",
            floor: 2,
            storageFormat: "PALLET",
          },
          pageSize: 1,
        }),
      ).toEqual([ids.prefixFoPalletF2, ids.exactFoPalletF2]);

      // Unmapped + box facet works; invalid floor returns empty cleanly.
      expect(
        await listAll(fixture, {
          filter: "UNMAPPED",
          facets: { storageFormat: "BOX" },
        }),
      ).toEqual([ids.unmappedBoxShortPrefix, ids.unmappedBoxShort]);

      expect(
        await listAll(fixture, {
          filter: "ALL",
          facets: { floor: -1 },
        }),
      ).toEqual([]);
    }
  });

  it("isolates cursor scopes across exactCode and facet changes in both index and bounded branches", async () => {
    const fixture = await seedListFixture();
    await buildIndex(fixture);
    const client = fixture.world.t.withIdentity(IDENTITY);

    const fetchPage = async (args: {
      filter: "ALL" | "MAPPED" | "UNMAPPED";
      search?: string;
      exactCode?: boolean;
      facets?: {
        building?: string;
        floor?: number;
        storageFormat?: "PALLET" | "BOX" | "OTHER";
      };
      cursor?: string;
    }) => {
      const outcome = (await client.query(
        api.finishedGoods.jobScans.listJobScans,
        {
          warehouseId: fixture.warehouseId,
          pageSize: 1,
          progressive: true,
          ...args,
        },
      )) as { ok: true; value: ListedPage };
      expect(outcome.ok).toBe(true);
      return outcome.value;
    };

    // Indexed branch (trigram ready, 3+ code point search):
    const indexedPage = await fetchPage({
      filter: "ALL",
      search: "FG1-F02-Z01",
      exactCode: false,
    });
    expect(indexedPage.status).toBe("ready");
    expect(indexedPage.continueCursor).not.toBe("");

    // Switching exactCode or facets with an old cursor must reset, never mix.
    expect(
      await fetchPage({
        filter: "ALL",
        search: "FG1-F02-Z01",
        exactCode: true,
        cursor: indexedPage.continueCursor,
      }),
    ).toMatchObject({ status: "reset", items: [] });
    expect(
      await fetchPage({
        filter: "ALL",
        search: "FG1-F02-Z01",
        facets: { storageFormat: "PALLET" },
        cursor: indexedPage.continueCursor,
      }),
    ).toMatchObject({ status: "reset", items: [] });

    // Bounded branch (facets only, and unready search):
    const facetPage = await fetchPage({
      filter: "ALL",
      facets: { floor: 2, storageFormat: "PALLET" },
    });
    expect(facetPage.status).toBe("ready");
    expect(facetPage.continueCursor).not.toBe("");

    expect(
      await fetchPage({
        filter: "ALL",
        facets: { floor: 1, storageFormat: "PALLET" },
        cursor: facetPage.continueCursor,
      }),
    ).toMatchObject({ status: "reset", items: [] });
    expect(
      await fetchPage({
        filter: "ALL",
        cursor: facetPage.continueCursor,
      }),
    ).toMatchObject({ status: "reset", items: [] });

    await setReady(fixture.world, false);
    const fallbackPage = await fetchPage({
      filter: "ALL",
      search: "FG1-F02-Z01",
      exactCode: true,
    });
    expect(fallbackPage.status).toBe("ready");
    expect(fallbackPage.continueCursor).not.toBe("");
    expect(
      await fetchPage({
        filter: "ALL",
        search: "FG1-F02-Z01",
        exactCode: false,
        cursor: fallbackPage.continueCursor,
      }),
    ).toMatchObject({ status: "reset", items: [] });
  });
});
