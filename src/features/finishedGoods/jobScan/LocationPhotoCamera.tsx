"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type SyntheticEvent,
} from "react";
import { Camera } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { playShutterSound } from "./playShutterSound";
import { Notice } from "@/components/ui/Notice";

export interface LocationPhotoCameraHandle {
  stop: () => void;
}

/** One camera stream, one still photo; an unmounted session releases late grants. */
export function LocationPhotoCamera({
  onPhoto,
  ref,
}: {
  ref?: Ref<LocationPhotoCameraHandle>;
  onPhoto: (file: File) => void;
}) {
  const t = useTranslations("JobScan");
  const video = useRef<HTMLVideoElement>(null);
  const media = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const delivering = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"starting" | "on" | "error">("starting");
  const [videoAspect, setVideoAspect] = useState(16 / 9);

  const stop = useCallback(() => {
    generation.current++;
    delivering.current = false;
    media.current?.getTracks().forEach((track) => track.stop());
    media.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);
  useImperativeHandle(ref, () => ({ stop }), [stop]);

  useEffect(() => {
    const token = ++generation.current;
    const element = video.current;
    const open = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia || !element)
          throw new Error();
        const acquired = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1440 },
          },
        });
        if (token !== generation.current) {
          acquired.getTracks().forEach((track) => track.stop());
          return;
        }
        media.current = acquired;
        element.srcObject = acquired;
        await element.play();
        if (token === generation.current) setState("on");
      } catch {
        if (token !== generation.current) return;
        media.current?.getTracks().forEach((track) => track.stop());
        media.current = null;
        if (element) element.srcObject = null;
        setState("error");
      }
    };
    void open();
    return () => {
      stop();
      if (element) element.srcObject = null;
    };
  }, [attempt, stop]);

  function capture() {
    const element = video.current;
    if (state !== "on" || !element?.videoWidth || delivering.current) return;
    delivering.current = true;
    const token = generation.current;
    const canvas = document.createElement("canvas");
    try {
      if (element.videoWidth * element.videoHeight > 40_000_000)
        throw new Error();
      canvas.width = element.videoWidth;
      canvas.height = element.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error();
      context.drawImage(element, 0, 0);
      playShutterSound();
      canvas.toBlob(
        (blob) => {
          canvas.width = canvas.height = 0;
          if (token !== generation.current) return;
          delivering.current = false;
          if (!blob) {
            stop();
            setState("error");
            return;
          }
          // Stop synchronously so a gallery/camera source switch never overlaps streams.
          stop();
          onPhoto(
            new File([blob], "location-label.jpg", { type: "image/jpeg" }),
          );
        },
        "image/jpeg",
        0.9,
      );
    } catch {
      canvas.width = canvas.height = 0;
      stop();
      setState("error");
    }
  }

  function measureVideo(event: SyntheticEvent<HTMLVideoElement>) {
    const { videoWidth, videoHeight } = event.currentTarget;
    if (videoWidth > 0 && videoHeight > 0)
      setVideoAspect(videoWidth / videoHeight);
  }

  return (
    <div className="space-y-3">
      <div
        hidden={state === "error"}
        className="relative mx-auto w-full overflow-hidden rounded-lg bg-black"
        style={{ aspectRatio: videoAspect, maxWidth: 320 * videoAspect }}
      >
        <video
          ref={video}
          muted
          playsInline
          aria-label={t("cameraPreview")}
          onLoadedMetadata={measureVideo}
          onResize={measureVideo}
          className="block h-full w-full object-contain"
        />
      </div>
      {state === "error" ? (
        <>
          <Notice tone="warning" role="alert" title={t("cameraPermission")} />
          <Button
            type="button"
            variant="outline"
            className="min-h-12 w-full"
            onClick={() => {
              setState("starting");
              setAttempt((current) => current + 1);
            }}
          >
            {t("retryCamera")}
          </Button>
        </>
      ) : (
        <>
          <p role="status" aria-live="polite" className="text-sm text-muted">
            {t(
              state === "starting" ? "startingCamera" : "locationAiCameraHint",
            )}
          </p>
          <Button
            type="button"
            className="min-h-12 w-full"
            disabled={state !== "on"}
            onClick={capture}
          >
            <Camera aria-hidden="true" className="size-4" />
            {t("takeLocationPhoto")}
          </Button>
        </>
      )}
    </div>
  );
}
