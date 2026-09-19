import { validDimension } from "./placement";

export const MAX_FG_PACKAGES = 50;
export const MAX_PACKING_QUANTITY = 1_000_000_000;
export interface PackedUnit {
  quantity: number;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  fillPercent?: number;
  weightKg?: number;
  dimensionsChecked: boolean;
}

/** Public quantities use display units; allocation arithmetic uses integer thousandths. */
export function quantityPrecision(unit: string): 0 | 3 {
  return ["PCS", "PC", "EA", "EACH", "PIECE", "PIECES", "ชิ้น"].includes(
    unit.trim().toUpperCase(),
  )
    ? 0
    : 3;
}
export function quantityToMinor(value: number, unit: string): number | null {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_PACKING_QUANTITY)
    return null;
  const minor = Math.round(value * 1000);
  if (
    !Number.isSafeInteger(minor) ||
    minor / 1000 !== value ||
    (quantityPrecision(unit) === 0 && minor % 1000 !== 0)
  )
    return null;
  return minor;
}
export function splitPackages(
  total: number,
  capacity: number,
  unit: string,
): number[] {
  const all = quantityToMinor(total, unit),
    per = quantityToMinor(capacity, unit);
  if (all === null || per === null || Math.ceil(all / per) > MAX_FG_PACKAGES)
    return [];
  return Array.from(
    { length: Math.ceil(all / per) },
    (_, i) => Math.min(per, all - i * per) / 1000,
  );
}
export function splitEqually(
  total: number,
  count: number,
  unit: string,
): number[] {
  const all = quantityToMinor(total, unit);
  if (
    all === null ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_FG_PACKAGES
  )
    return [];
  const quantum = quantityPrecision(unit) === 0 ? 1000 : 1;
  const units = all / quantum,
    base = Math.floor(units / count),
    remainder = units % count;
  if (base < 1) return [];
  return Array.from(
    { length: count },
    (_, i) => ((base + (i < remainder ? 1 : 0)) * quantum) / 1000,
  );
}
export function validatePacking(
  total: number,
  rows: readonly PackedUnit[],
  unit: string,
  mode: "GEOMETRIC" | "SIMPLE" = "GEOMETRIC",
): string | null {
  const expected = quantityToMinor(total, unit);
  if (expected === null) return "QUANTITY_INVALID";
  if (!rows.length || rows.length > MAX_FG_PACKAGES)
    return "PACKAGE_COUNT_INVALID";
  let allocated = 0;
  for (const row of rows) {
    const quantity = quantityToMinor(row.quantity, unit);
    if (quantity === null) return "QUANTITY_INVALID";
    if (
      mode === "GEOMETRIC"
        ? ![row.lengthMm, row.widthMm, row.heightMm].every(validDimension)
        : [row.lengthMm, row.widthMm, row.heightMm].some(
            (value) => value !== undefined && !validDimension(value),
          )
    )
      return "DIMENSIONS_INVALID";
    if (
      row.weightKg !== undefined &&
      (!Number.isFinite(row.weightKg) ||
        row.weightKg <= 0 ||
        row.weightKg > 1_000_000)
    )
      return "WEIGHT_INVALID";
    if (mode === "GEOMETRIC" && !row.dimensionsChecked)
      return "DIMENSIONS_UNCHECKED";
    if (
      row.fillPercent !== undefined &&
      (!Number.isInteger(row.fillPercent) ||
        row.fillPercent < 1 ||
        row.fillPercent > 100)
    )
      return "FILL_PERCENT_INVALID";
    allocated += quantity;
  }
  return allocated === expected ? null : "QUANTITY_MISMATCH";
}
