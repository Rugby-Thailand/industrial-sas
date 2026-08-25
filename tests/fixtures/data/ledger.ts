import {
  encodeBucketKey,
  type InventoryBucket,
  type StockStatus,
} from "../../../convex/model/inventory/stockIdentity";
import type {
  BalanceRow,
  LedgerPage,
  TransactionRow,
} from "@/lib/convex/ledgerApi";

export const PREVIEW_ORG_ID = "prv_org_siam_industrial";

export interface PreviewWarehouse {
  readonly id: string;
  readonly code: string;

  readonly nameTh: string;
  readonly nameEn: string;
}

export const PREVIEW_WAREHOUSES: readonly PreviewWarehouse[] = Object.freeze([
  Object.freeze({
    id: "prv_wh_bangpoo",
    code: "BPU",
    nameTh: "คลังบางปู",
    nameEn: "Bang Pu plant store",
  }),
  Object.freeze({
    id: "prv_wh_lamphun",
    code: "LPN",
    nameTh: "คลังลำพูน",
    nameEn: "Lamphun finished goods",
  }),
]);

interface PreviewBalanceSeed {
  readonly warehouseId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly lotId?: string;
  readonly stockStatus: StockStatus;
  readonly uom: string;
  readonly minorUnits: number;
}

const BALANCE_SEEDS: readonly PreviewBalanceSeed[] = Object.freeze([
  {
    warehouseId: "prv_wh_bangpoo",
    itemId: "prv_item_steel_coil",
    locationId: "prv_loc_A01-02-1",
    lotId: "prv_lot_2608A",
    stockStatus: "AVAILABLE",
    uom: "KG",
    minorUnits: 18_450_500,
  },
  {
    warehouseId: "prv_wh_bangpoo",
    itemId: "prv_item_steel_coil",
    locationId: "prv_loc_A01-02-1",
    lotId: "prv_lot_2607B",
    stockStatus: "QC_HOLD",
    uom: "KG",
    minorUnits: 2_000_000,
  },
  {
    warehouseId: "prv_wh_bangpoo",
    itemId: "prv_item_bolt_m8",
    locationId: "prv_loc_B04-11-3",
    lotId: "prv_lot_2606X",
    stockStatus: "AVAILABLE",
    uom: "EA",
    minorUnits: 12_400_000,
  },
  {
    warehouseId: "prv_wh_bangpoo",
    itemId: "prv_item_resin_hd",
    locationId: "prv_loc_C02-01-2",
    lotId: "prv_lot_2605R",
    stockStatus: "QUARANTINE",
    uom: "L",
    minorUnits: 750_250,
  },
  {
    warehouseId: "prv_wh_bangpoo",
    itemId: "prv_item_resin_hd",
    locationId: "prv_loc_C02-01-2",
    lotId: "prv_lot_2604R",
    stockStatus: "EXPIRED",
    uom: "L",
    minorUnits: 41_000,
  },
  {
    warehouseId: "prv_wh_bangpoo",
    itemId: "prv_item_carton_a",
    locationId: "prv_loc_D01-01-1",
    stockStatus: "AVAILABLE",
    uom: "EA",
    minorUnits: 0,
  },
  {
    warehouseId: "prv_wh_lamphun",
    itemId: "prv_item_module_x",
    locationId: "prv_loc_F01-03-2",
    lotId: "prv_lot_2608M",
    stockStatus: "AVAILABLE",
    uom: "EA",
    minorUnits: 3_120_000,
  },
  {
    warehouseId: "prv_wh_lamphun",
    itemId: "prv_item_module_x",
    locationId: "prv_loc_F01-03-2",
    lotId: "prv_lot_2608N",
    stockStatus: "REJECTED",
    uom: "EA",
    minorUnits: 17_000,
  },
]);

const bucketOf = (seed: PreviewBalanceSeed): InventoryBucket => ({
  orgId: PREVIEW_ORG_ID,
  warehouseId: seed.warehouseId,
  itemId: seed.itemId,
  location: { kind: "PHYSICAL", locationId: seed.locationId },
  ...(seed.lotId === undefined ? {} : { lotId: seed.lotId }),
  stockStatus: seed.stockStatus,
});

interface PlacedRow<Row> {
  readonly warehouseId: string;
  readonly row: Row;
}

const PLACED_BALANCES: readonly PlacedRow<BalanceRow>[] = Object.freeze(
  BALANCE_SEEDS.flatMap((seed) => {
    const key = encodeBucketKey(bucketOf(seed));
    if (!key.ok) return [];
    return [
      Object.freeze({
        warehouseId: seed.warehouseId,
        row: Object.freeze({
          bucketKey: key.value,
          stockStatus: seed.stockStatus,
          uom: seed.uom,
          minorUnits: seed.minorUnits,
        }),
      }),
    ];
  }),
);

export const PREVIEW_BALANCES: readonly BalanceRow[] = Object.freeze(
  PLACED_BALANCES.map((placed) => placed.row),
);

