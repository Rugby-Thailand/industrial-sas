import { toCsv } from "@/lib/csv";

export function holidayCsv(
  headers: readonly string[],
  site: string,
  holidays: readonly { readonly date: string; readonly name: string }[],
) {
  return (
    toCsv(
      headers,
      holidays.map((item) => [item.date, item.name, site]),
    ) + "\r\n"
  );
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
