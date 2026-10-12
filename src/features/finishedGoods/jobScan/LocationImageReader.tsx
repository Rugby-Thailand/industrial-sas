"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";
import { Camera, ImagePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
}: {
  initialPhoto?: LocationPhoto;
  extract: (imageDataUrl: string) => Promise<LocationImageResult>;
  onConfirm: (code: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("JobScan");
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const capture = useRef<HTMLInputElement>(null);
  const photoCamera = useRef<LocationPhotoCameraHandle>(null);
  const [photo, setPhoto] = useState(initialPhoto);
  const [cameraOpen, setCameraOpen] = useState(!initialPhoto);
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
          onClose={close}
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
      ) : photo && candidates.length === 0 ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-12 w-full"
          onClick={() => setAttempt((value) => value + 1)}
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
          <label htmlFor={id} className="block text-sm">
            {t("locationAiCode")}
          </label>
          <Input
            id={id}
            value={code}
            maxLength={200}
            autoComplete="off"
            onChange={(event) => setCode(event.target.value)}
          />
          <Button
            type="button"
            className="min-h-12 w-full"
            disabled={!code.trim()}
            onClick={() => onConfirm(code.trim())}
          >
            {t("useLocationAiCode")}
          </Button>
        </div>
      )}
      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-12 w-full"
          onClick={() => picker.current?.click()}
        >
          <ImagePlus aria-hidden="true" className="size-4" />
          {t("chooseLocationImage")}
        </Button>
        {!cameraOpen && (
          <Button
            type="button"
            variant="outline"
            className="min-h-12 w-full"
            onClick={() => {
              invalidate();
              setPhoto(undefined);
              setCameraOpen(true);
            }}
          >
            <Camera aria-hidden="true" className="size-4" />
            {t("locationAiOpenCamera")}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted">{t("locationAiHint")}</p>
    </section>
  );
}
