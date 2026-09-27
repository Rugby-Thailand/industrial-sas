"use client";

import { Flashlight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useBarcodeCamera } from "../useBarcodeCamera";

/** Inline camera that reports every decoded barcode or QR code. */
export function BarcodeCameraBox({
  mode,
  onCode,
  onClose,
  feedback,
}: {
  mode: "PACKAGES" | "LOCATION";
  onCode: (code: string) => void;
  onClose: () => void;
  feedback?: string | undefined;
}) {
  const t = useTranslations("JobScan");
  const { videoRef, state, error, torchAvailable, torchOn, toggleTorch } =
    useBarcodeCamera({ mode, active: true, onCode });
  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          muted
          playsInline
          className="aspect-[4/3] max-h-80 w-full object-cover"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[15%] top-[25%] h-1/2 rounded-xl border-2 border-white/80"
        />
        {torchAvailable && (
          <Button
            type="button"
            variant="ghost"
            className="absolute top-2 right-2 size-11 text-white hover:bg-white/20"
            aria-pressed={torchOn}
            aria-label="Flashlight"
            onClick={() => void toggleTorch()}
          >
            <Flashlight className="size-5" aria-hidden="true" />
          </Button>
        )}
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm">
        {error
          ? t("cameraError")
          : (feedback ??
            (state === "ACTIVE" ? t("pointCamera") : t("startingCamera")))}
      </p>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full"
        onClick={onClose}
      >
        {t("stopCamera")}
      </Button>
    </div>
  );
}
