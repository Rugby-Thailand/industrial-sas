/** Quotes CSV cells and neutralizes spreadsheet formulas in configured text. */
function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function holidayCsv(
  headers: readonly string[],
  site: string,
  holidays: readonly { readonly date: string; readonly name: string }[],
) {
  return (
    "\uFEFF" +
    [headers, ...holidays.map((item) => [item.date, item.name, site])]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n") +
    "\r\n"
  );
}

export function downloadHolidayCsv(fileName: string, content: string) {
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

export function monthRange(month: string, today: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const from = `${month}-01`;
  const end = new Date(`${from}T00:00:00Z`);
  if (Number.isNaN(end.getTime()) || end.toISOString().slice(0, 7) !== month)
    return null;
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return {
    from,
    to:
      end.toISOString().slice(0, 10) > today
        ? today
        : end.toISOString().slice(0, 10),
  };
}
