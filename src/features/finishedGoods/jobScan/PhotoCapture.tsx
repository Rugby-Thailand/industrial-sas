"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CircleAlert, ImagePlus, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useFileUpload } from "@/hooks/use-file-upload";
import { cn } from "@/lib/utils";
import { JobScanPhotoPreview } from "./JobScanPhotoPreview";

const MAX_PHOTOS = 20;

/** In-page camera plus multi-select; every collected photo is handed to the AI together. */
export function PhotoCapture({
  onSubmit,
  onClose,
}: {
  onSubmit: (files: File[]) => void;
  onClose: () => void;
}) {
  const t = useTranslations("JobScan");
  const videoRef = useRef<HTMLVideoElement>(null);
  // Only rendered after a tap, so the browser APIs are available here.
  const [cameraState, setCameraState] = useState<"STARTING" | "ON" | "ERROR">(
    () =>
      "getUserMedia" in (navigator.mediaDevices ?? {}) ? "STARTING" : "ERROR",
  );
  const [
    { files, isDragging, errors },
    {
      addFiles,
      removeFile,
      clearFiles,
      handleDragEnter,
      handleDragLeave,
      handleDragOver,
      handleDrop,
      openFileDialog,
      getInputProps,
    },
  ] = useFileUpload({
    accept: "image/*",
    multiple: true,
    maxFiles: MAX_PHOTOS,
    maxSize: 25 * 1024 * 1024,
  });

  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled = false;
    const video = videoRef.current;
    navigator.mediaDevices
      ?.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
      })
      .then((media) => {
        if (cancelled || !video) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        video.srcObject = media;
        void video.play().catch(() => undefined);
        setCameraState("ON");
      })
      .catch(() => !cancelled && setCameraState("ERROR"));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, []);

  function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) =>
        blob &&
        addFiles([
          new File([blob], `job-ticket-${Date.now()}.jpg`, {
            type: "image/jpeg",
          }),
        ]),
      "image/jpeg",
      0.9,
    );
  }

  const photos = files.flatMap((item) =>
    item.file instanceof File
      ? [{ id: item.id, file: item.file, preview: item.preview }]
      : [],
  );

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border border-dashed p-3 transition-colors",
        isDragging ? "border-link bg-selected" : "border-border-strong",
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input {...getInputProps()} className="sr-only" />
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          muted
          playsInline
          className={cn(
            "aspect-[3/4] max-h-[55vh] w-full object-cover sm:aspect-[4/3]",
            cameraState !== "ON" && "invisible",
          )}
        />
        {cameraState !== "ON" && (
          <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80">
            {cameraState === "ERROR" ? t("cameraError") : t("startingCamera")}
          </p>
        )}
        <button
          type="button"
          onClick={capture}
          disabled={cameraState !== "ON" || photos.length >= MAX_PHOTOS}
          aria-label={t("takePhoto")}
          className="absolute bottom-4 left-1/2 flex size-16 -translate-x-1/2 items-center justify-center rounded-full border-4 border-white bg-white/25 text-white active:scale-95 disabled:opacity-40"
        >
          <Camera className="size-6" aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 flex-1"
          onClick={openFileDialog}
        >
          <ImagePlus className="size-4" aria-hidden="true" />
          {t("choosePhotos")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          onClick={onClose}
        >
          {t("cancel")}
        </Button>
      </div>
      <p className="text-xs text-muted">
        {t("photoHint", { max: MAX_PHOTOS })}
      </p>

      {photos.length > 0 && (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {photos.map((photo, index) => (
            <li key={photo.id} className="relative">
              {photo.preview ? (
                <JobScanPhotoPreview
                  src={photo.preview}
                  thumbnailClassName="aspect-[3/4] w-full rounded-md border border-border object-cover"
                  triggerClassName="w-full"
                />
              ) : (
                <div className="flex aspect-[3/4] items-center justify-center rounded-md border border-border">
                  <ImagePlus className="size-5 text-muted" aria-hidden="true" />
                </div>
              )}
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-xs text-white">
                {index + 1}
              </span>
              <button
                type="button"
                onClick={() => removeFile(photo.id)}
                aria-label={`${t("remove")} ${index + 1}`}
                className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full bg-black/60 text-white"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {errors.length > 0 && (
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {errors.join(" ")}
        </p>
      )}

      <Button
        type="button"
        className="min-h-12 w-full"
        disabled={!photos.length}
        onClick={() => {
          onSubmit(photos.map((photo) => photo.file));
          clearFiles();
        }}
      >
        <Sparkles className="size-4" aria-hidden="true" />
        {t("sendToAi", { count: photos.length })}
      </Button>
    </div>
  );
}
