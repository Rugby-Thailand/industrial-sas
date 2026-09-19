import type { PackedUnit } from "../../../convex/model/finishedGoods/packing";

export type PackageDraft = Partial<Omit<PackedUnit, "dimensionsChecked">> & {
  dimensionsChecked: boolean;
};
export type PackingRow = {
  id: string;
  quantity: string;
  length: string;
  width: string;
  height: string;
  weight: string;
  checked: boolean;
};
export const textNumber = (value: number | undefined, divisor = 1) =>
  value === undefined ? "" : String(value / divisor);
export const newPackingRow = (quantity = ""): PackingRow => ({
  id: crypto.randomUUID(),
  quantity,
  length: "",
  width: "",
  height: "",
  weight: "",
  checked: false,
});
export const rowFromPackage = (unit: PackageDraft): PackingRow => ({
  ...newPackingRow(textNumber(unit.quantity)),
  length: textNumber(unit.lengthMm, 1000),
  width: textNumber(unit.widthMm, 1000),
  height: textNumber(unit.heightMm, 1000),
  weight: textNumber(unit.weightKg),
  checked: unit.dimensionsChecked,
});
/** Remove floating-point noise, but preserve sub-mm values so validation rejects them. */
export const millimetres = (value: string) => {
  const n = Number(value) * 1000;
  return Math.abs(n - Math.round(n)) < 1e-7 ? Math.round(n) : n;
};
export const packageDraft = (row: PackingRow): PackageDraft => ({
  ...(row.quantity.trim() ? { quantity: Number(row.quantity) } : {}),
  ...(row.length.trim() ? { lengthMm: millimetres(row.length) } : {}),
  ...(row.width.trim() ? { widthMm: millimetres(row.width) } : {}),
  ...(row.height.trim() ? { heightMm: millimetres(row.height) } : {}),
  ...(row.weight.trim() ? { weightKg: Number(row.weight) } : {}),
  dimensionsChecked: row.checked,
});
export const packedUnit = (row: PackingRow): PackedUnit => ({
  quantity: 0,
  lengthMm: 0,
  widthMm: 0,
  heightMm: 0,
  ...packageDraft(row),
});
export function updatePackingRow<T extends PackingRow>(
  row: T,
  changes: Partial<PackingRow>,
): T {
  return {
    ...row,
    ...changes,
    ...(["quantity", "length", "width", "height"].some(
      (field) => field in changes,
    )
      ? { checked: false }
      : {}),
    ...("quantity" in changes ? { weight: "" } : {}),
  };
}

export function packingIssueText(
  issue: string | null,
  tr: (en: string, th: string) => string,
): string {
  return issue === "QUANTITY_MISMATCH"
    ? tr(
        "Allocated quantity must equal the batch total.",
        "จำนวนที่จัดสรรต้องเท่ากับยอดรวมของชุด",
      )
    : issue === "QUANTITY_INVALID"
      ? tr(
          "Enter positive quantities with the precision allowed for this unit.",
          "กรอกจำนวนมากกว่าศูนย์และทศนิยมที่หน่วยนับรองรับ",
        )
      : issue === "DIMENSIONS_UNCHECKED"
        ? tr(
            "Confirm the actual dimensions of every storage unit, including copied dimensions.",
            "ยืนยันขนาดจริงของทุกหน่วย รวมถึงหน่วยที่คัดลอกขนาดมา",
          )
        : issue === "WEIGHT_INVALID"
          ? tr(
              "Weight must be positive when supplied.",
              "น้ำหนักต้องมากกว่าศูนย์เมื่อระบุ",
            )
          : issue
            ? tr(
                "Complete each unit’s quantity and outer dimensions (0–100 m, to the nearest millimetre).",
                "กรอกจำนวนและขนาดภายนอกของทุกหน่วยให้ครบ (มากกว่า 0 ถึง 100 ม. ละเอียดถึงมิลลิเมตร)",
              )
            : "";
}
