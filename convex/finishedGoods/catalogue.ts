import { createQueryDocumentReader } from "../lib/queryDocumentReader";
import {
  signCatalogueCursor,
  verifyCatalogueCursor,
} from "../lib/signedCatalogueCursor";
import { getDocumentSize, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import {
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import {
  advanceNativeRange,
  validNativeRange,
  type NativeRangeState,
  catalogueScope,
  decodeCatalogueCursor,
  paginatedScan,
  remainingScanCapacity,
} from "../lib/cataloguePagination";
import {
  matchesRow,
  createRowComparator,
  type FilterRow,
} from "./catalogueFilters";
import { readProductSummary as readSummary } from "../lib/finishedGoodsSummary";
import {
  canReadCustomers,
  projectProductCustomerFields,
} from "../customers/warehouseScope";
import {
  TENANT_INDEX_ID_SUFFIX,
  TENANT_INDEX_TIEBREAKER,
  type TenantIndexPage,
  type TenantIndexEquality,
  type TenantIndexRange,
} from "../lib/tenantDb";

const READ = "masterData.storageLayout.read";
const range = v.object({ min: v.string(), max: v.string() });
const filtersValidator = v.object({
  record: v.string(),
  unit: v.string(),
  quantity: range,
  formats: v.array(v.string()),
  progress: v.array(v.string()),
  statuses: v.array(v.string()),
  lot: v.string(),
  measurement: v.string(),
  length: range,
  width: range,
  height: range,
  sort: v.string(),
});
const pageSizeValidator = v.union(v.literal(20), v.literal(50), v.literal(100));
export const pageArgs = {
  warehouseId: v.id("warehouses"),
  pageSize: pageSizeValidator,
  cursor: v.optional(v.string()),
  scanCursor: v.optional(v.string()),
};
/** The readiness row alone: stable, so readers of it do not re-run on writes. */
async function readinessState(ctx: TenantFunctionContext, warehouseId: string) {
  return ctx.tenantDb
    .byIndex<Doc<"finishedGoodsSummaryReadiness">>(
      "finishedGoodsSummaryReadiness",
      "by_orgId_warehouseId",
      [{ field: "warehouseId", value: warehouseId }],
    )
    .unique();
}
/** Readiness plus the continuation token, for multi-request scans only. */
async function readiness(ctx: TenantFunctionContext, warehouseId: string) {
  const state = await readinessState(ctx, warehouseId);
  return state
    ? {
        ...state,
        generation: await finishedGoodsGeneration(
          ctx.tenantDb,
          warehouseId,
          state.generation ?? 0,
        ),
      }
    : null;
}
export { readProductSummary as readSummary } from "../lib/finishedGoodsSummary";
import {
  finishedGoodsGeneration,
  PRODUCT_SUMMARY_VERSION,
} from "../lib/finishedGoodsSummary";
import { readWarehouseTotals } from "../lib/warehouseTotals";
export async function activeMove(ctx: TenantFunctionContext, palletId: string) {
  for (const status of ["RESERVED", "IN_TRANSIT"] as const) {
    const move = await ctx.tenantDb
      .byIndex<Doc<"finishedGoodsMoves">>(
        "finishedGoodsMoves",
        "by_orgId_palletId_status",
        [
          { field: "palletId", value: palletId },
          { field: "status", value: status },
        ],
      )
      .first();
    if (move) return move;
  }
  return null;
}
export function createUnitReader(ctx: TenantFunctionContext) {
  const readProduct = createQueryDocumentReader(
    ctx.tenantDb,
    "finishedGoodsProducts",
  );
  return async (unit: Doc<"finishedGoodsPallets">) => {
    const [product, move] = await Promise.all([
      readProduct(unit.productId),
      activeMove(ctx, unit._id),
    ]);
    return {
      ...unit,
      productName: product?.name ?? "",
      sku: product?.sku ?? "",
      unit: product?.unit ?? "",
      storageFormat: unit.storageFormat ?? product?.storageFormat ?? "OTHER",
      ...(move ? { moveStatus: move.status, activeMoveId: move._id } : {}),
    };
  };
}
type UnitRow = Awaited<ReturnType<ReturnType<typeof createUnitReader>>>;

async function hydrateProduct(
  ctx: TenantFunctionContext,
  product: Doc<"finishedGoodsProducts">,
  ready: Doc<"finishedGoodsSummaryReadiness"> | null,
) {
  const summary = await readSummary(ctx, product, ready);
  if (!summary) throw new Error("CATALOGUE_SUMMARY_NOT_READY");
  return { ...product, summary };
}
function productFilter(
  product: Awaited<ReturnType<typeof hydrateProduct>>,
): FilterRow {
  const s = product.summary;
  return {
    id: product._id,
    name: product.name,
    sku: product.sku,
    code: "",
    search: `${product.name} ${product.sku}`,
    quantity: s.quantity,
    unit: product.unit,
    format: s.formats
      .map((f) => f.format)
      .sort()
      .join(" "),
    formats: s.formats.map((f) => f.format),
    progress: [
      ...(
        ["stored", "awaitingMeasurement", "awaitingStorage", "moving"] as const
      ).filter((key) => s[key] > 0),
      ...(s.count === 0 ? ["empty"] : []),
    ],
    status: product.status,
    lot: "",
    measured: false,
    length: undefined,
    width: undefined,
    height: undefined,
    stored: s.stored,
    awaitingStorage: s.awaitingStorage,
    awaitingMeasurement: s.awaitingMeasurement,
    moving: s.moving,
    updatedAt: product.updatedAt,
  };
}
function unitFilter(unit: UnitRow): FilterRow {
  return {
    id: unit._id,
    name: unit.productName,
    sku: unit.sku,
    code: unit.code,
    search: `${unit.code} ${unit.productName} ${unit.sku} ${unit.lot ?? ""}`,
    quantity: unit.quantity,
    unit: unit.unit,
    format: unit.storageFormat,
    formats: [unit.storageFormat],
    progress: [],
    status:
      unit.moveStatus === "IN_TRANSIT"
        ? "IN_TRANSIT"
        : unit.moveStatus === "RESERVED"
          ? "MOVE_RESERVED"
          : unit.status,
    lot: unit.lot ?? "",
    measured: Boolean(unit.lengthMm && unit.widthMm && unit.heightMm),
    length: unit.lengthMm ? unit.lengthMm / 1000 : undefined,
    width: unit.widthMm ? unit.widthMm / 1000 : undefined,
    height: unit.heightMm ? unit.heightMm / 1000 : undefined,
    stored: 0,
    awaitingStorage: 0,
    awaitingMeasurement: 0,
    moving: 0,
    updatedAt: unit.updatedAt,
  };
}
// Eight maximum-size Convex documents still leave room for the rest of the
// query. Stop before starting another slice after reading 512 KiB of units.
const SEARCH_UNIT_SLICE = 8;
const SEARCH_UNIT_BYTE_BUDGET = 512 * 1024;
const SEARCH_UNIT_ROW_BUDGET = 510;
const SEARCH_PRODUCT_CHUNK = 20;

type UnitKeysetPosition = {
  /** Last consumed raw unit's `updatedAt`. */
  u: number;
  /** Last consumed raw unit's `_creationTime`. */
  t: number;
  /** Last consumed raw unit's `_id`. */
  i: string;
};

function validUnitPosition(value: unknown): value is UnitKeysetPosition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pos = value as Record<string, unknown>;
  return (
    typeof pos.u === "number" &&
    Number.isFinite(pos.u) &&
    typeof pos.t === "number" &&
    Number.isFinite(pos.t) &&
    typeof pos.i === "string" &&
    pos.i.length > 0 &&
    pos.i.length <= 64
  );
}

/** Search products and their unit text without loading every unit.
 *
 * Each product matches when its name/SKU text, followed by every live unit's
 * code/lot text in descending index order, contains the needle. The inner
 * cursor keeps a text tail so matches spanning field/record boundaries keep
 * the semantics of the former joined browser string.
 *
 * One request evaluates products in descending index order until it fills
 * `limit`, runs out of unit-row budget, or needs a second native product page.
 * Each product's units are scanned in bounded descending keyset slices (`take`)
 * on `by_orgId_warehouseId_productId_updatedAt`, resuming immediately after the
 * last consumed raw unit with exact `(updatedAt, _creationTime, _id)` tie
 * handling, so large products neither rescan their first page nor consume the
 * single native `paginate` Convex allows per query. */
async function readSearchedProducts(
  ctx: TenantFunctionContext,
  warehouseId: string,
  search: string,
  raw?: string,
  limit = 20,
): Promise<TenantIndexPage<Doc<"finishedGoodsProducts">>> {
  type SearchState = {
    scope: string;
    productRange?: NativeRangeState | undefined;
    /** Unfinished products in index order; the first may own `unitPos`. */
    products: string[];
    productsDone: boolean;
    /** Last consumed raw unit of `products[0]` while scanning its remaining units. */
    unitPos?: UnitKeysetPosition | undefined;
    tail?: string | undefined;
  };
  const scope = catalogueScope(ctx, ["product-text-v3", warehouseId, search]);
  const prior = raw ? decodeCatalogueCursor<SearchState>(raw, scope) : null;
  if (raw && !prior) throw new Error("CATALOGUE_CURSOR_INVALID");
  const state: SearchState = prior ?? {
    scope,
    products: [],
    productsDone: false,
  };
  const needle = search.trim().toLocaleLowerCase();
  const maxTailLength = Math.min(600, Math.max(0, needle.length - 1));
  if (
    !validNativeRange(state.productRange) ||
    !Array.isArray(state.products) ||
    state.products.length > 100 ||
    state.products.some(
      (id) => typeof id !== "string" || id.length === 0 || id.length > 64,
    ) ||
    typeof state.productsDone !== "boolean" ||
    "unitRange" in state ||
    (state.unitPos === undefined) !== (state.tail === undefined) ||
    (state.unitPos !== undefined &&
      (!state.products.length || !validUnitPosition(state.unitPos))) ||
    (state.tail !== undefined &&
      (typeof state.tail !== "string" || state.tail.length > maxTailLength))
  )
    throw new Error("CATALOGUE_CURSOR_INVALID");

  const trimTail = (text: string) =>
    needle.length > 1 ? text.slice(-(needle.length - 1)) : "";

  // A compound cursor splits the remaining index into three disjoint ranges.
  // Read each in the database's descending order, including imported ID ties.
  const readUnitSlice = async (
    productId: string,
    after: UnitKeysetPosition | undefined,
  ) => {
    const prefix = [
      { field: "warehouseId", value: warehouseId },
      { field: "productId", value: productId },
    ];
    const take = (
      terms: TenantIndexEquality,
      count: number,
      range?: TenantIndexRange,
    ) =>
      ctx.tenantDb
        .byIndex<Doc<"finishedGoodsPallets">>(
          "finishedGoodsPallets",
          "by_orgId_warehouseId_productId_updatedAt",
          terms,
          range,
        )
        .take(count, "desc");
    if (!after) return take(prefix, SEARCH_UNIT_SLICE);
    const updated = [...prefix, { field: "updatedAt", value: after.u }];
    const created = [
      ...updated,
      { field: TENANT_INDEX_TIEBREAKER, value: after.t },
    ];
    const below = (
      field: string,
      value: number | string,
    ): TenantIndexRange => ({
      field,
      upper: { value, inclusive: false },
    });
    const rows = [
      ...(await take(
        created,
        SEARCH_UNIT_SLICE,
        below(TENANT_INDEX_ID_SUFFIX, after.i),
      )),
    ];
    if (rows.length < SEARCH_UNIT_SLICE) {
      rows.push(
        ...(await take(
          updated,
          SEARCH_UNIT_SLICE - rows.length,
          below(TENANT_INDEX_TIEBREAKER, after.t),
        )),
      );
    }
    if (rows.length < SEARCH_UNIT_SLICE) {
      rows.push(
        ...(await take(
          prefix,
          SEARCH_UNIT_SLICE - rows.length,
          below("updatedAt", after.u),
        )),
      );
    }
    return rows;
  };

  /** Stream live unit text after `initialTail`; returns the trimmed tail or a match. */
  const scanUnits = (
    initialTail: string,
    rows: readonly Doc<"finishedGoodsPallets">[],
  ) => {
    let currentTail = trimTail(initialTail);
    for (const unit of rows) {
      if (
        unit.retiredAt !== undefined ||
        ["CANCELLED", "REPLACED"].includes(unit.status)
      )
        continue;
      const text =
        currentTail + `${unit.code} ${unit.lot ?? ""} `.toLocaleLowerCase();
      if (text.includes(needle)) return { found: true, tail: "" };
      currentTail = trimTail(text);
    }
    return { found: false, tail: currentTail };
  };

  const output: Doc<"finishedGoodsProducts">[] = [];
  let queue: Array<string | Doc<"finishedGoodsProducts">> = [...state.products];
  let productRange: NativeRangeState | undefined = state.productRange;
  let productsDone = state.productsDone;
  let unitPos: UnitKeysetPosition | undefined = state.unitPos;
  let tail: string | undefined = state.tail;
  let nativeUsed = false;
  let unitRows = 0;
  let unitBytes = 0;
  while (output.length < limit) {
    if (!queue.length) {
      if (productsDone || nativeUsed) break;
      nativeUsed = true;
      const chunk = await ctx.tenantDb
        .byIndex<Doc<"finishedGoodsProducts">>(
          "finishedGoodsProducts",
          "by_orgId_warehouseId_updatedAt",
          [{ field: "warehouseId", value: warehouseId }],
        )
        .page({
          limit: SEARCH_PRODUCT_CHUNK,
          cursor: productRange?.raw,
          endCursor: productRange?.end,
          order: "desc",
        });
      const advance = advanceNativeRange(productRange ?? {}, chunk);
      productRange = advance.range;
      if (advance.split) break;
      productsDone = advance.exhausted;
      queue = [...chunk.page];
      continue;
    }
    const head = queue[0]!;
    let product: Doc<"finishedGoodsProducts">;
    if (typeof head === "string") {
      const loaded = await ctx.tenantDb.get<Doc<"finishedGoodsProducts">>(
        "finishedGoodsProducts",
        head,
      );
      if (!loaded || loaded.warehouseId !== warehouseId)
        throw new Error("CATALOGUE_CURSOR_INVALID");
      product = loaded;
    } else product = head;
    const fresh = unitPos === undefined;
    let found = false;
    let currentTail: string;
    if (fresh) {
      const prefix = `${product.name} ${product.sku} `.toLocaleLowerCase();
      found = prefix.includes(needle);
      currentTail = trimTail(prefix);
    } else {
      currentTail = tail!;
    }
    let suspended = false;
    while (!found) {
      if (
        unitRows + SEARCH_UNIT_SLICE > SEARCH_UNIT_ROW_BUDGET ||
        unitBytes >= SEARCH_UNIT_BYTE_BUDGET
      ) {
        suspended = true;
        break;
      }
      const rows = await readUnitSlice(product._id, unitPos);
      unitRows += rows.length;
      for (const unit of rows) unitBytes += getDocumentSize(unit);
      const scanned = scanUnits(currentTail, rows);
      found = scanned.found;
      currentTail = scanned.tail;
      if (found) break;
      if (rows.length < SEARCH_UNIT_SLICE) break;
      const last = rows[rows.length - 1]!;
      unitPos = {
        u: last.updatedAt,
        t: last._creationTime,
        i: last._id,
      };
      tail = currentTail;
    }
    if (suspended) break;
    queue.shift();
    unitPos = undefined;
    tail = undefined;
    if (found) output.push(product);
  }
  const next: SearchState = {
    scope,
    productRange,
    products: queue.map((item) => (typeof item === "string" ? item : item._id)),
    productsDone,
    unitPos,
    tail,
  };
  const isDone = next.productsDone && !next.products.length;
  return {
    page: output,
    isDone,
    continueCursor: isDone ? "" : JSON.stringify(next),
  };
}
export const page = queryWithOrg({
  args: {
    ...pageArgs,
    tab: v.union(v.literal("products"), v.literal("pallets")),
    search: v.string(),
    filters: filtersValidator,
    locale: v.union(v.literal("en"), v.literal("th")),
  },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "finishedGoodsProducts" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const ready = await readinessState(ctx, args.warehouseId);
    if (!ready?.ready)
      return {
        status: "not_ready" as const,
        page: [],
        products: [],
        pallets: [],
        isDone: false,
        continueCursor: "",
        scanned: 0,
      };
    const {
      warehouseId,
      tab,
      search,
      filters,
      locale,
      pageSize,
      cursor,
      scanCursor,
    } = args;
    if (search.length > 200 || JSON.stringify(filters).length > 12000)
      throw new Error("CATALOGUE_CRITERIA_INVALID");
    const sorted = Boolean(filters.sort);
    const compare = createRowComparator(filters.sort, locale);
    const scope = { warehouseId, tab, search, filters, locale };
    // Read only when a page resumes or continues, so first pages answered in
    // one request do not re-run on every finished-goods write.
    const generation = () =>
      finishedGoodsGeneration(ctx.tenantDb, warehouseId, ready.generation ?? 0);
    const limit = sorted ? 50 : remainingScanCapacity(scanCursor, pageSize);
    if (tab === "products") {
      const allowCustomerRead = await canReadCustomers(ctx);
      const result = await paginatedScan(ctx, {
        scope,
        pageSize,
        cursor,
        scanCursor,
        generation,
        bindContinuation: sorted,
        read: (raw, endCursor) =>
          search.trim()
            ? readSearchedProducts(ctx, warehouseId, search, raw, limit)
            : ctx.tenantDb
                .byIndex<Doc<"finishedGoodsProducts">>(
                  "finishedGoodsProducts",
                  "by_orgId_warehouseId_updatedAt",
                  [{ field: "warehouseId", value: warehouseId }],
                )
                .page({ limit, cursor: raw, endCursor, order: "desc" }),
        get: async (id) => {
          const p = await ctx.tenantDb.get<Doc<"finishedGoodsProducts">>(
            "finishedGoodsProducts",
            id,
          );
          return p?.warehouseId === warehouseId ? p : null;
        },
        hydrate: (p) => hydrateProduct(ctx, p, ready),
        matches: (p) => matchesRow(productFilter(p), filters, ""),
        ...(sorted
          ? {
              compare: (
                a: Awaited<ReturnType<typeof hydrateProduct>>,
                b: Awaited<ReturnType<typeof hydrateProduct>>,
              ) => compare(productFilter(a), productFilter(b)),
            }
          : {}),
      });
      const projected = allowCustomerRead
        ? result.page
        : result.page.map((product) =>
            projectProductCustomerFields(product, false),
          );
      return { ...result, page: projected, products: projected, pallets: [] };
    }
    const result = await paginatedScan(ctx, {
      scope,
      pageSize,
      cursor,
      scanCursor,
      generation,
      bindContinuation: sorted,
      read: (raw, endCursor) =>
        ctx.tenantDb
          .byIndex<Doc<"finishedGoodsPallets">>(
            "finishedGoodsPallets",
            "by_orgId_warehouseId_updatedAt",
            [{ field: "warehouseId", value: warehouseId }],
          )
          .page({ limit, cursor: raw, endCursor, order: "desc" }),
      get: async (id) => {
        const p = await ctx.tenantDb.get<Doc<"finishedGoodsPallets">>(
          "finishedGoodsPallets",
          id,
        );
        return p?.warehouseId === warehouseId ? p : null;
      },
      hydrate: createUnitReader(ctx),
      matches: (p) =>
        p.retiredAt === undefined && matchesRow(unitFilter(p), filters, search),
      ...(sorted
        ? {
            compare: (a: UnitRow, b: UnitRow) =>
              compare(unitFilter(a), unitFilter(b)),
          }
        : {}),
    });
    return { ...result, products: [], pallets: result.page };
  },
});
export const findSku = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    sku: v.string(),
    excludeProductId: v.optional(v.id("finishedGoodsProducts")),
  },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "finishedGoodsProducts" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const product = await ctx.tenantDb
      .byIndex<Doc<"finishedGoodsProducts">>(
        "finishedGoodsProducts",
        "by_orgId_warehouseId_sku",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "sku", value: args.sku.trim().toUpperCase() },
        ],
      )
      .first();
    if (!product || product._id === args.excludeProductId) return null;
    return projectProductCustomerFields(product, await canReadCustomers(ctx));
  },
});
export const productSummary = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    productId: v.id("finishedGoodsProducts"),
  },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "finishedGoodsProducts" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const product = await ctx.tenantDb.get<Doc<"finishedGoodsProducts">>(
      "finishedGoodsProducts",
      args.productId,
    );
    if (!product || product.warehouseId !== args.warehouseId) return null;
    // One product's summary needs no continuation token: do not depend on
    // every finished-goods write in the warehouse.
    const ready = await readinessState(ctx, args.warehouseId);
    if (!ready?.ready) return null;
    return readSummary(ctx, product, ready);
  },
});

