"use client";

import { useTranslations } from "next-intl";
import type { BarcodeCrop } from "./barcodeDecoder";

export function BarcodeCropControls({
  crop,
  onChange,
  disabled,
}: {
  crop: BarcodeCrop;
  onChange: (crop: BarcodeCrop) => void;
  disabled: boolean;
}) {
  const t = useTranslations("JobScan");
  return (
    <fieldset disabled={disabled} className="grid grid-cols-2 gap-3">
      <legend className="col-span-2 mb-2 text-sm">
        {t("barcodeCropHint")}
      </legend>
      {(["x", "y", "width", "height"] as const).map((field) => (
        <label key={field} className="min-w-0 text-sm">
          {t(`barcodeCrop.${field}`)} {Math.round(crop[field] * 100)}%
          <input
            type="range"
            min={field === "x" || field === "y" ? 0 : 5}
            max={
              field === "x" || field === "y"
                ? 95
                : field === "width"
                  ? Math.round((1 - crop.x) * 100)
                  : Math.round((1 - crop.y) * 100)
            }
            value={Math.round(crop[field] * 100)}
            className="block min-h-11 w-full md:min-h-11"
            onChange={(event) => {
              const value = Number(event.target.value) / 100;
              onChange({
                ...crop,
                [field]: value,
                ...(field === "x"
                  ? { width: Math.min(crop.width, 1 - value) }
                  : {}),
                ...(field === "y"
                  ? { height: Math.min(crop.height, 1 - value) }
                  : {}),
              });
            }}
          />
        </label>
      ))}
    </fieldset>
  );
}