const PREVIEW_ANCHOR_MS = 1_786_414_500_000;

const MINUTE_MS = 60_000;

interface PreviewTransactionSeed {
  readonly warehouseId: string;
  readonly suffix: string;
  readonly type: string;
  readonly operation: string;
  readonly minutesBeforeAnchor: number;
  readonly businessDate: string;
  readonly lineCount: number;
  readonly reversalOfSuffix?: string;
}

const TRANSACTION_SEEDS: readonly PreviewTransactionSeed[] = Object.freeze([
  {
    warehouseId: "prv_wh_bangpoo",
    suffix: "0191f2c1",
    type: "RECEIPT",
    operation: "inventory.transaction.post",
    minutesBeforeAnchor: 0,
    businessDate: "2026-08-11",
    lineCount: 4,
  },
  {
    warehouseId: "prv_wh_bangpoo",
    suffix: "0191f2b7",
    type: "PUTAWAY",
    operation: "inventory.transaction.post",
    minutesBeforeAnchor: 22,
    businessDate: "2026-08-11",
    lineCount: 2,
  },
  {
    warehouseId: "prv_wh_bangpoo",
    suffix: "0191f2a3",
    type: "STATUS_CHANGE",
    operation: "inventory.transaction.post",
    minutesBeforeAnchor: 95,
    businessDate: "2026-08-11",
    lineCount: 2,
  },
  {
    warehouseId: "prv_wh_bangpoo",
    suffix: "0191f28e",
    type: "RECEIPT",
    operation: "inventory.transaction.post",
    minutesBeforeAnchor: 640,
    businessDate: "2026-08-10",
    lineCount: 6,
  },
  {
    warehouseId: "prv_wh_bangpoo",
    suffix: "0191f27c",
    type: "REVERSAL",
    operation: "inventory.transaction.reverse",
    minutesBeforeAnchor: 610,
    businessDate: "2026-08-10",
    lineCount: 6,
    reversalOfSuffix: "0191f28e",
  },
  {
    warehouseId: "prv_wh_lamphun",
    suffix: "0191f25a",
    type: "PRODUCTION_RECEIPT",
    operation: "inventory.transaction.post",
    minutesBeforeAnchor: 180,
    businessDate: "2026-08-11",
    lineCount: 2,
  },
  {
    warehouseId: "prv_wh_lamphun",
    suffix: "0191f241",
    type: "ADJUSTMENT",
    operation: "inventory.transaction.post",
    minutesBeforeAnchor: 1_500,
    businessDate: "2026-08-10",
    lineCount: 2,
  },
]);

const transactionIdOf = (suffix: string): string => `prv_txn_${suffix}`;

const PLACED_TRANSACTIONS: readonly PlacedRow<TransactionRow>[] = Object.freeze(
  TRANSACTION_SEEDS.map((seed) =>
    Object.freeze({
      warehouseId: seed.warehouseId,
      row: Object.freeze({
        transactionId: transactionIdOf(seed.suffix),
        type: seed.type,
        operation: seed.operation,
        requestId: `prv_req_${seed.suffix}`,
        occurredAt: PREVIEW_ANCHOR_MS - seed.minutesBeforeAnchor * MINUTE_MS,
        businessDate: seed.businessDate,
        lineCount: seed.lineCount,
        ...(seed.reversalOfSuffix === undefined
          ? {}
          : {
              reversalOfTransactionId: transactionIdOf(seed.reversalOfSuffix),
            }),
      }),
    }),
  ),
);

export const PREVIEW_TRANSACTIONS: readonly TransactionRow[] = Object.freeze(
  PLACED_TRANSACTIONS.map((placed) => placed.row),
);

export function previewPage<Row>(
  rows: readonly Row[],
  maxPageSize: number,
  cursor: string | undefined,
): LedgerPage<Row> {
  const offset =
    cursor === undefined ? 0 : /^\d+$/.test(cursor) ? Number(cursor) : -1;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > rows.length) {
    return { ok: false, error: { code: "CURSOR_INVALID", reason: "OFFSET" } };
  }
  const size = Math.max(1, Math.trunc(maxPageSize));
  const items = rows.slice(offset, offset + size);
  const next = offset + items.length;
  const complete = next >= rows.length;
  return {
    ok: true,
    items,
    nextCursor: complete ? null : String(next),
    complete,
  };
}

const rowsIn = <Row>(
  placed: readonly PlacedRow<Row>[],
  warehouseId: string,
): readonly Row[] =>
  placed
    .filter((candidate) => candidate.warehouseId === warehouseId)
    .map((candidate) => candidate.row);

export const previewBalancesFor = (
  warehouseId: string,
): readonly BalanceRow[] => rowsIn(PLACED_BALANCES, warehouseId);

export const previewTransactionsFor = (
  warehouseId: string,
): readonly TransactionRow[] =>
  [...rowsIn(PLACED_TRANSACTIONS, warehouseId)].sort(
    (left, right) => right.occurredAt - left.occurredAt,
  );
