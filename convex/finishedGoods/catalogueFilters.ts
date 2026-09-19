/** Shared server-side catalogue semantics. Keep parity fixtures with the UI filters. */
export type Range = { min: string; max: string };
export type Filters = {
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
  updatedAt: number;
};
const includes = (value: string, query: string) =>
  value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
const inRange = (value: number | undefined, range: Range) =>
  !(range.min || range.max) ||
  (value !== undefined &&
    (!range.min || value >= Number(range.min)) &&
    (!range.max || value <= Number(range.max)));
export function matchesRow(row: FilterRow, f: Filters, search: string) {
  return (
    includes(row.search, search) &&
    includes(`${row.code} ${row.name} ${row.sku}`, f.record) &&
    (!f.unit || row.unit === f.unit) &&
    inRange(row.quantity, f.quantity) &&
    (!f.formats.length ||
      f.formats.some((value) => row.formats.includes(value))) &&
    (!f.progress.length ||
      f.progress.some((value) => row.progress.includes(value))) &&
    (!f.statuses.length || f.statuses.includes(row.status)) &&
    includes(row.lot, f.lot) &&
    (!f.measurement || row.measured === (f.measurement === "measured")) &&
    inRange(row.length, f.length) &&
    inRange(row.width, f.width) &&
    inRange(row.height, f.height)
  );
}
export function compareRows(
  a: FilterRow,
  b: FilterRow,
  sort: string,
  locale: string,
) {
  if (!sort) return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
  const [field, direction] = sort.split(":");
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  });
  if (field === "quantity" && a.unit !== b.unit)
    return collator.compare(a.unit, b.unit) || a.id.localeCompare(b.id);
  const av = a[field as keyof FilterRow],
    bv = b[field as keyof FilterRow];
  if (av === undefined || bv === undefined)
    return av === bv ? a.id.localeCompare(b.id) : av === undefined ? 1 : -1;
  const comparison =
    typeof av === "number" && typeof bv === "number"
      ? av - bv
      : collator.compare(String(av), String(bv));
  return (
    comparison * (direction === "desc" ? -1 : 1) || collator.compare(a.id, b.id)
  );
}
