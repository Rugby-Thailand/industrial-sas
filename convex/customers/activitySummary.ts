import type { Doc, Id } from "../_generated/dataModel";
import type { TenantDocumentAccess } from "../lib/tenantDb";

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
 * Stored `customerReviewPending` value: `true` for a ticket waiting in review,
 * `false` for an undecided ticket with nothing to review (blank or voided), so
 * it leaves the legacy stream, and `undefined` once a link decision exists.
 */
export function customerReviewState(
  scan: Parameters<typeof isReviewPendingScan>[0],
): boolean | undefined {
  if (isReviewPendingScan(scan)) return true;
  return scan.customerId === undefined && scan.customerLinkSource === undefined
    ? false
    : undefined;
}

/** Alias rows and their search text are written together in each mutation. */
export function appendSearchableAlias(
  customer: Doc<"customers">,
  normalizedAlias: string,
): string | null {
  const next = customer.aliasSearchText
    ? `${customer.aliasSearchText}\n${normalizedAlias}`
    : normalizedAlias;
  return next.length <= MAX_ALIAS_SEARCH_TEXT ? next : null;
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
  if (!customer?.aliasSearchText) return;
  const next = customer.aliasSearchText
    .split("\n")
    .filter((line) => line !== removedNormalizedAlias)
    .join("\n");
  await tenantDb.patch("customers", customerId, {
    aliasSearchText: next || undefined,
  });
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
  // Exact in one read: the index fixes `voided` as missing, so any number of
  // newer voided scans can never hide the latest live one.
  const [latest] = await tenantDb
    .byIndex<Doc<"finishedGoodsJobScans">>(
      "finishedGoodsJobScans",
      "by_orgId_warehouseId_customerId_voided_createdAt",
      [
        { field: "warehouseId", value: warehouseId },
        { field: "customerId", value: customerId },
        { field: "voided", value: undefined, missing: true },
      ],
    )
    .take(1, "desc");

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
