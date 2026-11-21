import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import {
  readProductSummary,
  summaryReadiness,
} from "../lib/finishedGoodsSummary";
import {
  fingerprintArguments,
  resultIdentityDigest,
  writeIdempotencyRecord,
} from "../lib/idempotency";
import { inventoryWriter } from "../lib/inventoryWriter";
import { replayTenantWriteIfPresent } from "../lib/masterDataStore";
import { grantedPermissionsAmong } from "../lib/navigationGrants";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { writeContextOf } from "../lib/writeEnvelope";
import { NAVIGATION_PERMISSION } from "../model/authorization/navigationPermissions";
import {
  compactCustomerStem,
  normalizeCustomerName,
  validateCustomerAlias,
} from "../model/customers/customers";
import { bumpCustomerCatalogueGeneration } from "./catalogueGeneration";
import { resolveExactCustomerMatch } from "./matching";
import { customerLinkSource, customerStatus } from "./validators";
import { allowedCustomerWarehouses } from "./warehouseScope";

const readCustomers = {
  permissionCode: NAVIGATION_PERMISSION.customers,
  target: { table: "customers" },
} as const;

const RECENT_JOBS_LIMIT = 10;
const LINKED_PRODUCTS_LIMIT = 50;
const CUSTOMER_ALIASES_LIMIT = 100;
const REVIEW_SCAN_BUDGET = 300;
const ACTIVE_CUSTOMER_SAMPLE = 100;
const MAX_RESOLVE_SCANS = 100;
const PICKER_LIMIT = 25;

const aliasWriteOutcome = v.union(
  v.object({
    ok: v.literal(true),
    aliasId: v.string(),
    replayed: v.boolean(),
  }),
  v.object({
    ok: v.literal(false),
    code: v.string(),
    field: v.optional(v.string()),
  }),
);

const resolveOutcome = v.union(
  v.object({
    ok: v.literal(true),
    updatedCount: v.number(),
    aliasId: v.optional(v.string()),
    replayed: v.boolean(),
  }),
  v.object({
    ok: v.literal(false),
    code: v.string(),
    field: v.optional(v.string()),
  }),
);

function failure(code: string, field?: string) {
  return {
    ok: false as const,
    code,
    ...(field === undefined ? {} : { field }),
  };
}

async function readUnresolvedScans(ctx: TenantFunctionContext, budget: number) {
  const allowed = await allowedCustomerWarehouses(ctx);
  if (!allowed.hasWarehouseRead || allowed.warehouses.length === 0) {
    return {
      allowed,
      scans: [] as Doc<"finishedGoodsJobScans">[],
      hasMore: false,
    };
  }
  const perWarehouse = Math.max(
    1,
    Math.min(100, Math.ceil(budget / allowed.warehouses.length) + 1),
  );
  const chunks = await Promise.all(
    allowed.warehouses.map((warehouse) =>
      ctx.tenantDb
        .byIndex<Doc<"finishedGoodsJobScans">>(
          "finishedGoodsJobScans",
          "by_orgId_warehouseId_customerLinkSource_createdAt",
          [
            { field: "warehouseId", value: warehouse._id },
            {
              field: "customerLinkSource",
              value: undefined,
              missing: true,
            },
          ],
        )
        .take(perWarehouse, "desc"),
    ),
  );
  let hasMore = false;
  const combined: Doc<"finishedGoodsJobScans">[] = [];
  for (const rows of chunks) {
    if (rows.length >= perWarehouse) hasMore = true;
    for (const scan of rows) {
      if (scan.voided || scan.customerId !== undefined) continue;
      if (!scan.customer?.trim()) continue;
      combined.push(scan);
    }
  }
  combined.sort((a, b) => b.createdAt - a.createdAt);
  if (combined.length > budget) {
    hasMore = true;
    combined.length = budget;
  }
  return { allowed, scans: combined, hasMore };
}

