export const CSV_LINE_ENDING = "\r\n";

export const CSV_BOM = "﻿";

const FORMULA_STARTERS = ["=", "+", "-", "@", "\t", "\r"];

export function csvField(value: string): string {
  const guarded = FORMULA_STARTERS.some((starter) => value.startsWith(starter))
    ? `'${value}`
    : value;

  return /[",\r\n]/.test(guarded)
    ? `"${guarded.replaceAll('"', '""')}"`
    : guarded;
}

export function csvRow(values: readonly string[]): string {
  return values.map(csvField).join(",");
}

export function csvHeader(columns: readonly string[]): string {
  return `${CSV_BOM}${csvRow(columns)}${CSV_LINE_ENDING}`;
}

export function csvRows(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => `${csvRow(row)}${CSV_LINE_ENDING}`).join("");
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function fitsWithin(
  currentBytes: number,
  additionBytes: number,
  capBytes: number,
): boolean {
  return currentBytes + additionBytes <= capBytes;
}
