/** Excel-safe UTF-8 CSV. Protect all text cells, including whitespace-prefixed formulas. */
export function csvCell(value: unknown): string {
  let text = value === undefined || value === null ? "" : String(value);
  if (/^[\s]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function usageCsv(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  return (
    "\ufeff" +
    [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")
  );
}
