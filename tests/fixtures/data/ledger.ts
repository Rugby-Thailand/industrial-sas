/**
 * Synthetic ledger data for local development, in the server's own wire shapes.
 *
 * ### What this is for, and what it must never become
 *
 * The screens in this milestone read a Convex deployment that, with no identity
 * provider configured, denies every request. That is the honest state and it is
 * also uninformative: a table that only ever renders "sign-in required" cannot
 * show whether Thai copy wraps, whether a quantity column lines up, or whether a
 * page of a hundred rows is legible on a handheld. This module supplies rows for
 * exactly that purpose.
 *
 * It is not a fake backend. It has no authorization, no tenant resolution, and
 * no writes; it cannot post a transaction, and no production build can reach it
 * (`resolveAppEnvironment` — reach, not *contain*: these rows are still shipped
 * as unreachable code, which is why every identifier here carries a `prv_`
 * prefix and nothing here is sensitive). Every screen that renders it also
 * renders a banner saying so.
 *
 * ### Why the keys are real
 *
 * The bucket keys are produced by `encodeBucketKey`, the same encoder the ledger
 * store uses, rather than by string concatenation. A hand-written key that looked
 * plausible would hide exactly the defect worth catching early — a truncation, a
 * separator, a column too narrow for the real thing. A key that fails to encode
 * is dropped rather than substituted, and `ledgerPreview.test.ts` asserts the
 * dataset is non-empty, so a dropped key fails the build instead of thinning the
 * table silently.
 *
 * ### Why every value is a constant
 *
 * No `Math.random`, no `Date.now`. Rows are identical on the server and the
 * client, so hydration matches; identical between two runs, so a screenshot diff
 * means something; and identical in tests, so an assertion can name a row.
 */
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

/** The synthetic tenant. `prv_` prefixes make a leaked value obvious in a log. */
export const PREVIEW_ORG_ID = "prv_org_siam_industrial";

export interface PreviewWarehouse {
  readonly id: string;
  readonly code: string;
  /** Thai name — the layout baseline is Thai, so the fixture is too. */
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

/** One synthetic balance, before it is turned into a wire row. */
interface PreviewBalanceSeed {
  readonly warehouseId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly lotId?: string;
  readonly stockStatus: StockStatus;
  readonly uom: string;
  readonly minorUnits: number;
}

/*
 * Deliberate variety, because each row proves something a uniform fixture
 * cannot: four stock statuses (so the status column is exercised, and
 * `INV-0010-07` — no colour-only state — is visible), three unit codes of
 * different widths, a quantity with a non-zero fraction, a quantity large enough
 * to test column width, and a zero balance (a real and common row: stock that
 * moved out of a bucket leaves the bucket behind).
 */
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

/** A row together with the warehouse it belongs to, so scoping needs no parsing. */
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

/**
 * Every synthetic balance row.
 *
 * A seed whose bucket the real encoder refuses is dropped rather than
 * substituted. That can only happen if a seed above is edited into an illegal
 * shape, and `ledgerPreview.test.ts` asserts the exact row count, so the drop is
 * a failing test rather than a quietly shorter table.
 */
export const PREVIEW_BALANCES: readonly BalanceRow[] = Object.freeze(
  PLACED_BALANCES.map((placed) => placed.row),
);

/**
 * A fixed instant the transaction fixture is built backwards from:
 * `2026-08-11T09:15:00+07:00`, a plausible mid-morning receiving shift in
 * Bangkok. Written as an epoch constant rather than parsed from a string so this
 * module has no dependency on the host's date parsing.
 */
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

/*
 * The last transaction reverses the third (`INV-0003-08`): the original is
 * untouched and the correction names it. That pairing is the one thing a history
 * screen must not render as an edit, so the fixture contains it from the start.
 */
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

/**
 * Page a synthetic collection the way the server pages a real one.
 *
 * The cursor is the offset as a string, which is not what the server's cursor is
 * — but the *contract* is the same one the screens have to satisfy: an opaque
 * token, `null` when there is no more, and a `complete` flag that is not the same
 * question as "was this page full". Reimplementing the shape here is what lets
 * the pagination controls be exercised without a deployment.
 */
export function previewPage<Row>(
  rows: readonly Row[],
  maxPageSize: number,
  cursor: string | undefined,
): LedgerPage<Row> {
  /*
   * `Number.parseInt` is deliberately not used: it reads `"1.5"` as `1` and
   * `"2abc"` as `2`, so a malformed cursor would silently page from somewhere
   * plausible. A cursor is an opaque token, and a token this module did not
   * mint is a refusal.
   */
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

/** Synthetic balances for one warehouse, in declaration order. */
export const previewBalancesFor = (
  warehouseId: string,
): readonly BalanceRow[] => rowsIn(PLACED_BALANCES, warehouseId);

/**
 * Synthetic transactions for one warehouse, newest first.
 *
 * Sorted rather than assumed: `listTransactions` reads a descending index, and a
 * fixture whose order came from how the seeds happened to be typed would let a
 * screen that ignores order look correct.
 */
export const previewTransactionsFor = (
  warehouseId: string,
): readonly TransactionRow[] =>
  [...rowsIn(PLACED_TRANSACTIONS, warehouseId)].sort(
    (left, right) => right.occurredAt - left.occurredAt,
  );
