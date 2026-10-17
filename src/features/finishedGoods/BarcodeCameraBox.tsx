"use client";

import { useState, type ReactNode } from "react";
import { Camera, Flashlight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Notice } from "@/components/ui/Notice";
import { cn } from "@/lib/utils";
import { useBarcodeCamera } from "./useBarcodeCamera";
import { BarcodeImagePicker } from "./BarcodeImagePicker";
import {
  CameraFrame,
  cameraMediaClass,
  cameraOverlayButtonClass,
  useVideoAspect,
} from "./CameraFrame";
import type { BarcodeImageTarget } from "./barcodeImage";
import type { BarcodeCrop } from "./barcodeDecoder";

/** Shared acquisition and controls for continuous intake and single-code verification. */
export function BarcodeCameraBox({
  mode,
  onCode,
  onClose,
  onStart,
  feedback,
  videoLabel,
  startOnMount = true,
  disabled = false,
  stopAfterScan = false,
  closeControl = true,
  imageTarget = mode === "LOCATION" ? "LOCATION" : "ANY",
  onImageCodes,
  onReadWithAi,
  presentation = "default",
  children,
}: {
  mode: "PACKAGES" | "LOCATION";
  onCode: (code: string) => void;
  onClose?: () => void;
  /** An explicit Start or Retry attempt, after disabled/startup gates pass. */
  onStart?: () => void;
  feedback?: string | undefined;
  videoLabel?: string;
  startOnMount?: boolean;
  disabled?: boolean;
  stopAfterScan?: boolean;
  /** Hide the frame's close control when the owning dialog already provides one. */
  closeControl?: boolean;
  imageTarget?: BarcodeImageTarget;
  onImageCodes?: (codes: string[]) => void;
  onReadWithAi?: (file?: File, crop?: BarcodeCrop) => void;
  /**
   * `expanded` gives the live preview more of the viewport and reduces the
   * image picker to an icon, for a screen whose main task is this scan.
   */
  presentation?: "default" | "expanded";
  children?: (scan: { stopCamera: () => void }) => ReactNode;
}) {
  const t = useTranslations("JobScan");
  const [camera, setCamera] = useState(startOnMount);
  const [imageSession, setImageSession] = useState(0);
  const video = useVideoAspect(16 / 9);
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
    onCode: receive,
  });
  function receive(code: string) {
    if (disabled) return;
    if (stopAfterScan) close();
    onCode(code);
  }
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
    onStart?.();
    setImageSession((session) => session + 1);
    if (camera) start();
    else setCamera(true);
  }
  return (
    <div className="space-y-3">
      <CameraFrame
        hidden={!camera}
        status={retry ? "error" : state === "ACTIVE" ? "active" : "starting"}
        statusLabel={t("startingCamera")}
        aspect={video.aspect}
        size={presentation === "expanded" ? "large" : "default"}
        onClose={closeControl ? close : undefined}
        closeLabel={t("stopCamera")}
        topStart={
          torchAvailable ? (
            <IconButton
              variant="ghost"
              className={cameraOverlayButtonClass}
              aria-pressed={torchOn}
              label={t("flashlight")}
              onClick={() => void toggleTorch()}
            >
              <Flashlight
                className="size-5 drop-shadow-sm"
                aria-hidden="true"
              />
            </IconButton>
          ) : undefined
        }
      >
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label={videoLabel ?? t("cameraPreview")}
          {...video.videoProps}
          className={cn(cameraMediaClass, retry && "invisible")}
        />
        {state === "ACTIVE" && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-[10%] top-[37.5%] h-1/4 rounded-xl border-2 border-white/80"
          />
        )}
      </CameraFrame>
      {camera && error ? (
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
      ) : feedback || (camera && state === "ACTIVE") ? (
        <p role="status" aria-live="polite" className="min-h-5 text-sm">
          {feedback ?? t("pointCamera")}
        </p>
      ) : null}
      {camera && retry && (
        <Button
          type="button"
          variant="outline"
          className="min-h-12 w-full"
          onClick={open}
          disabled={scanDisabled}
        >
          {t("retryCamera")}
        </Button>
      )}
      {!camera && (
        <Button
          type="button"
          variant="outline"
          className="min-h-12 w-full"
          onClick={open}
          disabled={scanDisabled}
        >
          <Camera className="size-4" aria-hidden="true" />
          {t("startCamera")}
        </Button>
      )}
      <BarcodeImagePicker
        key={`${imageSession}:${imageTarget}:${disabled}`}
        target={imageTarget}
        compact={presentation === "expanded"}
        onReadWithAi={
          onReadWithAi
            ? (file, crop) => {
                stop();
                setCamera(false);
                setImageSession((session) => session + 1);
                onReadWithAi(file, crop);
              }
            : undefined
        }
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
          if (stopAfterScan) close();
          if (onImageCodes) onImageCodes(codes);
          else for (const code of codes) onCode(code);
        }}
      />
      {children?.({ stopCamera: close })}
    </div>
  );
}
