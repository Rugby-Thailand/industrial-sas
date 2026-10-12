"use client";

import { useImperativeHandle, type ReactNode, type Ref } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { CameraFrame, cameraMediaClass, useVideoAspect } from "../CameraFrame";
import { useStillPhotoCamera } from "./useStillPhotoCamera";

export interface StillPhotoCameraHandle {
  /** Release the stream synchronously, before another source takes over. */
  stop: () => void;
}

/** The in-app still camera used by every photo screen: frame, shutter, close and retry. */
export function StillPhotoCamera({
  ref,
  onPhoto,
  onClose,
  closeLabel,
  captureLabel,
  fileName,
  canCapture,
  captureDisabled = false,
  stopAfterCapture = false,
  errorAction,
}: {
  ref?: Ref<StillPhotoCameraHandle>;
  onPhoto: (file: File) => void;
  onClose?: () => void;
  closeLabel?: string;
  captureLabel: string;
  fileName: () => string;
  canCapture?: () => boolean;
  captureDisabled?: boolean;
  stopAfterCapture?: boolean;
  /** A fallback offered only when the in-app camera cannot be used. */
  errorAction?: ReactNode;
}) {
  const t = useTranslations("JobScan");
  const { videoRef, state, capture, stop, retry } = useStillPhotoCamera({
    onPhoto,
    fileName,
    stopAfterCapture,
    ...(canCapture ? { canCapture } : {}),
  });
  const video = useVideoAspect();
  useImperativeHandle(ref, () => ({ stop }), [stop]);
  const status =
    state === "on" ? "active" : state === "error" ? "error" : "starting";

  return (
    <div className="space-y-3">
      <CameraFrame
        status={status}
        statusLabel={t("startingCamera")}
        aspect={video.aspect}
        onClose={onClose}
        {...(closeLabel ? { closeLabel } : {})}
        shutter={{
          label: captureLabel,
          disabled: state !== "on" || captureDisabled,
          onPress: capture,
        }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label={t("photoCameraPreview")}
          {...video.videoProps}
          className={cameraMediaClass}
        />
      </CameraFrame>
      {state === "error" && (
        <>
          <Notice tone="warning" role="alert" title={t("cameraPermission")} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-12 flex-1"
              onClick={retry}
            >
              {t("retryCamera")}
            </Button>
            {errorAction}
          </div>
        </>
      )}
    </div>
  );
}
