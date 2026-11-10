import {
  matchesRow,
  createRowComparator,
} from "../../convex/finishedGoods/catalogueFilters";
import type { FinishedGoodsList } from "./finished-goods-ui";
import {
  progressOptions,
  newFilters,
  type CatalogueFilters,
} from "@/features/finishedGoods/catalogueFilters";
import { productPalletSummary } from "@/features/finishedGoods/productPalletSummary";

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
  const filters = request.filters ?? newFilters();
  const filtered = catalogueRows(list)
    [tab].filter((row) => matchesRow(row, filters, request.search ?? ""))
    .sort(createRowComparator(filters.sort, request.locale ?? "en"));
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

export function catalogueRows(list: FinishedGoodsList) {
  const units = list.pallets.filter(
    (p) =>
      p.retiredAt === undefined &&
      !["CANCELLED", "REPLACED"].includes(p.status),
  );
  const products = list.products.map((p) => {
    const summary = productPalletSummary(p._id, units, p.storageFormat);
    return {
      id: p._id,
      name: p.name,
      sku: p.sku,
      code: "",
      search: `${p.name} ${p.sku} ${units
        .filter((u) => u.productId === p._id)
        .map((u) => `${u.code} ${u.lot ?? ""}`)
        .join(" ")}`,
      quantity: summary.quantity,
      unit: p.unit,
      format: summary.formats
        .map((f) => f.format)
        .sort()
        .join(" "),
      formats: summary.formats.map((f) => f.format),
      progress: [
        ...progressOptions.filter(
          (k) =>
            k !== "empty" &&
            summary[
              k as
                "stored" | "awaitingMeasurement" | "awaitingStorage" | "moving"
            ] > 0,
        ),
        ...(summary.count === 0 ? ["empty"] : []),
      ],
      status: p.status,
      lot: "",
      measured: false,
      length: undefined,
      width: undefined,
      height: undefined,
      stored: summary.stored,
      awaitingStorage: summary.awaitingStorage,
      awaitingMeasurement: summary.awaitingMeasurement,
      moving: summary.moving,
      updatedAt: p.updatedAt,
    };
  });
  const pallets = units.map((p) => {
    const product = list.products.find((v) => v._id === p.productId);
    const format = p.storageFormat ?? product?.storageFormat ?? "OTHER";
    return {
      id: p._id,
      name: product?.name ?? "",
      sku: product?.sku ?? "",
      code: p.code,
      search: `${p.code} ${product?.name ?? ""} ${product?.sku ?? ""} ${p.lot ?? ""}`,
      quantity: p.quantity,
      unit: product?.unit ?? "",
      format,
      formats: [format],
      progress: [],
      status:
        p.moveStatus === "IN_TRANSIT"
          ? "IN_TRANSIT"
          : p.moveStatus === "RESERVED"
            ? "MOVE_RESERVED"
            : p.status,
      lot: p.lot ?? "",
      measured: Boolean(p.lengthMm && p.widthMm && p.heightMm),
      length: p.lengthMm ? p.lengthMm / 1000 : undefined,
      width: p.widthMm ? p.widthMm / 1000 : undefined,
      height: p.heightMm ? p.heightMm / 1000 : undefined,
      stored: 0,
      awaitingStorage: 0,
      awaitingMeasurement: 0,
      moving: 0,
      updatedAt: p.updatedAt,
    };
  });
  return { products, pallets };
}
