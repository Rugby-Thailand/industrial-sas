import { productPalletSummary } from "./productPalletSummary";
import type { FinishedGoodsList } from "@/lib/convex/finishedGoodsApi";

export type CatalogueTab = "products" | "pallets";
export type FilterColumn =
  | "record"
  | "quantity"
  | "format"
  | "progress"
  | "status"
  | "dimensions"
  | "lot";
export type Range = { min: string; max: string };
export type CatalogueFilters = {
  record: string;
  unit: string;
  quantity: Range;
  formats: string[];
  progress: string[];
  statuses: string[];
  lot: string;
  measurement: string;
  length: Range;
  width: Range;
  height: Range;
  sort: string;
};
export type CatalogueState = {
  tab: CatalogueTab;
  layout: "cards" | "table";
  search: string;
  products: CatalogueFilters;
  pallets: CatalogueFilters;
};
export const columns = (tab: CatalogueTab): FilterColumn[] =>
  tab === "products"
    ? ["record", "quantity", "format", "progress", "status"]
    : ["record", "quantity", "dimensions", "lot", "status"];
export const newFilters = (): CatalogueFilters => ({
  record: "",
  unit: "",
  quantity: { min: "", max: "" },
  formats: [],
  progress: [],
  statuses: [],
  lot: "",
  measurement: "",
  length: { min: "", max: "" },
  width: { min: "", max: "" },
  height: { min: "", max: "" },
  sort: "",
});
export const newCatalogueState = (): CatalogueState => ({
  tab: "products",
  layout: "cards",
  search: "",
  products: newFilters(),
  pallets: newFilters(),
});
export const productStatuses = ["DRAFT", "ACTIVE"];
export const unitStatuses = [
  "AWAITING_MEASUREMENT",
  "AWAITING_PLACEMENT",
  "RESERVED",
  "STORED",
  "MOVE_RESERVED",
  "IN_TRANSIT",
];
export const progressOptions = [
  "awaitingMeasurement",
  "awaitingStorage",
  "stored",
  "moving",
  "empty",
];
export const formatOptions = ["PALLET", "BOX", "OTHER"];
const sortFields: Record<FilterColumn, string[]> = {
  record: ["name", "sku", "code"],
  quantity: ["quantity"],
  format: ["format"],
  progress: ["stored", "awaitingStorage", "awaitingMeasurement", "moving"],
  status: ["status"],
  dimensions: ["length", "width", "height"],
  lot: ["lot"],
};
export function columnSorts(column: FilterColumn, tab: CatalogueTab) {
  return sortFields[column].filter((s) => s !== "code" || tab === "pallets");
}
export function sortColumn(sort: string): FilterColumn | undefined {
  return (Object.keys(sortFields) as FilterColumn[]).find((k) =>
    sortFields[k].includes(sort.split(":")[0] ?? ""),
  );
}
const text = (value: unknown) =>
  typeof value === "string" ? value.slice(0, 200) : "";
const numberText = (value: unknown) =>
  typeof value === "string" &&
  value.trim() &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0
    ? String(Number(value))
    : "";
