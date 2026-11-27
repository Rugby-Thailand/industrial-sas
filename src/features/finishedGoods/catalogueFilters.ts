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
  layout: "table",
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
      layout: v.layout === "cards" ? "cards" : "table",
      search: text(v.search),
      products: readFilters(v.products, "products"),
      pallets: readFilters(v.pallets, "pallets"),
    };
  } catch {
    return fallback;
  }
}
/** One independently editable and removable filter condition. */
export type FilterCondition =
  | "record"
  | "quantity"
  | "format"
  | "progress"
  | "status"
  | "measurement"
  | "length"
  | "width"
  | "height"
  | "lot";
const columnConditions: Record<FilterColumn, FilterCondition[]> = {
  record: ["record"],
  quantity: ["quantity"],
  format: ["format"],
  progress: ["progress"],
  status: ["status"],
  dimensions: ["measurement", "length", "width", "height"],
  lot: ["lot"],
};
const conditionFields: Record<FilterCondition, (keyof CatalogueFilters)[]> = {
  record: ["record"],
  quantity: ["unit", "quantity"],
  format: ["formats"],
  progress: ["progress"],
  status: ["statuses"],
  measurement: ["measurement"],
  length: ["length"],
  width: ["width"],
  height: ["height"],
  lot: ["lot"],
};
export const conditionsOf = (column: FilterColumn) => columnConditions[column];
export const conditions = (tab: CatalogueTab) =>
  columns(tab).flatMap(conditionsOf);
const hasRange = (r: Range) => Boolean(r.min || r.max);
export function conditionActive(f: CatalogueFilters, c: FilterCondition) {
  if (c === "record" || c === "lot" || c === "measurement")
    return Boolean(f[c].trim());
  // The counting unit and its quantity span form one condition.
  if (c === "quantity") return Boolean(f.unit) || hasRange(f.quantity);
  if (c === "format") return f.formats.length > 0;
  if (c === "progress") return f.progress.length > 0;
  if (c === "status") return f.statuses.length > 0;
  return hasRange(f[c]);
}
export const activeConditions = (f: CatalogueFilters, tab: CatalogueTab) =>
  conditions(tab).filter((c) => conditionActive(f, c));
export const columnCount = (f: CatalogueFilters, column: FilterColumn) =>
  conditionsOf(column).filter((c) => conditionActive(f, c)).length;
/** Sorting is ordering, not a filter condition. */
export const hasFilters = (f: CatalogueFilters, tab: CatalogueTab) =>
  activeConditions(f, tab).length > 0;
export function clearCondition(
  f: CatalogueFilters,
  condition: FilterCondition,
): CatalogueFilters {
  const empty = newFilters();
  const next = { ...f };
  for (const key of conditionFields[condition])
    Object.assign(next, { [key]: empty[key] });
  return next;
}
/** Clears every filter condition while keeping the chosen sort. */
export const clearConditions = (f: CatalogueFilters): CatalogueFilters => ({
  ...newFilters(),
  sort: f.sort,
});
/** Resets a table column's shortcut: its conditions and its own sort. */
export function clearColumn(
  f: CatalogueFilters,
  column: FilterColumn,
): CatalogueFilters {
  const next = conditionsOf(column).reduce(clearCondition, f);
  return sortColumn(f.sort) === column ? { ...next, sort: "" } : next;
}
export const sortOptions = (tab: CatalogueTab) =>
  columns(tab).flatMap((c) => columnSorts(c, tab));
export type RangeIssue = "" | "number" | "order";
export function rangeIssue(r: Range): RangeIssue {
  if (
    ![r.min, r.max].every(
      (n) =>
        !n || (n.trim() !== "" && Number.isFinite(Number(n)) && Number(n) >= 0),
    )
  )
    return "number";
  return r.min && r.max && Number(r.min) > Number(r.max) ? "order" : "";
}
export const quantityNeedsUnit = (f: CatalogueFilters) =>
  hasRange(f.quantity) && !f.unit;
export function filtersValid(f: CatalogueFilters) {
  return (
    [f.quantity, f.length, f.width, f.height].every((r) => !rangeIssue(r)) &&
    !quantityNeedsUnit(f)
  );
}
