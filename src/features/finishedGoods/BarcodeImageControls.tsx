"use client";

import { useId, useRef } from "react";
import { Crop, ImagePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import type { useBarcodeImage } from "./useBarcodeImage";

export function BarcodeImageControls({
  image,
  disabled,
  onSelect,
}: {
  image: ReturnType<typeof useBarcodeImage>;
  disabled: boolean;
  onSelect: (file: File) => void;
}) {
  const t = useTranslations("JobScan");
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <div className="space-y-3">
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-label={t("chooseBarcodeImage")}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onSelect(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full md:min-h-11"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <ImagePlus className="size-4" aria-hidden="true" />
        {t("chooseBarcodeImage")}
      </Button>
      {image.preview && (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-lg bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview preserves barcode resolution */}
            <img
              src={image.preview}
              alt={t("barcodeImagePreview")}
              className="block h-auto w-full"
            />
            {image.cropping && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute border-2 border-white bg-white/10"
                style={{
                  left: `${image.crop.x * 100}%`,
                  top: `${image.crop.y * 100}%`,
                  width: `${image.crop.width * 100}%`,
                  height: `${image.crop.height * 100}%`,
                }}
              />
            )}
          </div>
          {image.busy ? (
            <div className="flex flex-wrap items-center gap-2">
              <p role="status" aria-live="polite" className="flex-1 text-sm">
                {t("readingBarcodeImage")}
              </p>
              <Button type="button" variant="outline" onClick={image.cancel}>
                {t("cancel")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={() => image.setCropping(!image.cropping)}
              >
                <Crop className="size-4" aria-hidden="true" />
                {t("cropBarcodeImage")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={image.retry}
              >
                {t("readBarcodeImage")}
              </Button>
            </div>
          )}
          {image.cropping && (
            <fieldset
              disabled={disabled || image.busy}
              className="grid grid-cols-2 gap-3"
            >
              <legend className="col-span-2 mb-2 text-sm">
                {t("barcodeCropHint")}
              </legend>
              {(["x", "y", "width", "height"] as const).map((field) => (
                <label key={field} className="min-w-0 text-sm">
                  {t(`barcodeCrop.${field}`)}{" "}
                  {Math.round(image.crop[field] * 100)}%
                  <input
                    type="range"
                    min={field === "x" || field === "y" ? 0 : 5}
                    max={
                      field === "x" || field === "y"
                        ? 95
                        : field === "width"
                          ? Math.round((1 - image.crop.x) * 100)
                          : Math.round((1 - image.crop.y) * 100)
                    }
                    value={Math.round(image.crop[field] * 100)}
                    className="block min-h-11 w-full md:min-h-11"
                    onChange={(event) => {
                      const value = Number(event.target.value) / 100;
                      image.setCrop({
                        ...image.crop,
                        [field]: value,
                        ...(field === "x"
                          ? { width: Math.min(image.crop.width, 1 - value) }
                          : {}),
                        ...(field === "y"
                          ? { height: Math.min(image.crop.height, 1 - value) }
                          : {}),
                      });
                    }}
                  />
                </label>
              ))}
            </fieldset>
          )}
        </div>
      )}
      {image.error && (
        <Notice tone="warning" role="alert" title={t(image.error)} />
      )}
      {image.codes.length > 1 && (
        <div className="space-y-2">
          <p role="status" className="text-sm">
            {t("chooseBarcodeValue")}
          </p>
          {image.codes.map((code) => (
            <Button
              key={code}
              type="button"
              variant="outline"
              disabled={disabled}
              className="min-h-11 w-full font-mono break-all whitespace-normal md:min-h-11"
              onClick={() => image.accept(code)}
            >
              {code}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
