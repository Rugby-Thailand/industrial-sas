/** Excel-safe UTF-8 CSV. Protect all text cells, including whitespace-prefixed formulas. */
export function csvCell(value: unknown): string {
  let text = value === undefined || value === null ? "" : String(value);
  if (/^[\s]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  return (
    "﻿" +
    [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")
  );
}

export function downloadCsv(fileName: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
