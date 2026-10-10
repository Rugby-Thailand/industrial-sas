"use client";

import { useState, type ReactNode, type SyntheticEvent } from "react";
import { Flashlight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Notice } from "@/components/ui/Notice";
import { useBarcodeCamera } from "./useBarcodeCamera";
import { useBarcodeImage } from "./useBarcodeImage";
import { BarcodeImageControls } from "./BarcodeImageControls";
import type { BarcodeCrop } from "./barcodeDecoder";

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
  onReadWithAi,
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
  onReadWithAi?: (file?: File, crop?: BarcodeCrop) => void;
  children?: (scan: {
    onScan: () => void;
    scanning: boolean;
    scanDisabled: boolean;
    stopCamera: () => void;
  }) => ReactNode;
}) {
  const t = useTranslations("JobScan");
  const [camera, setCamera] = useState(startOnMount);
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const image = useBarcodeImage(receive, disabled);
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
    image.cancel();
    stop();
    setCamera(false);
    onClose?.();
  }
  function open() {
    if (scanDisabled) return;
    image.cancel();
    if (camera) start();
    else setCamera(true);
  }
  function measureVideo(event: SyntheticEvent<HTMLVideoElement>) {
    const { videoWidth, videoHeight } = event.currentTarget;
    if (videoWidth > 0 && videoHeight > 0)
      setVideoAspect(videoWidth / videoHeight);
  }
  return (
    <div className="space-y-2">
      <div
        hidden={!camera || (state !== "ACTIVE" && state !== "STARTING")}
        className="relative mx-auto w-full overflow-hidden rounded-xl bg-black"
        style={{ aspectRatio: videoAspect, maxWidth: 320 * videoAspect }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label={videoLabel ?? t("cameraPreview")}
          onLoadedMetadata={measureVideo}
          onResize={measureVideo}
          className="block h-full w-full object-contain"
        />
        {state === "ACTIVE" && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-[10%] top-[37.5%] h-1/4 rounded-xl border-2 border-white/80"
          />
        )}
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
      ) : camera ? (
        <p role="status" aria-live="polite" className="min-h-5 text-sm">
          {feedback ??
            (state === "ACTIVE" ? t("pointCamera") : t("startingCamera"))}
        </p>
      ) : null}
      {camera && retry && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full md:min-h-11"
          onClick={open}
          disabled={scanDisabled}
        >
          {t("retryCamera")}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full md:min-h-11"
        onClick={camera ? close : open}
        disabled={scanDisabled}
      >
        {t(camera ? "stopCamera" : "startCamera")}
      </Button>
      <BarcodeImageControls
        image={image}
        disabled={disabled}
        onSelect={(file) => {
          stop();
          setCamera(false);
          image.select(file);
        }}
      />
      {onReadWithAi && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full md:min-h-11"
          disabled={disabled}
          onClick={() => {
            const file = image.file;
            const crop = image.cropping ? image.crop : undefined;
            stop();
            image.cancel();
            setCamera(false);
            onReadWithAi(file, crop);
          }}
        >
          {t("readLocationAi")}
        </Button>
      )}
      {children?.({
        onScan: () => (camera && !retry ? close() : open()),
        scanning: camera && !retry,
        scanDisabled,
        stopCamera: close,
      })}
    </div>
  );
}
