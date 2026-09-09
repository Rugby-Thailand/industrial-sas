import { Field } from "./shared";
import type { PackingRow } from "./packingRows";

type Dimension = "length" | "width" | "height";
/** Rows always store metres; changing the display unit never changes the saved measurement. */
export function PackingDimensionFields({
  row,
  onChange,
  label,
  displayUnit = "m",
  required = false,
}: {
  row: PackingRow;
  onChange: (changes: Partial<PackingRow>) => void;
  label: (field: Dimension) => string;
  displayUnit?: "m" | "cm";
  required?: boolean;
}) {
  const scale = displayUnit === "cm" ? 100 : 1;
  return (["length", "width", "height"] as const).map((field) => (
    <Field
      key={field}
      label={label(field)}
      value={
        row[field]
          ? String(Number((Number(row[field]) * scale).toFixed(8)))
          : ""
      }
      onChange={(value) =>
        onChange({ [field]: value.trim() ? String(Number(value) / scale) : "" })
      }
      type="number"
      min={0.001 * scale}
      max={100 * scale}
      step={String(0.001 * scale)}
      required={required}
    />
  ));
}
