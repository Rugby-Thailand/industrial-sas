"use client";

import {
  ArrowLeft,
  Camera,
  Flashlight,
  CircleCheck,
  CopyCheck,
  CircleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFGText } from "./shared";
import { useBarcodeCamera } from "./useBarcodeCamera";

export interface PackageScanCameraProps {
  mode: "PACKAGES" | "LOCATION";
  active: boolean;
  count: number;
  onCode: (code: string) => void;
  onBack: () => void;
  feedback?: {
    kind: "success" | "duplicate" | "error";
    message: string;
    code?: string;
  };
}

export function PackageScanCamera({
  mode,
  active,
  count,
  onCode,
  onBack,
  feedback,
}: PackageScanCameraProps) {
  const { tr } = useFGText();
  const {
    videoRef,
    state,
    error,
    torchAvailable,
    torchOn,
    toggleTorch,
    start,
  } = useBarcodeCamera({ mode, active, onCode });
  const packages = mode === "PACKAGES";
  const errorText =
    error === "PERMISSION"
      ? tr(
          "Camera permission denied. Allow camera access and retry, or use manual verification below.",
          "ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาอนุญาตแล้วลองอีกครั้ง หรือกรอกรหัสด้านล่าง",
        )
      : error === "DECODER"
        ? tr(
            "The camera could not read the code. Retry or use manual verification below.",
            "กล้องอ่านรหัสไม่ได้ ลองอีกครั้ง หรือกรอกรหัสด้านล่าง",
          )
        : error === "TORCH"
          ? tr(
              "Flashlight unavailable. You can continue scanning.",
              "ใช้ไฟฉายไม่ได้ ยังสแกนต่อได้",
            )
          : tr(
              "Camera unavailable. Retry or use manual verification below.",
              "ใช้กล้องไม่ได้ ลองอีกครั้ง หรือกรอกรหัสด้านล่าง",
            );
  return (
    <section
      className="space-y-3"
      aria-label={tr("Code scanner", "เครื่องสแกนรหัส")}
    >
      <div className="relative overflow-hidden rounded-2xl border border-border bg-black text-white">
        <video
          ref={videoRef}
          muted
          playsInline
          className="h-[min(64vh,34rem)] min-h-80 w-full object-cover"
          aria-label={tr(
            "Package and location camera preview",
            "ภาพกล้องสแกนบรรจุภัณฑ์และจุดจัดเก็บ",
          )}
        />
        <div className="absolute inset-x-0 top-0 flex items-start gap-3 bg-gradient-to-b from-black/90 to-transparent p-4 pb-12">
          <Button
            type="button"
            variant="ghost"
            className="size-11 shrink-0 text-white hover:bg-white/20 hover:text-white"
            onClick={onBack}
            aria-label={tr("Back", "ย้อนกลับ")}
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </Button>
          <div className="min-w-0 flex-1 pt-1">
            <h1 className="text-xl font-semibold">
              {packages
                ? tr("Scan Packages", "สแกนบรรจุภัณฑ์")
                : tr("Scan Location", "สแกนจุดจัดเก็บ")}
            </h1>
            <p className="mt-1 text-sm text-white/85">
              {packages
                ? tr("Scan packages in order", "สแกนบรรจุภัณฑ์ตามลำดับ")
                : tr("Scan the warehouse location", "สแกนจุดจัดเก็บในคลัง")}
            </p>
          </div>
          {torchAvailable && (
            <Button
              type="button"
              variant="ghost"
              className="size-11 shrink-0 text-white hover:bg-white/20 hover:text-white"
              aria-label={tr("Flashlight", "ไฟฉาย")}
              aria-pressed={torchOn}
              onClick={() => void toggleTorch()}
            >
              <Flashlight aria-hidden="true" className="size-5" />
            </Button>
          )}
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[12%] top-[32%] h-[38%] rounded-2xl border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.12)]"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 to-transparent px-5 pt-14 pb-5">
          <p className="text-lg font-semibold">
            {tr(`${count} packages`, `${count} บรรจุภัณฑ์`)}
          </p>
          {!packages && (
            <p className="mt-1 text-sm">
              {tr("Will be assigned to this location", "จะจัดเก็บที่จุดนี้")}
            </p>
          )}
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="mt-3 min-h-20"
          >
            {feedback ? (
              <div
                className={`pointer-events-none flex items-start gap-3 rounded-xl border-2 bg-surface p-3 text-text shadow-lg ${feedback.kind === "success" ? "border-success" : feedback.kind === "duplicate" ? "border-warning" : "border-danger"}`}
              >
                {feedback.kind === "success" ? (
                  <CircleCheck
                    aria-hidden="true"
                    className="mt-0.5 size-7 shrink-0 text-success"
                  />
                ) : feedback.kind === "duplicate" ? (
                  <CopyCheck
                    aria-hidden="true"
                    className="mt-0.5 size-7 shrink-0 text-warning"
                  />
                ) : (
                  <CircleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-7 shrink-0 text-danger"
                  />
                )}
                <div className="min-w-0">
                  <p className="text-base font-semibold">{feedback.message}</p>
                  {feedback.code && (
                    <p className="mt-1 font-mono text-lg font-bold break-all">
                      {feedback.code}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm">
                {!active
                  ? tr("Camera paused", "พักกล้องแล้ว")
                  : state === "STARTING"
                    ? tr("Starting camera…", "กำลังเปิดกล้อง…")
                    : state === "ACTIVE"
                      ? tr(
                          "Position a barcode or QR code inside the frame",
                          "วางบาร์โค้ดหรือคิวอาร์โค้ดในกรอบ",
                        )
                      : tr(
                          "Start the camera or enter a code below",
                          "เปิดกล้องหรือกรอกรหัสด้านล่าง",
                        )}
              </p>
            )}
          </div>
        </div>
      </div>
      {active && state !== "ACTIVE" && state !== "STARTING" && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full"
          onClick={start}
        >
          <Camera aria-hidden="true" className="size-4" />
          {error
            ? tr("Retry camera", "ลองเปิดกล้องอีกครั้ง")
            : tr("Start camera", "เปิดกล้อง")}
        </Button>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-border bg-surface p-3 text-sm"
        >
          {errorText}
        </p>
      )}
    </section>
  );
}
