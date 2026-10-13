"use client";
import { useBackDisclosure } from "@/hooks/useBackDisclosure";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";
import { Camera, ImagePlus, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/IconButton";
import { Notice } from "@/components/ui/Notice";
import { barcodeImageProblem, type BarcodeCrop } from "../barcodeDecoder";
import { CameraFrame } from "../CameraFrame";
import type {
  LocationImageResult,
  LocationLabelCandidate,
} from "../../../../convex/model/finishedGoods/locationImage";
import {
  LocationPhotoCamera,
  type LocationPhotoCameraHandle,
} from "./LocationPhotoCamera";
import { prepareLocationImage } from "./prepareLocationImage";

export interface LocationPhoto {
  file: File;
  crop?: BarcodeCrop;
}

/** The reader owns the photo's preview URL and acquisition lifetime. */
export function locationPhoto(file: File, crop?: BarcodeCrop): LocationPhoto {
  return {
    file,
    ...(crop ? { crop } : {}),
  };
}

/** One location photo, read automatically; the code is reviewed before lookup. */
export function LocationImageReader({
  initialPhoto,
  extract,
  onConfirm,
  onClose,
  retryOverPhoto = false,
}: {
  initialPhoto?: LocationPhoto;
  extract: (imageDataUrl: string) => Promise<LocationImageResult>;
  onConfirm: (code: string) => void;
  onClose: () => void;
  /**
   * Offer "read this photo again" as one button centred on the photo, in
   * place of the full-width retry and the take-another-photo icon.
   */
  retryOverPhoto?: boolean;
}) {
  const t = useTranslations("JobScan");
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const capture = useRef<HTMLInputElement>(null);
  const photoCamera = useRef<LocationPhotoCameraHandle>(null);
  const [photo, setPhoto] = useState(initialPhoto);
  const [cameraOpen, setCameraOpen] = useState(!initialPhoto);
  const cameraDisclosure = useBackDisclosure(
    cameraOpen && photo !== undefined,
    setCameraOpen,
  );
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<
    readonly LocationLabelCandidate[]
  >([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const version = useRef(0);
  const pending = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const cancelPending = useCallback(() => {
    version.current++;
    abort.current?.abort();
  }, []);

  function invalidate() {
    cancelPending();
    pending.current = false;
    setBusy(false);
    setCandidates([]);
    setCode("");
    setError(undefined);
  }
  function select(file: File) {
    invalidate();
    // A gallery photo replaces the live camera before any late capture can land.
    photoCamera.current?.stop();
    setCameraOpen(false);
    const problem = barcodeImageProblem(file);
    if (problem) {
      setPhoto(undefined);
      setError(problem);
      return;
    }
    setPhoto(locationPhoto(file));
  }
  function close() {
    invalidate();
    photoCamera.current?.stop();
    onClose();
  }
  const read = useEffectEvent(async () => {
    if (!photo || pending.current) return;
    pending.current = true;
    const token = ++version.current;
    const controller = new AbortController();
    abort.current = controller;
    const current = () =>
      token === version.current && !controller.signal.aborted;
    setBusy(true);
    setCandidates([]);
    setCode("");
    setError(undefined);
    try {
      const data = await prepareLocationImage(photo.file, {
        signal: controller.signal,
        ...(photo.crop ? { crop: photo.crop } : {}),
      });
      if (!current()) return;
      const result = await extract(data);
      if (!current()) return;
      if (!result.ok) {
        setError(
          result.error.code === "AI_DENIED"
            ? "locationAiDenied"
            : result.error.code === "IMAGE_URL_INVALID"
              ? "imageSize"
              : result.error.code === "AI_UNREADABLE"
                ? "locationAiUnreadable"
                : "locationAiUnavailable",
        );
      } else if (!result.candidates.length) setError("locationAiUnreadable");
      else {
        setCandidates(result.candidates);
        if (result.candidates.length === 1) setCode(result.candidates[0]!.code);
      }
    } catch (cause) {
      if (current())
        setError(
          cause instanceof Error &&
            ["imageType", "imageSize", "imageUnreadable"].includes(
              cause.message,
            )
            ? cause.message
            : "locationAiUnavailable",
        );
    } finally {
      if (current()) {
        pending.current = false;
        setBusy(false);
      }
    }
  });

  useEffect(() => {
    const url = photo ? URL.createObjectURL(photo.file) : undefined;
    // Only bind the browser-generated blob scheme, with URI-encoded characters.
    const source = url?.startsWith("blob:") ? encodeURI(url) : undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser resource allocation and automatic extraction follow the selected photo lifetime
    setPreviewUrl(source);
    pending.current = false;
    if (photo) void read();
    return () => {
      cancelPending();
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo, attempt, cancelPending]);

  const canRetry = Boolean(photo) && !busy && candidates.length === 0;
  // Re-runs the read effect with the same file and crop, once per press.
  const retry = () => setAttempt((value) => value + 1);

  const chooseFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) select(file);
  };

  return (
    <section className="space-y-3" aria-label={t("locationAiTitle")}>
      {cameraOpen ? (
        <LocationPhotoCamera
          ref={photoCamera}
          onPhoto={select}
          onClose={() => {
            if (photo) cameraDisclosure.onOpenChange(false);
            else close();
          }}
          errorAction={
            // The device camera is a fallback only when the in-app camera fails.
            <Button
              type="button"
              variant="outline"
              className="min-h-12 flex-1"
              onClick={() => {
                photoCamera.current?.stop();
                capture.current?.click();
              }}
            >
              <Camera aria-hidden="true" className="size-4" />
              {t("locationAiDeviceCamera")}
            </Button>
          }
        />
      ) : photo ? (
        <CameraFrame
          layout="content"
          onClose={close}
          closeLabel={t("closePhotoAi")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local photo preview and normalized crop share the same geometry */}
          <img
            src={previewUrl}
            alt={t("locationAiPhoto")}
            className="block h-auto max-h-[60dvh] w-auto max-w-full"
          />
          {photo.crop && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute border-2 border-white bg-white/10"
              style={{
                left: `${photo.crop.x * 100}%`,
                top: `${photo.crop.y * 100}%`,
                width: `${photo.crop.width * 100}%`,
                height: `${photo.crop.height * 100}%`,
              }}
            />
          )}
          {retryOverPhoto && canRetry && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <IconButton
                label={t("locationAiRereadPhoto")}
                variant="ghost"
                className="pointer-events-auto size-16 rounded-full bg-black/60 text-white ring-1 ring-white/70 backdrop-blur-sm hover:bg-black/75 hover:text-white focus-visible:outline-white"
                onClick={retry}
              >
                <RotateCcw
                  aria-hidden="true"
                  className="size-7 drop-shadow-sm"
                />
              </IconButton>
            </div>
          )}
        </CameraFrame>
      ) : null}
      <input
        ref={picker}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={t("chooseLocationImage")}
        onChange={chooseFile}
      />
      <input
        ref={capture}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        aria-label={t("locationAiDeviceCamera")}
        onChange={chooseFile}
      />
      {busy ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" aria-live="polite" className="flex-1 text-sm">
            {t("locationAiReading")}
          </p>
          <Button type="button" variant="outline" onClick={invalidate}>
            {t("cancel")}
          </Button>
        </div>
      ) : canRetry && !retryOverPhoto ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-12 w-full"
          onClick={retry}
        >
          {t("locationAiRetry")}
        </Button>
      ) : null}
      {error && <Notice role="alert" tone="warning" title={t(error)} />}
      {candidates.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-semibold">{t("locationAiReview")}</p>
          {candidates.length > 1 && (
            <div className="space-y-2">
              <p className="text-sm">{t("locationAiMultiple")}</p>
              {candidates.map((candidate) => (
                <Button
                  key={candidate.code}
                  type="button"
                  variant="outline"
                  aria-pressed={code === candidate.code}
                  className="w-full break-all whitespace-normal"
                  onClick={() => setCode(candidate.code)}
                >
                  {candidate.code}
                </Button>
              ))}
            </div>
          )}
          <label htmlFor={id} className="sr-only">
            {t("locationAiCode")}
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={id}
              className="min-w-0 flex-1"
              value={code}
              maxLength={200}
              autoComplete="off"
              onChange={(event) => setCode(event.target.value)}
            />
            <Button
              type="button"
              className="shrink-0"
              disabled={!code.trim()}
              onClick={() => onConfirm(code.trim())}
            >
              {t("useLocationAiCode")}
            </Button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-1">
        <IconButton
          label={t("chooseLocationImage")}
          variant="ghost"
          onClick={() => picker.current?.click()}
        >
          <ImagePlus aria-hidden="true" className="size-5" />
        </IconButton>
        {!cameraOpen && !retryOverPhoto && (
          <IconButton
            label={t("locationAiOpenCamera")}
            variant="ghost"
            onClick={() => {
              // Keep the reviewed photo and corrected code until a replacement
              // is actually captured. Back from retake restores this work.
              cancelPending();
              pending.current = false;
              setBusy(false);
              setCameraOpen(true);
            }}
          >
            <RotateCcw aria-hidden="true" className="size-5" />
          </IconButton>
        )}
      </div>
    </section>
  );
}