/** Separate complete warehouse counters; each request reads at most 100 products
 * and their materialized summaries. The UI keeps scanning state out of the list.
 */
export const summary = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), scanCursor: v.optional(v.string()) },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "finishedGoodsProducts" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    // Exact maintained totals answer in one request; the paged scan below
    // remains for warehouses whose totals are not built (or are suspect).
    if (!args.scanCursor) {
      const state = await readinessState(ctx, args.warehouseId);
      const totals =
        state?.continuationKey && state.version === PRODUCT_SUMMARY_VERSION
          ? await readWarehouseTotals(ctx.tenantDb, state)
          : null;
      if (totals)
        return {
          status: "ready" as const,
          totals,
          isDone: true,
          continueCursor: "",
          scanned: totals.products,
        };
    }
    const ready = await readiness(ctx, args.warehouseId);
    const empty = {
      products: 0,
      awaitingMeasurement: 0,
      awaitingStorage: 0,
      stored: 0,
      moving: 0,
      units: [] as string[],
    };
    if (!ready?.ready || !ready.continuationKey)
      return {
        status: "not_ready" as const,
        totals: empty,
        isDone: false,
        continueCursor: "",
        scanned: 0,
      };
    const scope = catalogueScope(ctx, [
      "summary-v2",
      args.warehouseId,
      ready.generation ?? 0,
    ]);
    type State = {
      scope: string;
      range?: NativeRangeState;
      totals: typeof empty;
    };
    const prior = args.scanCursor
      ? await verifyCatalogueCursor<State>(
          args.scanCursor,
          ready.continuationKey,
        )
      : null;
    if (args.scanCursor && (!prior || prior.scope !== scope))
      return {
        status: "reset" as const,
        totals: empty,
        isDone: false,
        continueCursor: "",
        scanned: 0,
      };
    const totals = prior?.totals ?? empty;
    if (
      !totals ||
      !Array.isArray(totals.units) ||
      totals.units.some((unit) => typeof unit !== "string") ||
      Object.entries(totals).some(
        ([key, value]) =>
          key !== "units" &&
          (typeof value !== "number" ||
            !Number.isSafeInteger(value) ||
            value < 0),
      )
    )
      throw new Error("CATALOGUE_CURSOR_INVALID");
    const chunk = await ctx.tenantDb
      .byIndex<Doc<"finishedGoodsProducts">>(
        "finishedGoodsProducts",
        "by_orgId_warehouseId_sku",
        [{ field: "warehouseId", value: args.warehouseId }],
      )
      .page({
        limit: 100,
        cursor: prior?.range?.raw,
        endCursor: prior?.range?.end,
      });
    const advance = advanceNativeRange(prior?.range ?? {}, chunk);
    if (advance.split)
      return {
        status: "scanning" as const,
        totals: empty,
        isDone: false,
        continueCursor: "",
        scanned: totals.products,
        scanCursor: await signCatalogueCursor(
          { scope, range: advance.range, totals },
          ready.continuationKey,
        ),
      };
    for (const product of chunk.page) {
      const value = await readSummary(ctx, product, ready);
      if (!value)
        return {
          status: "not_ready" as const,
          totals: empty,
          isDone: false,
          continueCursor: "",
          scanned: 0,
        };
      totals.products++;
      totals.awaitingMeasurement += value.awaitingMeasurement;
      totals.awaitingStorage += value.awaitingStorage;
      totals.stored += value.stored;
      totals.moving += value.moving;
      if (product.unit && !totals.units.includes(product.unit))
        totals.units.push(product.unit);
    }
    totals.units.sort();
    return {
      status: advance.exhausted ? ("ready" as const) : ("scanning" as const),
      totals: advance.exhausted ? totals : empty,
      isDone: advance.exhausted,
      continueCursor: "",
      scanned: totals.products,
      ...(!advance.exhausted
        ? {
            scanCursor: await signCatalogueCursor(
              {
                scope,
                range: advance.range,
                totals,
              },
              ready.continuationKey,
            ),
          }
        : {}),
    };
  },
});