export const getCustomerActivity = queryWithOrg({
  ...readCustomers,
  args: { customerId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      canViewWarehouseData: v.boolean(),
      aliases: v.array(
        v.object({
          aliasId: v.id("customerAliases"),
          alias: v.string(),
          approvedAt: v.number(),
          exampleJobScanId: v.optional(v.id("finishedGoodsJobScans")),
        }),
      ),
      recentJobs: v.array(
        v.object({
          jobScanId: v.id("finishedGoodsJobScans"),
          factoryOrder: v.string(),
          partName: v.optional(v.string()),
          warehouseId: v.id("warehouses"),
          warehouseName: v.string(),
          createdAt: v.number(),
          customerLinkSource: v.optional(customerLinkSource),
          capturedName: v.optional(v.string()),
        }),
      ),
      hasMoreJobs: v.boolean(),
      linkedProducts: v.array(
        v.object({
          productId: v.id("finishedGoodsProducts"),
          sku: v.string(),
          name: v.string(),
          unit: v.string(),
          status: v.union(
            v.literal("DRAFT"),
            v.literal("ACTIVE"),
            v.literal("ARCHIVED"),
          ),
          warehouseId: v.id("warehouses"),
          warehouseName: v.string(),
          customerReference: v.optional(v.string()),
          totalQuantity: v.optional(v.number()),
        }),
      ),
      hasMoreProducts: v.boolean(),
    }),
  ),
  handler: async (ctx, { customerId }) => {
    const customer = await ctx.tenantDb.get<Doc<"customers">>(
      "customers",
      customerId,
    );
    if (!customer) return null;

    const [aliasRows, allowed] = await Promise.all([
      ctx.tenantDb
        .byIndex<Doc<"customerAliases">>(
          "customerAliases",
          "by_orgId_customerId_normalizedAlias",
          [{ field: "customerId", value: customer._id }],
        )
        .take(CUSTOMER_ALIASES_LIMIT),
      allowedCustomerWarehouses(ctx),
    ]);

    const aliases = aliasRows.map((row) => ({
      aliasId: row._id,
      alias: row.alias,
      approvedAt: row.approvedAt,
      ...(row.exampleJobScanId === undefined
        ? {}
        : { exampleJobScanId: row.exampleJobScanId }),
    }));

    if (!allowed.hasWarehouseRead || allowed.warehouses.length === 0) {
      return {
        canViewWarehouseData: allowed.hasWarehouseRead,
        aliases,
        recentJobs: [],
        hasMoreJobs: false,
        linkedProducts: [],
        hasMoreProducts: false,
      };
    }

    const jobScanLimit = RECENT_JOBS_LIMIT + 1;
    const rawJobs =
      allowed.orgWide || allowed.warehouses.length > 5
        ? await ctx.tenantDb
            .byIndex<Doc<"finishedGoodsJobScans">>(
              "finishedGoodsJobScans",
              "by_orgId_customerId_createdAt",
              [{ field: "customerId", value: customer._id }],
            )
            .take(RECENT_JOBS_LIMIT * 3, "desc")
        : (
            await Promise.all(
              allowed.warehouses.map((warehouse) =>
                ctx.tenantDb
                  .byIndex<Doc<"finishedGoodsJobScans">>(
                    "finishedGoodsJobScans",
                    "by_orgId_warehouseId_customerId_createdAt",
                    [
                      { field: "warehouseId", value: warehouse._id },
                      { field: "customerId", value: customer._id },
                    ],
                  )
                  .take(jobScanLimit + 5, "desc"),
              ),
            )
          ).flat();
    const visibleJobs = rawJobs
      .filter((scan) => !scan.voided && allowed.byId.has(scan.warehouseId))
      .sort((a, b) => b.createdAt - a.createdAt);
    const hasMoreJobs = visibleJobs.length > RECENT_JOBS_LIMIT;
    const recentJobs = visibleJobs.slice(0, RECENT_JOBS_LIMIT).map((scan) => ({
      jobScanId: scan._id,
      factoryOrder: scan.factoryOrder,
      ...(scan.partName === undefined ? {} : { partName: scan.partName }),
      warehouseId: scan.warehouseId,
      warehouseName: allowed.byId.get(scan.warehouseId)?.name ?? "",
      createdAt: scan.createdAt,
      ...(scan.customerLinkSource === undefined
        ? {}
        : { customerLinkSource: scan.customerLinkSource }),
      ...(scan.customer === undefined ? {} : { capturedName: scan.customer }),
    }));

    const productLimit = LINKED_PRODUCTS_LIMIT + 1;
    const rawProducts =
      allowed.orgWide || allowed.warehouses.length > 5
        ? await ctx.tenantDb
            .byIndex<Doc<"finishedGoodsProducts">>(
              "finishedGoodsProducts",
              "by_orgId_customerId",
              [{ field: "customerId", value: customer._id }],
            )
            .take(productLimit)
        : (
            await Promise.all(
              allowed.warehouses.map((warehouse) =>
                ctx.tenantDb
                  .byIndex<Doc<"finishedGoodsProducts">>(
                    "finishedGoodsProducts",
                    "by_orgId_warehouseId_customerId",
                    [
                      { field: "warehouseId", value: warehouse._id },
                      { field: "customerId", value: customer._id },
                    ],
                  )
                  .take(productLimit),
              ),
            )
          ).flat();
    const visibleProducts = rawProducts
      .filter((product) => allowed.byId.has(product.warehouseId))
      .sort((a, b) => a.name.localeCompare(b.name));
    const hasMoreProducts = visibleProducts.length > LINKED_PRODUCTS_LIMIT;
    const pageProducts = visibleProducts.slice(0, LINKED_PRODUCTS_LIMIT);

    // Read cached product stock totals only for warehouses whose summary index is ready.
    const touchedWarehouses = [
      ...new Set(pageProducts.map((product) => product.warehouseId)),
    ];
    const readinessEntries = await Promise.all(
      touchedWarehouses.map(
        async (warehouseId): Promise<[Id<"warehouses">, boolean]> => [
          warehouseId,
          Boolean((await summaryReadiness(ctx.tenantDb, warehouseId))?.ready),
        ],
      ),
    );
    const readyByWarehouse = new Map(readinessEntries);
    const linkedProducts = await Promise.all(
      pageProducts.map(async (product) => {
        const summary = readyByWarehouse.get(product.warehouseId)
          ? await readProductSummary(ctx, product)
          : null;
        return {
          productId: product._id,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          status: product.status,
          warehouseId: product.warehouseId,
          warehouseName: allowed.byId.get(product.warehouseId)?.name ?? "",
          ...(product.customerReference === undefined
            ? {}
            : { customerReference: product.customerReference }),
          ...(summary !== null ? { totalQuantity: summary.quantity } : {}),
        };
      }),
    );

    return {
      canViewWarehouseData: true,
      aliases,
      recentJobs,
      hasMoreJobs,
      linkedProducts,
      hasMoreProducts,
    };
  },
});

