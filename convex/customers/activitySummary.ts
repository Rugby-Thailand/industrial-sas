import type { Doc, Id } from "../_generated/dataModel";
import {
  TENANT_INDEX_MAX_PAGE_SIZE,
  type TenantDocumentAccess,
} from "../lib/tenantDb";

const MAX_ALIAS_SEARCH_TEXT = 16_000;

/**
 * Single source of truth for whether a job scan belongs in the "Names to
 * review" queue: non-voided, named, and without any link or skip decision.
 */
export function isReviewPendingScan(scan: {
  readonly voided?: true | undefined;
  readonly customer?: string | undefined;
  readonly customerId?: Id<"customers"> | undefined;
  readonly customerLinkSource?: "AUTO" | "MANUAL" | "UNLINKED" | undefined;
}): boolean {
  return (
    scan.voided !== true &&
    scan.customerId === undefined &&
    scan.customerLinkSource === undefined &&
    Boolean(scan.customer?.trim())
  );
}

/**
 * Maintain `customers.aliasSearchText` incrementally so `listCustomersPage`
 * matches any alias substring with zero extra reads and without calling
 * `.paginate()` inside mutations (Convex allows at most one paginated query
 * per function).
 */
export async function addCustomerAliasToSearchText(
  tenantDb: TenantDocumentAccess,
  customerId: Id<"customers">,
  normalizedAlias: string,
): Promise<void> {
  const customer = await tenantDb.get<Doc<"customers">>(
    "customers",
    customerId,
  );
  if (!customer) return;

  const existingLines = customer.aliasSearchText
    ? customer.aliasSearchText.split("\n").filter(Boolean)
    : (
        await tenantDb
          .byIndex<Doc<"customerAliases">>(
            "customerAliases",
            "by_orgId_customerId_normalizedAlias",
            [{ field: "customerId", value: customerId }],
          )
          .take(TENANT_INDEX_MAX_PAGE_SIZE)
      ).map((row) => row.normalizedAlias);

  const unique = new Set(existingLines);
  unique.add(normalizedAlias);

  const kept: string[] = [];
  let totalChars = 0;
  for (const line of unique) {
    if (totalChars + line.length + 1 > MAX_ALIAS_SEARCH_TEXT) break;
    kept.push(line);
    totalChars += line.length + 1;
  }
  const next = kept.length > 0 ? kept.join("\n") : undefined;
  if (customer.aliasSearchText !== next) {
    await tenantDb.patch("customers", customerId, { aliasSearchText: next });
  }
}

export async function removeCustomerAliasFromSearchText(
  tenantDb: TenantDocumentAccess,
  customerId: Id<"customers">,
  removedNormalizedAlias: string,
): Promise<void> {
  const customer = await tenantDb.get<Doc<"customers">>(
    "customers",
    customerId,
  );
  if (!customer) return;

  const existingLines = customer.aliasSearchText
    ? customer.aliasSearchText
        .split("\n")
        .filter((line) => line.length > 0 && line !== removedNormalizedAlias)
    : (
        await tenantDb
          .byIndex<Doc<"customerAliases">>(
            "customerAliases",
            "by_orgId_customerId_normalizedAlias",
            [{ field: "customerId", value: customerId }],
          )
          .take(TENANT_INDEX_MAX_PAGE_SIZE)
      )
        .map((row) => row.normalizedAlias)
        .filter((line) => line !== removedNormalizedAlias);

  const next = existingLines.length > 0 ? existingLines.join("\n") : undefined;
  if (customer.aliasSearchText !== next) {
    await tenantDb.patch("customers", customerId, { aliasSearchText: next });
  }
}

async function getActivityRow(
  tenantDb: TenantDocumentAccess,
  warehouseId: Id<"warehouses">,
  customerId: Id<"customers">,
): Promise<Doc<"customerWarehouseActivity"> | null> {
  return tenantDb
    .byIndex<Doc<"customerWarehouseActivity">>(
      "customerWarehouseActivity",
      "by_orgId_customerId_warehouseId",
      [
        { field: "customerId", value: customerId },
        { field: "warehouseId", value: warehouseId },
      ],
    )
    .unique();
}

