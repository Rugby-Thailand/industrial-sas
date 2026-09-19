import {
  signCatalogueCursor,
  verifyCatalogueCursor,
} from "../lib/signedCatalogueCursor";
import { v } from "convex/values";
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
import { matchesRow, compareRows, type FilterRow } from "./catalogueFilters";
import { readProductSummary as readSummary } from "../lib/finishedGoodsSummary";
import type { TenantIndexPage } from "../lib/tenantDb";

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
async function readiness(ctx: TenantFunctionContext, warehouseId: string) {
  return ctx.tenantDb
    .byIndex<Doc<"finishedGoodsSummaryReadiness">>(
      "finishedGoodsSummaryReadiness",
      "by_orgId_warehouseId",
      [{ field: "warehouseId", value: warehouseId }],
    )
    .unique();
}
export { readProductSummary as readSummary } from "../lib/finishedGoodsSummary";
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
export async function hydrateUnit(
  ctx: TenantFunctionContext,
  unit: Doc<"finishedGoodsPallets">,
) {
  const product = await ctx.tenantDb.get<Doc<"finishedGoodsProducts">>(
    "finishedGoodsProducts",
    unit.productId,
  );
  const move = await activeMove(ctx, unit._id);
  return {
    ...unit,
    productName: product?.name ?? "",
    sku: product?.sku ?? "",
    unit: product?.unit ?? "",
    storageFormat: unit.storageFormat ?? product?.storageFormat ?? "OTHER",
    ...(move ? { moveStatus: move.status, activeMoveId: move._id } : {}),
  };
}
async function hydrateProduct(
  ctx: TenantFunctionContext,
  product: Doc<"finishedGoodsProducts">,
) {
  const summary = await readSummary(ctx, product);
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
function unitFilter(unit: Awaited<ReturnType<typeof hydrateUnit>>): FilterRow {
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
/** Search products and their unit text without loading every unit. The inner cursor
 * preserves the text tail so substring matches spanning field/record boundaries
 * have the same semantics as the former joined browser string. */
async function readSearchedProducts(
  ctx: TenantFunctionContext,
  warehouseId: string,
  search: string,
  raw?: string,
  limit = 20,
): Promise<TenantIndexPage<Doc<"finishedGoodsProducts">>> {
  type SearchState = {
    scope: string;
    productRange?: NativeRangeState;
    products: string[];
    productsDone: boolean;
    unitRange?: NativeRangeState | undefined;
    tail?: string | undefined;
  };
  const scope = catalogueScope(ctx, ["product-text-v2", warehouseId, search]);
  const prior = raw ? decodeCatalogueCursor<SearchState>(raw, scope) : null;
  if (raw && !prior) throw new Error("CATALOGUE_CURSOR_INVALID");
  const state: SearchState = prior ?? {
    scope,
    products: [],
    productsDone: false,
  };
  if (
    !validNativeRange(state.productRange) ||
    !validNativeRange(state.unitRange) ||
    !Array.isArray(state.products) ||
    state.products.length > 100 ||
    state.products.some((id) => typeof id !== "string") ||
    typeof state.productsDone !== "boolean" ||
    (state.tail !== undefined &&
      (typeof state.tail !== "string" || state.tail.length > 600))
  )
    throw new Error("CATALOGUE_CURSOR_INVALID");
  const needle = search.trim().toLocaleLowerCase();
  if (!state.products.length) {
    if (state.productsDone)
      return { page: [], isDone: true, continueCursor: "" };
    const chunk = await ctx.tenantDb
      .byIndex<Doc<"finishedGoodsProducts">>(
        "finishedGoodsProducts",
        "by_orgId_warehouseId_updatedAt",
        [{ field: "warehouseId", value: warehouseId }],
      )
      .page({
        limit: 20,
        cursor: state.productRange?.raw,
        endCursor: state.productRange?.end,
        order: "desc",
      });
    const advance = advanceNativeRange(state.productRange ?? {}, chunk);
    if (advance.split)
      return {
        page: [],
        isDone: false,
        continueCursor: JSON.stringify({
          ...state,
          productRange: advance.range,
        }),
      };
    const direct: Doc<"finishedGoodsProducts">[] = [];
    for (const product of chunk.page) {
      if (
        direct.length >= limit ||
        !`${product.name} ${product.sku}`.toLocaleLowerCase().includes(needle)
      )
        break;
      direct.push(product);
    }
    const pending = chunk.page.slice(direct.length).map((p) => p._id);
    const isDone = advance.exhausted && pending.length === 0;
    return {
      page: direct,
      isDone,
      continueCursor: isDone
        ? ""
        : JSON.stringify({
            ...state,
            productRange: advance.range,
            products: pending,
            productsDone: advance.exhausted,
          }),
    };
  }
  const id = state.products[0]!;
  const product = await ctx.tenantDb.get<Doc<"finishedGoodsProducts">>(
    "finishedGoodsProducts",
    id,
  );
  if (!product || product.warehouseId !== warehouseId)
    throw new Error("CATALOGUE_CURSOR_INVALID");
  const prefix =
    state.tail ?? `${product.name} ${product.sku} `.toLocaleLowerCase();
  let found = prefix.includes(needle);
  let done = found;
  let unitRange = state.unitRange;
  let tail = prefix;
  if (!found) {
    const chunk = await ctx.tenantDb
      .byIndex<Doc<"finishedGoodsPallets">>(
        "finishedGoodsPallets",
        "by_orgId_warehouseId_productId_updatedAt",
        [
          { field: "warehouseId", value: warehouseId },
          { field: "productId", value: id },
        ],
      )
      .page({
        limit: 50,
        cursor: state.unitRange?.raw,
        endCursor: state.unitRange?.end,
        order: "desc",
      });
    const advance = advanceNativeRange(state.unitRange ?? {}, chunk);
    if (advance.split)
      return {
        page: [],
        isDone: false,
        continueCursor: JSON.stringify({ ...state, unitRange: advance.range }),
      };
    for (const unit of chunk.page) {
      if (
        unit.retiredAt !== undefined ||
        ["CANCELLED", "REPLACED"].includes(unit.status)
      )
        continue;
      const text = tail + `${unit.code} ${unit.lot ?? ""} `.toLocaleLowerCase();
      if (text.includes(needle)) found = true;
      tail = needle.length > 1 ? text.slice(-(needle.length - 1)) : "";
    }
    done = found || advance.exhausted;
    unitRange = advance.range;
  }
  const next: SearchState = done
    ? {
        ...state,
        products: state.products.slice(1),
        unitRange: undefined,
        tail: undefined,
      }
    : { ...state, unitRange, tail };
  const isDone = next.productsDone && !next.products.length;
  return {
    page: found ? [product] : [],
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
    const ready = await readiness(ctx, args.warehouseId);
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
    const scope = {
      warehouseId,
      tab,
      search,
      filters,
      locale,
      ...(sorted ? { generation: ready.generation ?? 0 } : {}),
    };
    const limit = sorted ? 50 : remainingScanCapacity(scanCursor, pageSize);
    if (tab === "products") {
      const result = await paginatedScan(ctx, {
        scope,
        pageSize,
        cursor,
        scanCursor,
        generation: ready.generation ?? 0,
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
        hydrate: (p) => hydrateProduct(ctx, p),
        matches: (p) => matchesRow(productFilter(p), filters, ""),
        ...(sorted
          ? {
              compare: (
                a: Awaited<ReturnType<typeof hydrateProduct>>,
                b: Awaited<ReturnType<typeof hydrateProduct>>,
              ) =>
                compareRows(
                  productFilter(a),
                  productFilter(b),
                  filters.sort,
                  locale,
                ),
            }
          : {}),
      });
      return { ...result, products: result.page, pallets: [] };
    }
    const result = await paginatedScan(ctx, {
      scope,
      pageSize,
      cursor,
      scanCursor,
      generation: ready.generation ?? 0,
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
      hydrate: (p) => hydrateUnit(ctx, p),
      matches: (p) =>
        p.retiredAt === undefined && matchesRow(unitFilter(p), filters, search),
      ...(sorted
        ? {
            compare: (
              a: Awaited<ReturnType<typeof hydrateUnit>>,
              b: Awaited<ReturnType<typeof hydrateUnit>>,
            ) =>
              compareRows(unitFilter(a), unitFilter(b), filters.sort, locale),
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
    return product?._id === args.excludeProductId ? null : product;
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
    if (!(await readiness(ctx, args.warehouseId))?.ready) return null;
    return readSummary(ctx, product);
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
      const value = await readSummary(ctx, product);
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