export const searchCustomerOptions = queryWithOrg({
  ...readCustomers,
  args: {
    search: v.optional(v.string()),
    includeCustomerId: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      customerId: v.id("customers"),
      code: v.string(),
      name: v.string(),
      status: customerStatus,
      province: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { search, includeCustomerId }) => {
    const needle = normalizeCustomerName(search ?? "");
    const [activeRows, aliases, included] = await Promise.all([
      ctx.tenantDb
        .byIndex<Doc<"customers">>(
          "customers",
          "by_orgId_status_normalizedName",
          [{ field: "status", value: "ACTIVE" }],
        )
        .take(ACTIVE_CUSTOMER_SAMPLE),
      needle
        ? ctx.tenantDb
            .byIndex<Doc<"customerAliases">>(
              "customerAliases",
              "by_orgId_normalizedAlias",
              [],
            )
            .take(ACTIVE_CUSTOMER_SAMPLE)
        : Promise.resolve([]),
      includeCustomerId
        ? ctx.tenantDb.get<Doc<"customers">>("customers", includeCustomerId)
        : Promise.resolve(null),
    ]);
    const aliasCustomerIds = new Set(
      aliases
        .filter((row) => row.normalizedAlias.includes(needle))
        .map((row) => row.customerId),
    );
    const filtered = activeRows.filter(
      (row) =>
        !needle ||
        row.normalizedName.includes(needle) ||
        normalizeCustomerName(row.code).includes(needle) ||
        normalizeCustomerName(row.legalNameTh ?? "").includes(needle) ||
        normalizeCustomerName(row.legalNameEn ?? "").includes(needle) ||
        aliasCustomerIds.has(row._id),
    );
    const picked = filtered.slice(0, PICKER_LIMIT);
    if (included && !picked.some((row) => row._id === included._id)) {
      picked.unshift(included);
    }
    return picked.map(({ _id, code, name, status, deliveryAddress }) => ({
      customerId: _id,
      code,
      name,
      status,
      ...(deliveryAddress?.province === undefined
        ? {}
        : { province: deliveryAddress.province }),
    }));
  },
});

