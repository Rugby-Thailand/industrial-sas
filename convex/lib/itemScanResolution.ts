/**
 * Resolve the item named by a keyboard-wedge or manually entered scan.
 *
 * This is database-facing infrastructure rather than UI parsing: the catalogue
 * query and every mutation that records item evidence must use the same
 * tenant-bound, active-only answer. Keeping it here prevents a client from
 * resolving one item for display while a write records an unchecked string.
 */
import type { TenantDocumentAccess, TenantOrgId } from "./tenantDb";

interface ItemDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly sku: string;
  readonly name: string;
  readonly status: string;
}

interface BarcodeDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly itemId: string;
  readonly barcode: string;
  readonly status: string;
}

export type ItemScanResolution =
  | {
      readonly found: true;
      readonly normalizedScan: string;
      readonly itemId: string;
      readonly sku: string;
      readonly name: string;
      readonly via: "BARCODE" | "SKU";
    }
  | {
      readonly found: false;
      readonly normalizedScan: string;
      readonly reason: "EMPTY_SCAN" | "UNKNOWN_SCAN";
    };

/** Normalize once before lookup, fingerprinting, persistence, and comparison. */
export const normalizeItemScan = (scan: string): string =>
  scan.trim().normalize("NFC").toUpperCase();

export async function resolveItemScan(
  tenantDb: TenantDocumentAccess,
  rawScan: string,
): Promise<ItemScanResolution> {
  const scan = normalizeItemScan(rawScan);
  if (scan === "") {
    return { found: false, normalizedScan: scan, reason: "EMPTY_SCAN" };
  }

  const answer = (
    item: ItemDocument | null,
    via: "BARCODE" | "SKU",
  ): ItemScanResolution | null =>
    item === null || item.status !== "ACTIVE"
      ? null
      : {
          found: true,
          normalizedScan: scan,
          itemId: item._id,
          sku: item.sku,
          name: item.name,
          via,
        };

  const barcode = await tenantDb
    .byIndex<BarcodeDocument>("itemBarcodes", "by_orgId_barcode", [
      { field: "barcode", value: scan },
    ])
    .unique();

  if (barcode !== null && barcode.status === "ACTIVE") {
    const viaBarcode = answer(
      await tenantDb.get<ItemDocument>("items", barcode.itemId),
      "BARCODE",
    );
    if (viaBarcode !== null) return viaBarcode;
  }

  const bySku = await tenantDb
    .byIndex<ItemDocument>("items", "by_orgId_sku", [
      { field: "sku", value: scan },
    ])
    .unique();

  return (
    answer(bySku, "SKU") ?? {
      found: false,
      normalizedScan: scan,
      reason: "UNKNOWN_SCAN",
    }
  );
}
