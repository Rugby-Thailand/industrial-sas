"use client";

import { useRef, type DragEvent } from "react";
import { ImagePlus, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Notice } from "@/components/ui/Notice";
import { JobScanPhotoPreview } from "./JobScanPhotoPreview";
import {
  StillPhotoCamera,
  type StillPhotoCameraHandle,
} from "./StillPhotoCamera";
import { usePhotoSelection } from "./usePhotoSelection";

export { MAX_PHOTOS } from "./usePhotoSelection";

const ticketFileName = () => `job-ticket-${Date.now()}.jpg`;

/** In-page camera plus multi-select; each collected photo becomes one AI ticket. */
export function PhotoCapture({
  onSubmit,
  onClose,
  selection,
}: {
  onSubmit: (files: File[]) => void;
  onClose: () => void;
  selection?: ReturnType<typeof usePhotoSelection>;
}) {
  const t = useTranslations("JobScan");
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<StillPhotoCameraHandle>(null);
  const localSelection = usePhotoSelection();
  const { photos, problem, add, remove, clear, getFiles, canCapture, limit } =
    selection ?? localSelection;

  function close() {
    camera.current?.stop();
    if (!selection) clear();
    onClose();
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    add([...event.dataTransfer.files]);
  }

  const full = photos.length >= limit;

  return (
    <div
      className="space-y-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={drop}
    >
      <StillPhotoCamera
        ref={camera}
        onPhoto={(file) => add([file], "camera")}
        onClose={close}
        closeLabel={t("closePhotoAi")}
        captureLabel={t("takePhoto")}
        fileName={ticketFileName}
        canCapture={canCapture}
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
            {t("photoCount", { count: photos.length, max: limit })}
          </p>
        </div>
      )}

      {problem && (
        <Notice
          tone="warning"
          role="alert"
          title={t(problem, { max: limit })}
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
          disabled={!photos.length || photos.length > limit}
          onClick={() => {
            const files = getFiles();
            if (!files.length) return;
            camera.current?.stop();
            clear();
            onSubmit(files);
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
