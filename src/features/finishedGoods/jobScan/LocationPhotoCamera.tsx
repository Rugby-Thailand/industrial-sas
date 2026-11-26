"use client";

import type { ReactNode, Ref } from "react";
import { useTranslations } from "next-intl";
import {
  StillPhotoCamera,
  type StillPhotoCameraHandle,
} from "./StillPhotoCamera";

export type LocationPhotoCameraHandle = StillPhotoCameraHandle;

const locationFileName = () => "location-label.jpg";

/** One camera stream, one still photo; the caller can keep a retake live until its replacement is validated. */
export function LocationPhotoCamera({
  onPhoto,
  onClose,
  closeLabel,
  errorAction,
  presentation = "fullscreen",
  stopAfterCapture = true,
  dock,
  ref,
}: {
  ref?: Ref<LocationPhotoCameraHandle>;
  onPhoto: (file: File) => void;
  onClose?: () => void;
  /** Name the actual return when this camera is nested over a retained photo. */
  closeLabel?: string;
  errorAction?: ReactNode;
  presentation?: "default" | "fullscreen";
  stopAfterCapture?: boolean;
  dock?: (shutter: ReactNode) => ReactNode;
}) {
  const t = useTranslations("JobScan");
  return (
    <StillPhotoCamera
      {...(ref ? { ref } : {})}
      onPhoto={onPhoto}
      {...(onClose
        ? { onClose, closeLabel: closeLabel ?? t("closePhotoAi") }
        : {})}
      captureLabel={t("takeLocationPhoto")}
      fileName={locationFileName}
      stopAfterCapture={stopAfterCapture}
      errorAction={errorAction}
      presentation={presentation}
      {...(dock ? { dock } : {})}
    />
  );
}