export const addCustomerAlias = mutationWithOrg({
  permissionCode: NAVIGATION_PERMISSION.customerManage,
  args: {
    requestId: v.string(),
    customerId: v.id("customers"),
    alias: v.string(),
    exampleJobScanId: v.optional(v.id("finishedGoodsJobScans")),
  },
  returns: aliasWriteOutcome,
  target: {
    table: "customers",
    id: ({ customerId }: { customerId: Id<"customers"> }) => customerId,
  },
  handler: async (ctx, args) => {
    const context = writeContextOf(ctx, {
      table: "customerAliases",
      operation: "customer.alias.add",
      requestId: args.requestId,
    });
    const replay = await replayTenantWriteIfPresent({
      ...context,
      fingerprint: args,
    });
    if (!replay.ok) return failure(replay.error.code);
    if (replay.value) {
      return {
        ok: true as const,
        aliasId: replay.value.documentId,
        replayed: true,
      };
    }

    const validated = validateCustomerAlias(args.alias);
    if (!validated.ok)
      return failure(validated.error.code, validated.error.field);

    const customer = await ctx.tenantDb.get<Doc<"customers">>(
      "customers",
      args.customerId,
    );
    if (!customer) return failure("NOT_FOUND");
    if (customer.status === "ARCHIVED") return failure("CUSTOMER_ARCHIVED");

    if (args.exampleJobScanId) {
      const scan = await ctx.tenantDb.get<Doc<"finishedGoodsJobScans">>(
        "finishedGoodsJobScans",
        args.exampleJobScanId,
      );
      if (!scan) return failure("NOT_FOUND", "exampleJobScanId");
    }

    const existing = await ctx.tenantDb
      .byIndex<Doc<"customerAliases">>(
        "customerAliases",
        "by_orgId_customerId_normalizedAlias",
        [
          { field: "customerId", value: customer._id },
          { field: "normalizedAlias", value: validated.value.normalizedAlias },
        ],
      )
      .unique();
    if (existing) return failure("DUPLICATE_KEY", "alias");

    const requestHash = await fingerprintArguments(args);
    if (!requestHash.ok) return failure(requestHash.error.code);

    const aliasId = await ctx.tenantDb.insert("customerAliases", {
      customerId: customer._id,
      alias: validated.value.alias,
      normalizedAlias: validated.value.normalizedAlias,
      ...(args.exampleJobScanId === undefined
        ? {}
        : { exampleJobScanId: args.exampleJobScanId }),
      approvedAt: context.now,
      approvedByUserId: context.actorUserId,
    });

    await ctx.tenantDb.insert("auditEvents", {
      occurredAt: context.now,
      actorKind: "USER",
      actorUserId: context.actorUserId,
      action: "customer.alias.add",
      permissionCode: context.permissionCode,
      entityTable: "customerAliases",
      entityId: aliasId,
      outcome: "ALLOWED",
      requestId: context.requestId,
      changes: [
        { field: "customerId", to: customer._id },
        { field: "alias", to: validated.value.alias },
      ],
    });
    await writeIdempotencyRecord({
      tenantDb: ctx.tenantDb,
      operation: "customer.alias.add",
      requestId: context.requestId,
      requestHash: requestHash.value,
      resultRef: aliasId,
      resultHash: await resultIdentityDigest("customerAliases", aliasId),
      actorUserId: context.actorUserId,
      now: context.now,
    });
    await bumpCustomerCatalogueGeneration(ctx.tenantDb);

    return { ok: true as const, aliasId, replayed: false };
  },
});

