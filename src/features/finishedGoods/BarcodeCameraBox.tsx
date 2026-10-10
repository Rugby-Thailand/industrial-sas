"use client";

import { useState, type ReactNode } from "react";
import { Flashlight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Notice } from "@/components/ui/Notice";
import { useBarcodeCamera } from "./useBarcodeCamera";
import { BarcodeImagePicker } from "./BarcodeImagePicker";
import type { BarcodeImageTarget } from "./barcodeImage";

/** Shared acquisition and controls for continuous intake and single-code verification. */
export function BarcodeCameraBox({
  mode,
  onCode,
  onClose,
  feedback,
  videoLabel,
  startOnMount = true,
  disabled = false,
  stopAfterScan = false,
  imageTarget = mode === "LOCATION" ? "LOCATION" : "ANY",
  onImageCodes,
  children,
}: {
  mode: "PACKAGES" | "LOCATION";
  onCode: (code: string) => void;
  onClose?: () => void;
  feedback?: string | undefined;
  videoLabel?: string;
  startOnMount?: boolean;
  disabled?: boolean;
  stopAfterScan?: boolean;
  imageTarget?: BarcodeImageTarget;
  onImageCodes?: (codes: string[]) => void;
  children?: (scan: {
    onScan: () => void;
    scanning: boolean;
    scanDisabled: boolean;
    stopCamera: () => void;
  }) => ReactNode;
}) {
  const t = useTranslations("JobScan");
  const [camera, setCamera] = useState(startOnMount);
  const [imageSession, setImageSession] = useState(0);
  if (disabled && camera) setCamera(false);
  const {
    videoRef,
    state,
    error,
    torchAvailable,
    torchOn,
    toggleTorch,
    start,
    stop,
  } = useBarcodeCamera({
    mode,
    active: camera && !disabled,
    onCode: (code) => {
      if (stopAfterScan) close();
      onCode(code);
    },
  });
  const retry = error && error !== "TORCH";
  const startupPending = !camera && state === "STARTING";
  const scanDisabled = disabled || startupPending;
  function close() {
    stop();
    setCamera(false);
    setImageSession((session) => session + 1);
    onClose?.();
  }
  function open() {
    if (scanDisabled) return;
    setImageSession((session) => session + 1);
    if (camera) start();
    else setCamera(true);
  }
  return (
    <div className="space-y-2">
      <BarcodeImagePicker
        key={`${imageSession}:${imageTarget}:${disabled}`}
        target={imageTarget}
        disabled={disabled}
        onSelect={() => {
          // Switching sources releases the stream without cancelling its owning workflow.
          stop();
          setCamera(false);
        }}
        onCodes={(codes) => {
          if (disabled) return;
          stop();
          setCamera(false);
          if (onImageCodes) onImageCodes(codes);
          else for (const code of codes) onCode(code);
        }}
      />
      <div
        hidden={!camera}
        className="relative overflow-hidden rounded-xl bg-black"
      >
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label={videoLabel ?? t("cameraPreview")}
          className="aspect-[4/3] max-h-80 w-full object-cover"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[15%] top-[25%] h-1/2 rounded-xl border-2 border-white/80"
        />
        {torchAvailable && (
          <IconButton
            variant="ghost"
            className="absolute top-2 right-2 size-11 text-white hover:bg-white/20"
            aria-pressed={torchOn}
            label={t("flashlight")}
            onClick={() => void toggleTorch()}
          >
            <Flashlight className="size-5" aria-hidden="true" />
          </IconButton>
        )}
      </div>
      {error ? (
        <Notice
          tone="warning"
          role="alert"
          title={t(
            error === "PERMISSION"
              ? "cameraPermission"
              : error === "DECODER"
                ? "cameraDecoderError"
                : error === "TORCH"
                  ? "flashlightError"
                  : "cameraError",
          )}
        />
      ) : camera ? (
        <p role="status" aria-live="polite" className="min-h-5 text-sm">
          {feedback ??
            (state === "ACTIVE" ? t("pointCamera") : t("startingCamera"))}
        </p>
      ) : null}
      {retry && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full"
          onClick={open}
          disabled={scanDisabled}
        >
          {t("retryCamera")}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full"
        onClick={camera ? close : open}
        disabled={scanDisabled}
      >
        {t(camera ? "stopCamera" : "startCamera")}
      </Button>
      {children?.({
        onScan: () => (camera && !retry ? close() : open()),
        scanning: camera && !retry,
        scanDisabled,
        stopCamera: close,
      })}
    </div>
  );
}
