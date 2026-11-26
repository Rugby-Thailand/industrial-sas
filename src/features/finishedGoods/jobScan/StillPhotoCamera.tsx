"use client";

import { useImperativeHandle, type ReactNode, type Ref } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import {
  CameraFrame,
  CameraGuide,
  cameraMediaClass,
  fullscreenCameraLayoutClass,
  fullscreenCameraDockClass,
  useVideoAspect,
} from "../CameraFrame";
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
  presentation = "default",
  dock,
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
  presentation?: "default" | "fullscreen";
  dock?: (shutter: ReactNode) => ReactNode;
}) {
  const t = useTranslations("JobScan");
  const fullscreen = presentation === "fullscreen";
  const { videoRef, state, capture, stop, retry } = useStillPhotoCamera({
    onPhoto,
    fileName,
    stopAfterCapture,
    ...(canCapture ? { canCapture } : {}),
  });
  const video = useVideoAspect();
  useImperativeHandle(ref, () => ({ stop }), [stop]);
  const failed = state === "error" || state === "permission";
  const status = state === "on" ? "active" : failed ? "error" : "starting";

  const shutter = {
    label: captureLabel,
    disabled: state !== "on" || captureDisabled,
    onPress: capture,
  };

  return (
    <div className={fullscreen ? fullscreenCameraLayoutClass : "space-y-3"}>
      <CameraFrame
        status={status}
        statusLabel={t("startingCamera")}
        aspect={video.aspect}
        size={fullscreen ? "fullscreen" : "default"}
        onClose={onClose}
        {...(closeLabel ? { closeLabel } : {})}
        {...(!dock ? { shutter } : {})}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label={t("photoCameraPreview")}
          {...video.videoProps}
          className={cameraMediaClass}
        />
        {fullscreen && state === "on" && <CameraGuide shape="photo" />}
      </CameraFrame>
      {(failed || dock) && (
        <div className={fullscreen ? fullscreenCameraDockClass : "space-y-3"}>
          {failed && (
            <>
              <Notice
                tone="warning"
                role="alert"
                title={t(
                  state === "permission" ? "cameraPermission" : "cameraError",
                )}
              />
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
          {dock?.(
            <button
              type="button"
              aria-label={shutter.label}
              disabled={shutter.disabled}
              onClick={shutter.onPress}
              className="grid size-14 shrink-0 place-items-center rounded-full border-2 border-white p-1 focus-ring active:scale-95 disabled:opacity-40"
            >
              <span
                aria-hidden="true"
                className="size-full rounded-full bg-white"
              />
            </button>,
          )}
        </div>
      )}
    </div>
  );
}