export const removeCustomerAlias = mutationWithOrg({
  permissionCode: NAVIGATION_PERMISSION.customerManage,
  args: {
    requestId: v.string(),
    aliasId: v.id("customerAliases"),
  },
  returns: aliasWriteOutcome,
  target: {
    table: "customerAliases",
    id: ({ aliasId }: { aliasId: Id<"customerAliases"> }) => aliasId,
  },
  handler: async (ctx, args) => {
    const context = writeContextOf(ctx, {
      table: "customerAliases",
      operation: "customer.alias.remove",
      requestId: args.requestId,
    });
    const replay = await replayTenantWriteIfPresent({
      ...context,
      fingerprint: args,
    });
    if (!replay.ok) return failure(replay.error.code);
    if (replay.value) {
      return {
        ok: true as const,
        aliasId: replay.value.documentId,
        replayed: true,
      };
    }

    const row = await ctx.tenantDb.get<Doc<"customerAliases">>(
      "customerAliases",
      args.aliasId,
    );
    if (!row) return failure("NOT_FOUND");

    const requestHash = await fingerprintArguments(args);
    if (!requestHash.ok) return failure(requestHash.error.code);

    await ctx.tenantDb.delete("customerAliases", row._id);
    await ctx.tenantDb.insert("auditEvents", {
      occurredAt: context.now,
      actorKind: "USER",
      actorUserId: context.actorUserId,
      action: "customer.alias.remove",
      permissionCode: context.permissionCode,
      entityTable: "customerAliases",
      entityId: row._id,
      outcome: "ALLOWED",
      requestId: context.requestId,
      changes: [
        { field: "customerId", from: row.customerId },
        { field: "alias", from: row.alias },
      ],
    });
    await writeIdempotencyRecord({
      tenantDb: ctx.tenantDb,
      operation: "customer.alias.remove",
      requestId: context.requestId,
      requestHash: requestHash.value,
      resultRef: row._id,
      resultHash: await resultIdentityDigest("customerAliases", row._id),
      actorUserId: context.actorUserId,
      now: context.now,
    });
    await bumpCustomerCatalogueGeneration(ctx.tenantDb);

    return { ok: true as const, aliasId: row._id, replayed: false };
  },
});

