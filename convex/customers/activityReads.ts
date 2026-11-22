import type { Doc, Id } from "../_generated/dataModel";
import {
  TENANT_INDEX_MAX_CURSOR_LENGTH,
  TENANT_INDEX_MAX_PAGE_SIZE,
  type TenantIndexReader,
} from "../lib/tenantDb";
import type { TenantFunctionContext } from "../lib/tenantFunctions";
import { allowedCustomerWarehouses } from "./warehouseScope";

/** Bounded keyset reads for the internal activity summary scan. */
export type ScanKey = string | number;

/** Resume point: last consumed key plus IDs already consumed at that key. */
export interface ScanPosition {
  readonly k: ScanKey;
  readonly ids: readonly string[];
}

/** Rows (documents, or document-read equivalents) a request may still spend. */
export interface ScanBudget {
  remaining: number;
}

export interface ScanResult<R> {
  readonly items: { readonly item: R; readonly position: ScanPosition }[];
  /** The index range was read to its end. */
  readonly done: boolean;
  /** Where to continue when not done; absent before the first row. */
  readonly position?: ScanPosition;
}

/**
 * Visit rows in index order from `start` (inclusive of its key, skipping its
 * consumed IDs), accepting until `want` items, the end of the range, or the
 * budget. `readBatch(bound, limit)` must return rows ordered by `key` whose key
 * is at or past `bound` (inclusive) in the scan direction.
 */
export async function scanVisible<T extends { readonly _id: string }, R>({
  readBatch,
  key,
  accept,
  want,
  budget,
  start,
}: {
  readonly readBatch: (
    bound: ScanKey | undefined,
    limit: number,
  ) => Promise<readonly T[]>;
  readonly key: (row: T) => ScanKey;
  readonly accept: (row: T) => Promise<R | null>;
  readonly want: number;
  readonly budget: ScanBudget;
  readonly start?: ScanPosition | undefined;
}): Promise<ScanResult<R>> {
  const items: { item: R; position: ScanPosition }[] = [];
  let bound = start?.k;
  let idsAtBound = new Set(start?.ids ?? []);
  const position = (): ScanPosition | undefined =>
    bound === undefined ? undefined : { k: bound, ids: [...idsAtBound] };

  for (let batch = 0; ; batch += 1) {
    if (budget.remaining <= 0) {
      return { items, done: false, ...withPosition(position()) };
    }
    // Dense ranges read only what is wanted (plus the consumed ties at a
    // resumed bound); once rows were filtered out, read full batches.
    const need =
      batch === 0
        ? want - items.length + idsAtBound.size
        : Number.POSITIVE_INFINITY;
    const limit = Math.min(TENANT_INDEX_MAX_PAGE_SIZE, budget.remaining, need);
    const rows = await readBatch(bound, limit);
    budget.remaining -= rows.length;
    let advanced = false;
    for (const row of rows) {
      const rowKey = key(row);
      if (rowKey === bound) {
        if (idsAtBound.has(row._id)) continue;
      } else {
        bound = rowKey;
        idsAtBound = new Set();
      }
      idsAtBound.add(row._id);
      advanced = true;
      const accepted = await accept(row);
      if (accepted !== null) {
        items.push({ item: accepted, position: position()! });
        if (items.length >= want) {
          return { items, done: false, ...withPosition(position()) };
        }
      }
    }
    if (rows.length < limit) return { items, done: true };
    // A full batch of already-consumed ties cannot advance an inclusive bound.
    if (!advanced) return { items, done: false, ...withPosition(position()) };
  }
}

function withPosition(position: ScanPosition | undefined) {
  return position === undefined ? {} : { position };
}

interface WarehousePagePosition {
  readonly customerId: string;
  readonly key: string;
  readonly warehouseId?: string;
  readonly nativeCursor?: string;
}

function warehousePagePosition(raw: string | undefined, customerId: string) {
  if (!raw) return undefined;
  try {
    if (raw.length <= TENANT_INDEX_MAX_CURSOR_LENGTH * 2) {
      const position = JSON.parse(raw) as WarehousePagePosition;
      if (
        position.customerId === customerId &&
        typeof position.key === "string" &&
        (position.nativeCursor === undefined ||
          (typeof position.nativeCursor === "string" &&
            typeof position.warehouseId === "string"))
      )
        return position;
    }
  } catch {
    // Rejected below.
  }
  throw new Error("INVALID_CURSOR");
}

/** Native cursors are issued only for ranges inside an authorized warehouse. */
export async function pageWarehouseActivity<
  T extends Doc<"finishedGoodsProducts"> | Doc<"finishedGoodsJobScans">,
>(
  ctx: TenantFunctionContext,
  customerId: Id<"customers">,
  cursor: string | undefined,
  limit: number,
  range: (warehouseId: Id<"warehouses">) => TenantIndexReader<T>,
  order: "asc" | "desc",
) {
  const start = warehousePagePosition(cursor, customerId);
  const allowed = await allowedCustomerWarehouses(ctx, start);
  const finish = (position?: Omit<WarehousePagePosition, "customerId">) => ({
    canViewWarehouseData: allowed.hasWarehouseRead,
    isDone: position === undefined,
    continueCursor: position ? JSON.stringify({ customerId, ...position }) : "",
  });
  const keyOf = (warehouse: Doc<"warehouses">) =>
    allowed.orgWide ? warehouse.code : warehouse._id;
  const items: { row: T; warehouseName: string }[] = [];
  if (!allowed.hasWarehouseRead) return { items, ...finish() };

  let usedNativePage = false;
  for (const warehouse of allowed.warehouses) {
    const key = keyOf(warehouse);
    const nativeCursor =
      start?.key === key && start.warehouseId === warehouse._id
        ? start.nativeCursor
        : undefined;
    const reader = range(warehouse._id);
    const remaining = limit - items.length;
    if (usedNativePage || remaining === 0) {
      // Convex allows one native pagination call per query. Small subsequent
      // ranges can still fill the page without needing a cursor within them.
      const rows = await reader.take(
        Math.min(remaining + 1, TENANT_INDEX_MAX_PAGE_SIZE),
        order,
      );
      if (rows.length > remaining || rows.length === TENANT_INDEX_MAX_PAGE_SIZE)
        return { items, ...finish({ key }) };
      items.push(
        ...rows.map((row) => ({ row, warehouseName: warehouse.name })),
      );
      continue;
    }
    if (!nativeCursor && !(await reader.first())) continue;
    const page = await reader.page({
      limit: remaining,
      order,
      ...(nativeCursor && { cursor: nativeCursor }),
    });
    usedNativePage = true;
    items.push(
      ...page.page.map((row) => ({ row, warehouseName: warehouse.name })),
    );
    if (!page.isDone) {
      return {
        items,
        ...finish({
          key,
          warehouseId: warehouse._id,
          nativeCursor: page.continueCursor,
        }),
      };
    }
  }
  return { items, ...finish(allowed.nextStart) };
}