/** Increment or decrement the linked product count for one (customer, warehouse). */
export async function adjustCustomerProductCount(
  tenantDb: TenantDocumentAccess,
  warehouseId: Id<"warehouses">,
  customerId: Id<"customers">,
  delta: 1 | -1,
): Promise<void> {
  const existing = await getActivityRow(tenantDb, warehouseId, customerId);
  if (!existing) {
    if (delta <= 0) return;
    await tenantDb.insert("customerWarehouseActivity", {
      warehouseId,
      customerId,
      linkedProductCount: delta,
    });
    return;
  }
  const nextCount = Math.max(0, existing.linkedProductCount + delta);
  if (nextCount === 0 && existing.latestJobScanId === undefined) {
    await tenantDb.delete("customerWarehouseActivity", existing._id);
    return;
  }
  await tenantDb.patch("customerWarehouseActivity", existing._id, {
    linkedProductCount: nextCount,
  });
}

/** Fast O(1) latest-job update when a non-voided scan is linked to a customer. */
export async function recordCustomerJobLink(
  tenantDb: TenantDocumentAccess,
  warehouseId: Id<"warehouses">,
  customerId: Id<"customers">,
  scan: {
    readonly jobScanId: Id<"finishedGoodsJobScans">;
    readonly factoryOrder: string;
    readonly createdAt: number;
  },
): Promise<void> {
  const existing = await getActivityRow(tenantDb, warehouseId, customerId);
  if (!existing) {
    await tenantDb.insert("customerWarehouseActivity", {
      warehouseId,
      customerId,
      linkedProductCount: 0,
      latestJobScanId: scan.jobScanId,
      latestJobFactoryOrder: scan.factoryOrder,
      latestJobCreatedAt: scan.createdAt,
    });
    return;
  }
  if (
    existing.latestJobCreatedAt === undefined ||
    scan.createdAt >= existing.latestJobCreatedAt
  ) {
    await tenantDb.patch("customerWarehouseActivity", existing._id, {
      latestJobScanId: scan.jobScanId,
      latestJobFactoryOrder: scan.factoryOrder,
      latestJobCreatedAt: scan.createdAt,
    });
  }
}

/**
 * Recompute the latest non-voided job scan for one (customer, warehouse) when
 * a scan is unlinked, reassigned, deleted, or its factoryOrder changes.
 */
export async function refreshCustomerLatestJob(
  tenantDb: TenantDocumentAccess,
  warehouseId: Id<"warehouses">,
  customerId: Id<"customers">,
): Promise<void> {
  const existing = await getActivityRow(tenantDb, warehouseId, customerId);
  const recent = await tenantDb
    .byIndex<Doc<"finishedGoodsJobScans">>(
      "finishedGoodsJobScans",
      "by_orgId_warehouseId_customerId_createdAt",
      [
        { field: "warehouseId", value: warehouseId },
        { field: "customerId", value: customerId },
      ],
    )
    .take(25, "desc");
  const latest = recent.find((scan) => !scan.voided);

  if (!latest) {
    if (!existing) return;
    if (existing.linkedProductCount === 0) {
      await tenantDb.delete("customerWarehouseActivity", existing._id);
    } else {
      await tenantDb.patch("customerWarehouseActivity", existing._id, {
        latestJobScanId: undefined,
        latestJobFactoryOrder: undefined,
        latestJobCreatedAt: undefined,
      });
    }
    return;
  }

  if (!existing) {
    await tenantDb.insert("customerWarehouseActivity", {
      warehouseId,
      customerId,
      linkedProductCount: 0,
      latestJobScanId: latest._id,
      latestJobFactoryOrder: latest.factoryOrder,
      latestJobCreatedAt: latest.createdAt,
    });
    return;
  }
  await tenantDb.patch("customerWarehouseActivity", existing._id, {
    latestJobScanId: latest._id,
    latestJobFactoryOrder: latest.factoryOrder,
    latestJobCreatedAt: latest.createdAt,
  });
}
