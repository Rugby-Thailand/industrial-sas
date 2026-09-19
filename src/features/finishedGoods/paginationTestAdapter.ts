import type { FinishedGoodsList } from "@/lib/convex/finishedGoodsApi";
import {
  catalogueRows,
  filterRows,
  newFilters,
  type CatalogueFilters,
} from "./catalogueFilters";
import { productPalletSummary } from "./productPalletSummary";

/** Test server for existing screen fixtures; production never filters a full list. */
export function catalogueTestResponse(
  name: string,
  args: unknown,
  response: unknown,
) {
  if (args === "skip") return undefined;
  const request = args as {
    tab?: "products" | "pallets";
    filters?: CatalogueFilters;
    search?: string;
    locale?: "en" | "th";
    pageSize?: number;
    cursor?: string;
    sku?: string;
  };
  if (
    !response ||
    typeof response !== "object" ||
    !("ok" in response) ||
    !response.ok ||
    !("value" in response)
  )
    return response;
  const value = response.value;
  if (value && typeof value === "object" && "status" in value) return response;
  if (
    !value ||
    typeof value !== "object" ||
    !("products" in value) ||
    !("pallets" in value)
  )
    return response;
  const list = value as FinishedGoodsList;
  if (name.endsWith(":findSku"))
    return {
      ok: true,
      value:
        list.products.find(
          (p) =>
            p.sku.trim().toUpperCase() === request.sku?.trim().toUpperCase(),
        ) ?? null,
    };
  const products = list.products.map((p) => ({
    ...p,
    summary: productPalletSummary(p._id, list.pallets, p.storageFormat),
  }));
  const pallets = list.pallets.map((p) => {
    const product = list.products.find(
      (product) => product._id === p.productId,
    );
    return {
      ...p,
      productName: product?.name ?? "",
      sku: product?.sku ?? "",
      unit: product?.unit ?? "",
      storageFormat: p.storageFormat ?? product?.storageFormat ?? "OTHER",
    };
  });
  if (name.endsWith(":summary")) {
    const active = list.pallets.filter(
      (p) =>
        p.retiredAt === undefined &&
        !["REPLACED", "CANCELLED"].includes(p.status),
    );
    return {
      ok: true,
      value: {
        status: "ready",
        totals: {
          products: products.length,
          units: [...new Set(products.map((p) => p.unit))],
          awaitingMeasurement: active.filter(
            (p) => p.status === "AWAITING_MEASUREMENT",
          ).length,
          awaitingStorage: active.filter((p) =>
            ["AWAITING_PLACEMENT", "RESERVED"].includes(p.status),
          ).length,
          stored: active.filter(
            (p) => p.status === "STORED" && p.moveStatus !== "IN_TRANSIT",
          ).length,
          moving: active.filter((p) => p.moveStatus === "IN_TRANSIT").length,
        },
      },
    };
  }
  if (!name.endsWith(":page")) return response;
  const tab = request.tab ?? "products";
  const filtered = filterRows(
    catalogueRows(list)[tab],
    request.filters ?? newFilters(),
    request.search ?? "",
    request.locale ?? "en",
  );
  const offset = Number(request.cursor ?? 0);
  const size = request.pageSize ?? 20;
  const ids = filtered.slice(offset, offset + size).map((row) => row.id);
  return {
    ok: true,
    value: {
      status: "ready",
      isDone: offset + size >= filtered.length,
      continueCursor: String(offset + size),
      scanned: size,
      products:
        tab === "products"
          ? ids.flatMap((id) => products.filter((p) => p._id === id))
          : [],
      pallets:
        tab === "pallets"
          ? ids.flatMap((id) => pallets.filter((p) => p._id === id))
          : [],
    },
  };
}

export function batchTestResponse(
  name: string,
  response: unknown,
  args?: unknown,
) {
  if (
    !response ||
    typeof response !== "object" ||
    !("ok" in response) ||
    !response.ok ||
    !("value" in response)
  )
    return response;
  const value = response.value;
  if (
    !value ||
    typeof value !== "object" ||
    !("batches" in value) ||
    !("legacyUnits" in value)
  )
    return response;
  const data = value as {
    batches: {
      batch: { _id: string; productId: string; storageFormat: string };
      units: FinishedGoodsList["pallets"];
      history: unknown[];
    }[];
    legacyUnits: FinishedGoodsList["pallets"];
  };
  const meta = {
    status: "ready",
    isDone: true,
    continueCursor: "",
    scanned: 0,
  };
  if (name.endsWith(":getBatch"))
    return { ok: true, value: data.batches[0] ?? null };
  if (name.endsWith(":resolveUnitBatch")) {
    const request = (args ?? {}) as { palletId?: string };
    const target = data.batches
      .flatMap((b) => b.units)
      .find((u) => u._id === request.palletId);
    const entry = data.batches.find((b) =>
      b.units.some((u) => u._id === request.palletId),
    );
    return {
      ok: true,
      value: target
        ? {
            batchId: entry?.batch._id,
            editable: "editable" in target && target.editable,
            unit: target,
          }
        : null,
    };
  }
  if (name.endsWith(":pageProductBatches"))
    return {
      ok: true,
      value: {
        ...meta,
        page: data.batches.map((b) => ({
          batch: b.batch,
          unitCount: b.units.length,
        })),
      },
    };
  if (name.endsWith(":pageLegacyUnits"))
    return { ok: true, value: { ...meta, page: data.legacyUnits } };
  if (name.endsWith(":productSummary"))
    return {
      ok: true,
      value: productPalletSummary(
        data.batches[0]?.batch.productId ??
          data.legacyUnits[0]?.productId ??
          "product-a",
        [...data.batches.flatMap((b) => b.units), ...data.legacyUnits],
        data.batches[0]?.batch.storageFormat,
      ),
    };
  return response;
}