function readRange(value: unknown): Range {
  const r =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return { min: numberText(r.min), max: numberText(r.max) };
}
function selection(value: unknown, allowed: string[]) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (v): v is string => typeof v === "string" && allowed.includes(v),
          ),
        ),
      ]
    : [];
}
function readFilters(value: unknown, tab: CatalogueTab): CatalogueFilters {
  if (!value || typeof value !== "object") return newFilters();
  const f = value as Record<string, unknown>;
  const result: CatalogueFilters = {
    ...newFilters(),
    record: text(f.record),
    unit: text(f.unit),
    quantity: readRange(f.quantity),
    formats: selection(f.formats, formatOptions),
    progress: selection(f.progress, progressOptions),
    statuses: selection(
      f.statuses,
      tab === "products" ? productStatuses : unitStatuses,
    ),
    lot: text(f.lot),
    measurement:
      f.measurement === "measured" || f.measurement === "unmeasured"
        ? f.measurement
        : "",
    length: readRange(f.length),
    width: readRange(f.width),
    height: readRange(f.height),
    sort: text(f.sort),
  };
  if (
    !columns(tab)
      .flatMap((c) => columnSorts(c, tab))
      .some((s) => result.sort === `${s}:asc` || result.sort === `${s}:desc`)
  )
    result.sort = "";
  // Discard fields that cannot be seen or edited on this tab.
  if (tab === "products") {
    result.lot = "";
    result.measurement = "";
    result.length = { min: "", max: "" };
    result.width = { min: "", max: "" };
    result.height = { min: "", max: "" };
  } else {
    result.formats = [];
    result.progress = [];
  }
  // URL state must not silently compare quantities with different counting units.
  if (!result.unit) result.quantity = { min: "", max: "" };
  for (const key of ["quantity", "length", "width", "height"] as const)
    if (
      result[key].min &&
      result[key].max &&
      Number(result[key].min) > Number(result[key].max)
    )
      result[key] = { min: "", max: "" };
  return result;
}
export function serializeCatalogueState(state: CatalogueState): string {
  const defaults = newCatalogueState();
  const compact: Record<string, unknown> = {};
  for (const key of ["tab", "layout", "search"] as const) {
    if (state[key] !== defaults[key]) compact[key] = state[key];
  }
  for (const tab of ["products", "pallets"] as const) {
    const active = Object.fromEntries(
      Object.entries(state[tab]).filter(
        ([key, value]) =>
          JSON.stringify(value) !==
          JSON.stringify(defaults[tab][key as keyof CatalogueFilters]),
      ),
    );
    if (Object.keys(active).length) compact[tab] = active;
  }
  return Object.keys(compact).length ? JSON.stringify(compact) : "";
}
export function readCatalogueState(search: string): CatalogueState {
  const fallback = newCatalogueState();
  try {
    const raw = new URLSearchParams(search).get("fg");
    if (!raw || raw.length > 12000) return fallback;
    const s: unknown = JSON.parse(raw);
    if (!s || typeof s !== "object") return fallback;
    const v = s as Record<string, unknown>;
    return {
      tab: v.tab === "pallets" ? "pallets" : "products",
      layout: v.layout === "table" ? "table" : "cards",
      search: text(v.search),
      products: readFilters(v.products, "products"),
      pallets: readFilters(v.pallets, "pallets"),
    };
  } catch {
    return fallback;
  }
}
export function columnCount(f: CatalogueFilters, column: FilterColumn) {
  if (column === "record" || column === "lot")
    return Number(Boolean(f[column].trim()));
  if (column === "quantity")
    return (
      Number(Boolean(f.unit)) +
      Number(Boolean(f.quantity.min || f.quantity.max))
    );
  if (column === "format") return f.formats.length;
  if (column === "progress") return f.progress.length;
  if (column === "status") return f.statuses.length;
  return (
    Number(Boolean(f.measurement)) +
    [f.length, f.width, f.height].filter((r) => r.min || r.max).length
  );
}
export function hasFilters(f: CatalogueFilters, tab: CatalogueTab) {
  return columns(tab).some((c) => columnCount(f, c)) || Boolean(f.sort);
}
export function clearColumn(
  f: CatalogueFilters,
  column: FilterColumn,
): CatalogueFilters {
  const keys: Record<FilterColumn, (keyof CatalogueFilters)[]> = {
    record: ["record"],
    quantity: ["unit", "quantity"],
    format: ["formats"],
    progress: ["progress"],
    status: ["statuses"],
    dimensions: ["measurement", "length", "width", "height"],
    lot: ["lot"],
  };
  const next = { ...f };
  const empty = newFilters();
  for (const key of keys[column]) Object.assign(next, { [key]: empty[key] });
  if (sortColumn(f.sort) === column) next.sort = "";
  return next;
}
export function filtersValid(f: CatalogueFilters) {
  const valid = (r: Range) =>
    [r.min, r.max].every(
      (n) =>
        !n || (n.trim() !== "" && Number.isFinite(Number(n)) && Number(n) >= 0),
    ) &&
    (!r.min || !r.max || Number(r.min) <= Number(r.max));
  return (
    [f.quantity, f.length, f.width, f.height].every(valid) &&
    (!(f.quantity.min || f.quantity.max) || Boolean(f.unit))
  );
}
const includes = (value: string, query: string) =>
  value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
function matchesRange(value: number | undefined, range: Range) {
  return (
    !(range.min || range.max) ||
    (value !== undefined &&
      (!range.min || value >= Number(range.min)) &&
      (!range.max || value <= Number(range.max)))
  );
}
export type FilterRow = {
  id: string;
  name: string;
  sku: string;
  code: string;
  search: string;
  quantity: number;
  unit: string;
  format: string;
  formats: string[];
  progress: string[];
  status: string;
  lot: string;
  measured: boolean;
  length: number | undefined;
  width: number | undefined;
  height: number | undefined;
  stored: number;
  awaitingStorage: number;
  awaitingMeasurement: number;
  moving: number;
};
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
    };
  });
  return { products, pallets };
}
export function filterRows(
  rows: FilterRow[],
  f: CatalogueFilters,
  search: string,
  locale: string,
) {
  const matched = rows.filter(
    (r) =>
      includes(r.search, search) &&
      includes(`${r.code} ${r.name} ${r.sku}`, f.record) &&
      (!f.unit || r.unit === f.unit) &&
      matchesRange(r.quantity, f.quantity) &&
      (!f.formats.length || f.formats.some((v) => r.formats.includes(v))) &&
      (!f.progress.length || f.progress.some((v) => r.progress.includes(v))) &&
      (!f.statuses.length || f.statuses.includes(r.status)) &&
      includes(r.lot, f.lot) &&
      (!f.measurement || r.measured === (f.measurement === "measured")) &&
      matchesRange(r.length, f.length) &&
      matchesRange(r.width, f.width) &&
      matchesRange(r.height, f.height),
  );
  if (!f.sort) return matched;
  const [field, direction] = f.sort.split(":");
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  });
  return matched.sort((a, b) => {
    // Keep counting units in separate groups, never rank kg against pieces numerically.
    if (field === "quantity" && a.unit !== b.unit)
      return collator.compare(a.unit, b.unit);
    const av = a[field as keyof FilterRow],
      bv = b[field as keyof FilterRow];
    if (av === undefined || bv === undefined)
      return av === bv ? 0 : av === undefined ? 1 : -1;
    const compare =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : collator.compare(String(av), String(bv));
    return (
      compare * (direction === "desc" ? -1 : 1) || collator.compare(a.id, b.id)
    );
  });
}
