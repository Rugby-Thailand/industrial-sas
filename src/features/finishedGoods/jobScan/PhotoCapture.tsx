"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { ImagePlus, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Notice } from "@/components/ui/Notice";
import { JobScanPhotoPreview } from "./JobScanPhotoPreview";
import { StillPhotoCamera } from "./StillPhotoCamera";

export const MAX_PHOTOS = 20;
const MAX_BYTES = 25 * 1024 * 1024;

type Photo = { id: number; file: File; preview: string };
type PhotoProblem = "imageType" | "imageSize" | "photoLimit";

const ticketFileName = () => `job-ticket-${Date.now()}.jpg`;

/** In-page camera plus multi-select; every collected photo is handed to the AI together. */
export function PhotoCapture({
  onSubmit,
  onClose,
}: {
  onSubmit: (files: File[]) => void;
  onClose: () => void;
}) {
  const t = useTranslations("JobScan");
  const input = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  // The synchronous source of truth for the limit; React state only renders it.
  const collected = useRef<Photo[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [problem, setProblem] = useState<PhotoProblem>();

  useEffect(
    () => () => {
      for (const photo of collected.current) URL.revokeObjectURL(photo.preview);
      collected.current = [];
    },
    [],
  );

  function commit(next: Photo[]) {
    collected.current = next;
    setPhotos(next);
  }

  function add(files: readonly File[]) {
    const accepted: Photo[] = [];
    let found: PhotoProblem | undefined;
    for (const file of files) {
      if (!file.type.startsWith("image/")) found = "imageType";
      else if (!file.size || file.size > MAX_BYTES) found = "imageSize";
      else if (collected.current.length + accepted.length >= MAX_PHOTOS)
        found = "photoLimit";
      else
        accepted.push({
          id: nextId.current++,
          file,
          preview: URL.createObjectURL(file),
        });
    }
    if (accepted.length) commit([...collected.current, ...accepted]);
    setProblem(found);
  }

  function clear() {
    for (const photo of collected.current) URL.revokeObjectURL(photo.preview);
    commit([]);
    setProblem(undefined);
  }

  function remove(id: number) {
    const photo = collected.current.find((item) => item.id === id);
    if (!photo) return;
    URL.revokeObjectURL(photo.preview);
    commit(collected.current.filter((item) => item.id !== id));
    setProblem(undefined);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    add([...event.dataTransfer.files]);
  }

  const full = photos.length >= MAX_PHOTOS;

  return (
    <div
      className="space-y-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={drop}
    >
      <StillPhotoCamera
        onPhoto={(file) => add([file])}
        onClose={onClose}
        closeLabel={t("closePhotoAi")}
        captureLabel={t("takePhoto")}
        fileName={ticketFileName}
        canCapture={() => collected.current.length < MAX_PHOTOS}
        captureDisabled={full}
      />
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label={t("choosePhotos")}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          add(files);
        }}
      />

      {photos.length > 0 && (
        <div className="flex items-center gap-3">
          <ul
            aria-label={t("collectedPhotos")}
            className="flex min-w-0 flex-1 gap-3 overflow-x-auto pt-3 pr-3 pb-1"
          >
            {photos.map((photo, index) => (
              <li key={photo.id} className="relative shrink-0">
                <JobScanPhotoPreview
                  src={photo.preview}
                  thumbnailClassName="h-20 w-16 rounded-md border border-border object-cover"
                />
                <button
                  type="button"
                  onClick={() => remove(photo.id)}
                  aria-label={t("removePhoto", { index: index + 1 })}
                  className="absolute -top-3 -right-3 flex size-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="flex size-6 items-center justify-center rounded-full bg-black/70 text-white">
                    <X className="size-4" aria-hidden="true" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p
            role="status"
            className="shrink-0 text-sm whitespace-nowrap text-muted"
          >
            {t("photoCount", { count: photos.length, max: MAX_PHOTOS })}
          </p>
        </div>
      )}

      {problem && (
        <Notice
          tone="warning"
          role="alert"
          title={t(problem, { max: MAX_PHOTOS })}
        />
      )}

      <div className="flex items-center gap-2">
        <IconButton
          label={t("choosePhotos")}
          variant="ghost"
          disabled={full}
          onClick={() => input.current?.click()}
        >
          <ImagePlus className="size-5" aria-hidden="true" />
        </IconButton>
        <Button
          type="button"
          className="min-h-12 min-w-0 flex-1 whitespace-normal"
          disabled={!photos.length}
          onClick={() => {
            const files = collected.current.map((photo) => photo.file);
            if (!files.length) return;
            onSubmit(files);
            clear();
          }}
        >
          <Sparkles className="size-4" aria-hidden="true" />
          {t("sendToAi", { count: photos.length })}
        </Button>
      </div>
      <p className="text-sm text-muted">{t("photoHint")}</p>
    </div>
  );
}
