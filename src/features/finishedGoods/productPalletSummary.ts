import { unitCountLabel } from "./storageUnitLabels";

type SummaryUnit = {
  productId: string;
  quantity: number;
  status?: string;
  moveStatus?: string;
  storageFormat?: string;
  retiredAt?: number;
};
/** Actual active unit records are the only source of catalogue totals. */
export function productPalletSummary(
  productId: string,
  units: readonly SummaryUnit[],
  legacyFormat?: string,
) {
  const records = units.filter(
    (unit) =>
      unit.productId === productId &&
      unit.retiredAt === undefined &&
      !["CANCELLED", "REPLACED"].includes(unit.status ?? ""),
  );
  const formats = new Map<string, number>();
  for (const unit of records) {
    const format = unit.storageFormat ?? legacyFormat ?? "OTHER";
    formats.set(format, (formats.get(format) ?? 0) + 1);
  }
  return {
    count: records.length,
    quantity:
      records.reduce((sum, unit) => sum + Math.round(unit.quantity * 1000), 0) /
      1000,
    formats: [...formats].map(([format, count]) => ({ format, count })),
    stored: records.filter(
      (unit) => unit.status === "STORED" && unit.moveStatus !== "IN_TRANSIT",
    ).length,
    awaitingMeasurement: records.filter(
      (unit) => unit.status === "AWAITING_MEASUREMENT",
    ).length,
    awaitingStorage: records.filter(
      (unit) =>
        unit.status === "AWAITING_PLACEMENT" || unit.status === "RESERVED",
    ).length,
    moving: records.filter((unit) => unit.moveStatus === "IN_TRANSIT").length,
  };
}
export function summaryFormatText(
  summary: ReturnType<typeof productPalletSummary>,
  tr: (en: string, th: string) => string,
) {
  return summary.formats.length
    ? summary.formats
        .map(({ format, count }) => unitCountLabel(format, count, tr))
        .join(" · ")
    : tr("0 storage units", "0 หน่วยจัดเก็บ");
}
export function summaryStatusText(
  summary: ReturnType<typeof productPalletSummary>,
  tr: (en: string, th: string) => string,
) {
  return [
    [tr("Stored", "จัดเก็บแล้ว"), summary.stored],
    [tr("Awaiting storage", "รอจัดเก็บ"), summary.awaitingStorage],
    [tr("Awaiting measurement", "รอวัดขนาด"), summary.awaitingMeasurement],
    [tr("Moving", "กำลังย้าย"), summary.moving],
  ]
    .filter(([, count]) => Number(count) > 0)
    .map(([label, count]) => `${label} ${count}`)
    .join(" · ");
}