export const reviewSummary = queryWithOrg({
  ...readCustomers,
  args: {},
  returns: v.object({
    canViewWarehouseData: v.boolean(),
    canReview: v.boolean(),
    unresolvedNameCount: v.number(),
    unresolvedScanCount: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    const [manageGrants, { allowed, scans, hasMore }] = await Promise.all([
      grantedPermissionsAmong(ctx, [NAVIGATION_PERMISSION.customerManage]),
      readUnresolvedScans(ctx, REVIEW_SCAN_BUDGET),
    ]);
    const canManageCustomers = manageGrants.includes(
      NAVIGATION_PERMISSION.customerManage,
    );
    const names = new Set<string>();
    for (const scan of scans) {
      const key = normalizeCustomerName(scan.customer ?? "");
      if (key) names.add(key);
    }
    return {
      canViewWarehouseData: allowed.hasWarehouseRead,
      canReview: canManageCustomers && allowed.hasWarehouseManage,
      unresolvedNameCount: names.size,
      unresolvedScanCount: scans.length,
      hasMore,
    };
  },
});

export const listUnresolvedNames = queryWithOrg({
  ...readCustomers,
  args: {},
  returns: v.object({
    canViewWarehouseData: v.boolean(),
    canReview: v.boolean(),
    hasMore: v.boolean(),
    groups: v.array(
      v.object({
        normalizedName: v.string(),
        displayName: v.string(),
        scanCount: v.number(),
        latestAt: v.number(),
        warehouses: v.array(
          v.object({
            warehouseId: v.id("warehouses"),
            name: v.string(),
          }),
        ),
        scans: v.array(
          v.object({
            jobScanId: v.id("finishedGoodsJobScans"),
            warehouseId: v.id("warehouses"),
            warehouseName: v.string(),
            factoryOrder: v.string(),
            partName: v.optional(v.string()),
            capturedName: v.string(),
            createdAt: v.number(),
            version: v.number(),
          }),
        ),
        matchKind: v.union(
          v.literal("AMBIGUOUS"),
          v.literal("ARCHIVED"),
          v.literal("SIMILAR"),
          v.literal("NONE"),
        ),
        candidates: v.array(
          v.object({
            customerId: v.id("customers"),
            code: v.string(),
            name: v.string(),
            province: v.optional(v.string()),
            status: customerStatus,
          }),
        ),
      }),
    ),
  }),
  handler: async (ctx) => {
    const [manageGrants, { allowed, scans, hasMore }] = await Promise.all([
      grantedPermissionsAmong(ctx, [NAVIGATION_PERMISSION.customerManage]),
      readUnresolvedScans(ctx, REVIEW_SCAN_BUDGET),
    ]);
    const canManageCustomers = manageGrants.includes(
      NAVIGATION_PERMISSION.customerManage,
    );
    const canReview = canManageCustomers && allowed.hasWarehouseManage;
    if (!allowed.hasWarehouseRead || scans.length === 0) {
      return {
        canViewWarehouseData: allowed.hasWarehouseRead,
        canReview,
        hasMore,
        groups: [],
      };
    }

    const grouped = new Map<
      string,
      {
        displayName: string;
        latestAt: number;
        warehouseIds: Set<Id<"warehouses">>;
        scans: Doc<"finishedGoodsJobScans">[];
      }
    >();
    for (const scan of scans) {
      const captured = scan.customer?.trim();
      if (!captured) continue;
      const key = normalizeCustomerName(captured);
      if (!key) continue;
      let bucket = grouped.get(key);
      if (!bucket) {
        bucket = {
          displayName: captured,
          latestAt: scan.createdAt,
          warehouseIds: new Set(),
          scans: [],
        };
        grouped.set(key, bucket);
      }
      if (scan.createdAt > bucket.latestAt) {
        bucket.latestAt = scan.createdAt;
        bucket.displayName = captured;
      }
      bucket.warehouseIds.add(scan.warehouseId);
      bucket.scans.push(scan);
    }

    // Bounded sample of active customers for compact stem suggestions.
    const activeCustomers = await ctx.tenantDb
      .byIndex<Doc<"customers">>(
        "customers",
        "by_orgId_status_normalizedName",
        [{ field: "status", value: "ACTIVE" }],
      )
      .take(ACTIVE_CUSTOMER_SAMPLE);
    const activeByStem = new Map<string, Doc<"customers">[]>();
    const activeEntries = activeCustomers.map((customer) => ({
      customer,
      stem: compactCustomerStem(customer.name),
      legalThStem: customer.legalNameTh
        ? compactCustomerStem(customer.legalNameTh)
        : "",
      legalEnStem: customer.legalNameEn
        ? compactCustomerStem(customer.legalNameEn)
        : "",
    }));
    for (const entry of activeEntries) {
      for (const stem of new Set(
        [entry.stem, entry.legalThStem, entry.legalEnStem].filter(Boolean),
      )) {
        const list = activeByStem.get(stem) ?? [];
        list.push(entry.customer);
        activeByStem.set(stem, list);
      }
    }

    const groups = await Promise.all(
      [...grouped.entries()].map(async ([normalizedName, bucket]) => {
        const exact = await resolveExactCustomerMatch(
          ctx.tenantDb,
          bucket.displayName,
        );
        let matchKind: "AMBIGUOUS" | "ARCHIVED" | "SIMILAR" | "NONE" = "NONE";
        const candidateDocs: Doc<"customers">[] = [];
        const addedIds = new Set<string>();
        const pushCandidate = (doc: Doc<"customers"> | null) => {
          if (!doc || addedIds.has(doc._id)) return;
          addedIds.add(doc._id);
          candidateDocs.push(doc);
        };

        if (exact.kind === "AMBIGUOUS") {
          matchKind = "AMBIGUOUS";
          const docs = await Promise.all(
            exact.customerIds.map((id) =>
              ctx.tenantDb.get<Doc<"customers">>("customers", id),
            ),
          );
          for (const doc of docs) {
            if (doc?.status === "ACTIVE") pushCandidate(doc);
          }
        } else if (exact.kind === "ARCHIVED") {
          matchKind = "ARCHIVED";
          const archived = await ctx.tenantDb.get<Doc<"customers">>(
            "customers",
            exact.customerId,
          );
          pushCandidate(archived);
        } else if (exact.kind === "MATCHED") {
          // A pre-existing scan whose customer was created later: propose the
          // exact active match so the reviewer can confirm and link it.
          matchKind = "SIMILAR";
          pushCandidate(
            await ctx.tenantDb.get<Doc<"customers">>(
              "customers",
              exact.customerId,
            ),
          );
        }

        if (candidateDocs.length === 0) {
          const stem = compactCustomerStem(bucket.displayName);
          if (stem.length >= 2) {
            const directStemHits = activeByStem.get(stem) ?? [];
            for (const doc of directStemHits) pushCandidate(doc);
            if (candidateDocs.length < 3) {
              for (const entry of activeEntries) {
                if (candidateDocs.length >= 3) break;
                if (addedIds.has(entry.customer._id)) continue;
                const stems = [
                  entry.stem,
                  entry.legalThStem,
                  entry.legalEnStem,
                ].filter((s) => s.length >= 2);
                if (
                  stems.some(
                    (candidateStem) =>
                      candidateStem.includes(stem) ||
                      stem.includes(candidateStem),
                  )
                ) {
                  pushCandidate(entry.customer);
                }
              }
            }
          }
          if (candidateDocs.length > 0) {
            matchKind = candidateDocs.length > 1 ? "AMBIGUOUS" : "SIMILAR";
          }
        }

        return {
          normalizedName,
          displayName: bucket.displayName,
          scanCount: bucket.scans.length,
          latestAt: bucket.latestAt,
          warehouses: [...bucket.warehouseIds]
            .map((warehouseId) => ({
              warehouseId,
              name: allowed.byId.get(warehouseId)?.name ?? "",
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          scans: bucket.scans.slice(0, MAX_RESOLVE_SCANS).map((scan) => ({
            jobScanId: scan._id,
            warehouseId: scan.warehouseId,
            warehouseName: allowed.byId.get(scan.warehouseId)?.name ?? "",
            factoryOrder: scan.factoryOrder,
            ...(scan.partName === undefined ? {} : { partName: scan.partName }),
            capturedName: scan.customer?.trim() ?? bucket.displayName,
            createdAt: scan.createdAt,
            version: scan.version ?? 1,
          })),
          matchKind,
          candidates: candidateDocs
            .slice(0, 5)
            .map(({ _id, code, name, status, deliveryAddress }) => ({
              customerId: _id,
              code,
              name,
              status,
              ...(deliveryAddress?.province === undefined
                ? {}
                : { province: deliveryAddress.province }),
            })),
        };
      }),
    );

    groups.sort((a, b) => b.scanCount - a.scanCount || b.latestAt - a.latestAt);

    return {
      canViewWarehouseData: true,
      canReview,
      hasMore,
      groups,
    };
  },
});

export const resolveUnresolvedScans = mutationWithOrg({
  writer: inventoryWriter,
  permissionCode: NAVIGATION_PERMISSION.customerManage,
  args: {
    requestId: v.string(),
    action: v.union(v.literal("LINK"), v.literal("SKIP")),
    customerId: v.optional(v.id("customers")),
    rememberAlias: v.optional(v.boolean()),
    aliasText: v.optional(v.string()),
    scans: v.array(
      v.object({
        jobScanId: v.id("finishedGoodsJobScans"),
        expectedVersion: v.number(),
      }),
    ),
  },
  returns: resolveOutcome,
  target: { table: "finishedGoodsJobScans" },
  handler: async (ctx, args) => {
    const context = writeContextOf(ctx, {
      table: "finishedGoodsJobScans",
      operation: "customer.review.resolve",
      requestId: args.requestId,
    });
    const replay = await replayTenantWriteIfPresent({
      ...context,
      fingerprint: args,
    });
    if (!replay.ok) return failure(replay.error.code);
    if (replay.value) {
      return {
        ok: true as const,
        updatedCount: args.scans.length,
        replayed: true,
      };
    }

    if (args.scans.length === 0 || args.scans.length > MAX_RESOLVE_SCANS)
      return failure("SCAN_GROUP_SIZE_INVALID");

    const allowed = await allowedCustomerWarehouses(ctx);
    if (!allowed.hasWarehouseManage) return failure("ACCESS_DENIED");

    // Validate target customer and optional alias before touching any scan.
    let targetCustomer: Doc<"customers"> | null = null;
    if (args.action === "LINK") {
      if (!args.customerId) return failure("FIELD_INVALID", "customerId");
      targetCustomer = await ctx.tenantDb.get<Doc<"customers">>(
        "customers",
        args.customerId,
      );
      if (!targetCustomer) return failure("NOT_FOUND", "customerId");
      if (targetCustomer.status === "ARCHIVED")
        return failure("CUSTOMER_ARCHIVED", "customerId");
    }

    let validatedAlias: { alias: string; normalizedAlias: string } | null =
      null;
    if (args.action === "LINK" && args.rememberAlias === true) {
      const rawAlias = args.aliasText ?? "";
      const parsed = validateCustomerAlias(rawAlias);
      if (!parsed.ok) return failure(parsed.error.code, "aliasText");
      validatedAlias = parsed.value;
    }

    const seenIds = new Set<string>();
    const loadedScans: Doc<"finishedGoodsJobScans">[] = [];
    for (const item of args.scans) {
      if (seenIds.has(item.jobScanId))
        return failure("SCAN_GROUP_SIZE_INVALID");
      seenIds.add(item.jobScanId);
      const scan = await ctx.tenantDb.get<Doc<"finishedGoodsJobScans">>(
        "finishedGoodsJobScans",
        item.jobScanId,
      );
      if (!scan || scan.voided) return failure("NOT_FOUND");
      if (!allowed.byId.has(scan.warehouseId)) return failure("ACCESS_DENIED");
      const currentVersion = scan.version ?? 1;
      if (
        !Number.isSafeInteger(item.expectedVersion) ||
        item.expectedVersion !== currentVersion
      )
        return failure("STALE_REVISION");
      loadedScans.push(scan);
    }

    const requestHash = await fingerprintArguments(args);
    if (!requestHash.ok) return failure(requestHash.error.code);

    for (const scan of loadedScans) {
      const now = Math.max(context.now, scan.updatedAt + 1);
      await ctx.tenantDb.patch("finishedGoodsJobScans", scan._id, {
        customerId: targetCustomer?._id,
        customerLinkSource: args.action === "LINK" ? "MANUAL" : "UNLINKED",
        version: (scan.version ?? 1) + 1,
        updatedAt: now,
        updatedByUserId: context.actorUserId,
      });
    }

    let aliasId: string | undefined;
    if (targetCustomer && validatedAlias) {
      const existing = await ctx.tenantDb
        .byIndex<Doc<"customerAliases">>(
          "customerAliases",
          "by_orgId_customerId_normalizedAlias",
          [
            { field: "customerId", value: targetCustomer._id },
            { field: "normalizedAlias", value: validatedAlias.normalizedAlias },
          ],
        )
        .unique();
      if (existing) {
        aliasId = existing._id;
      } else {
        aliasId = await ctx.tenantDb.insert("customerAliases", {
          customerId: targetCustomer._id,
          alias: validatedAlias.alias,
          normalizedAlias: validatedAlias.normalizedAlias,
          exampleJobScanId: loadedScans[0]!._id,
          approvedAt: context.now,
          approvedByUserId: context.actorUserId,
        });
        await bumpCustomerCatalogueGeneration(ctx.tenantDb);
      }
    }

    const firstId = loadedScans[0]!._id;
    await ctx.tenantDb.insert("auditEvents", {
      occurredAt: context.now,
      actorKind: "USER",
      actorUserId: context.actorUserId,
      action:
        args.action === "LINK"
          ? "customer.review.link"
          : "customer.review.skip",
      permissionCode: context.permissionCode,
      entityTable: "finishedGoodsJobScans",
      entityId: firstId,
      warehouseId: loadedScans[0]!.warehouseId,
      outcome: "ALLOWED",
      requestId: context.requestId,
      changes: [
        { field: "scanCount", to: String(loadedScans.length) },
        ...(targetCustomer
          ? [{ field: "customerId", to: targetCustomer._id }]
          : []),
        ...(aliasId ? [{ field: "aliasId", to: aliasId }] : []),
      ],
    });
    await writeIdempotencyRecord({
      tenantDb: ctx.tenantDb,
      operation: "customer.review.resolve",
      requestId: context.requestId,
      requestHash: requestHash.value,
      resultRef: firstId,
      resultHash: await resultIdentityDigest("finishedGoodsJobScans", firstId),
      actorUserId: context.actorUserId,
      now: context.now,
    });

    return {
      ok: true as const,
      updatedCount: loadedScans.length,
      ...(aliasId === undefined ? {} : { aliasId }),
      replayed: false,
    };
  },
});
