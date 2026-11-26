"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { Camera, ImagePlus, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/IconButton";
import { Notice } from "@/components/ui/Notice";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  useCompletionHandle,
  type DialogCompletionHandle,
} from "@/components/ui/dialog";
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
  closeControl = true,
  completionRef,
  retryOverPhoto = false,
  checking = false,
}: {
  initialPhoto?: LocationPhoto;
  extract: (imageDataUrl: string) => Promise<LocationImageResult>;
  onConfirm: (code: string) => void;
  onClose: () => void;
  /** Hide an equivalent outer close; retaking still has its own return control. */
  closeControl?: boolean;
  /** Cancel processing and consume a retake before the containing acquisition. */
  completionRef?: Ref<DialogCompletionHandle>;
  /**
   * Offer "read this photo again" as one button centred on the photo, in
   * place of the full-width retry and the take-another-photo icon.
   */
  retryOverPhoto?: boolean;
  /** Show read-only lookup progress after confirming a reviewed code. */
  checking?: boolean;
}) {
  const t = useTranslations("JobScan");
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const capture = useRef<HTMLInputElement>(null);
  const photoCamera = useRef<LocationPhotoCameraHandle>(null);
  const retakeOpener = useRef<HTMLButtonElement>(null);
  const retakeCompletion = useRef<DialogCompletionHandle>(null);
  const [photo, setPhoto] = useState(initialPhoto);
  const [cameraOpen, setCameraOpen] = useState(!initialPhoto);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<
    readonly LocationLabelCandidate[]
  >([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [fileError, setFileError] =
    useState<ReturnType<typeof barcodeImageProblem>>();
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
    setFileError(undefined);
  }
  useCompletionHandle(completionRef, (action, onCancel) => {
    invalidate();
    photoCamera.current?.stop();
    // The review lives in its parent dialog. Only an open retake owns another
    // entry; completing an inactive entry would guard the whole ticket draft.
    if (cameraOpen && photo && retakeCompletion.current) {
      retakeCompletion.current.completeOwned?.(() => {
        setCameraOpen(false);
        action();
      }, onCancel);
    } else {
      action();
    }
  });
  function select(file: File) {
    const problem = barcodeImageProblem(file);
    if (problem) {
      // A rejected source leaves both the current camera and any reviewed photo in place.
      setFileError(problem);
      return;
    }
    invalidate();
    photoCamera.current?.stop();
    setCameraOpen(false);
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
          result.error.code === "RATE_LIMITED"
            ? "aiRateLimited"
            : result.error.code === "AI_DENIED"
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
  const retry = () => {
    setFileError(undefined);
    setAttempt((value) => value + 1);
  };

  function chooseImage() {
    setFileError(undefined);
    picker.current?.click();
  }

  const chooseFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) select(file);
  };

  const deviceCameraAction = (
    // The device camera is a fallback only when the in-app camera fails.
    <Button
      type="button"
      variant="outline"
      className="min-h-12 flex-1"
      onClick={() => {
        setFileError(undefined);
        photoCamera.current?.stop();
        capture.current?.click();
      }}
    >
      <Camera aria-hidden="true" className="size-4" />
      {t("locationAiDeviceCamera")}
    </Button>
  );

  const fileWarning = fileError && (
    <Notice role="alert" tone="warning" title={t(fileError)} />
  );
  const cameraDock = (shutter: ReactNode) => (
    <>
      {fileWarning}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg border border-border bg-surface p-3">
        <div className="flex justify-start">
          <Button type="button" variant="outline" onClick={chooseImage}>
            <ImagePlus aria-hidden="true" className="size-5" />
            {t("chooseLocationImage")}
          </Button>
        </div>
        {shutter}
        <div />
      </div>
    </>
  );

  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-3"
      aria-label={t("locationAiTitle")}
    >
      {cameraOpen && !photo ? (
        <LocationPhotoCamera
          ref={photoCamera}
          onPhoto={select}
          {...(closeControl ? { onClose: close } : {})}
          errorAction={deviceCameraAction}
          dock={cameraDock}
        />
      ) : (
        <>
          {photo && (
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <CameraFrame
                layout="content"
                onClose={closeControl ? close : undefined}
                closeLabel={t("closePhotoAi")}
              >
                {/* Crop and reread stay aligned to the media when a short frame grows for its controls. */}
                <div className="relative w-fit max-w-full min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local photo preview and normalized crop share the same geometry */}
                  <img
                    src={previewUrl}
                    alt={t("locationAiPhoto")}
                    className="block h-auto max-h-[55dvh] w-auto max-w-full"
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
                </div>
              </CameraFrame>
            </div>
          )}
          <div className="shrink-0 space-y-3 rounded-lg border border-border bg-surface p-3">
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
            {!cameraOpen && fileWarning}
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
                    disabled={checking}
                    onChange={(event) => setCode(event.target.value)}
                  />
                  <Button
                    type="button"
                    className="shrink-0"
                    disabled={checking || !code.trim()}
                    onClick={() => onConfirm(code.trim())}
                  >
                    {t("useLocationAiCode")}
                  </Button>
                </div>
              </div>
            )}
            {checking && (
              <p role="status" className="text-sm text-muted">
                {t("checkingLocation")}
              </p>
            )}
            <div className="flex items-center gap-1">
              <IconButton
                label={t("chooseLocationImage")}
                variant="ghost"
                disabled={checking}
                onClick={chooseImage}
              >
                <ImagePlus aria-hidden="true" className="size-5" />
              </IconButton>
              {!retryOverPhoto && (
                <IconButton
                  label={t("locationAiOpenCamera")}
                  variant="ghost"
                  disabled={checking}
                  onClick={(event) => {
                    retakeOpener.current = event.currentTarget;
                    // Keep the reviewed photo and corrected code until a replacement
                    // is actually captured. Back from retake restores this work.
                    cancelPending();
                    pending.current = false;
                    setBusy(false);
                    setFileError(undefined);
                    setCameraOpen(true);
                  }}
                >
                  <RotateCcw aria-hidden="true" className="size-5" />
                </IconButton>
              )}
            </div>
          </div>
        </>
      )}
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
      <Dialog
        open={cameraOpen && photo !== undefined}
        onOpenChange={(open) => {
          setFileError(undefined);
          setCameraOpen(open);
        }}
        completionRef={retakeCompletion}
      >
        <DialogContent
          size="camera"
          closeLabel={t("backToPhoto")}
          onCloseAutoFocus={(event) => {
            if (retakeOpener.current?.isConnected) {
              event.preventDefault();
              retakeOpener.current.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("locationAiOpenCamera")}</DialogTitle>
            <DialogDescription>{t("locationAiTitle")}</DialogDescription>
          </DialogHeader>
          {cameraOpen && photo !== undefined && (
            <LocationPhotoCamera
              ref={photoCamera}
              onPhoto={select}
              errorAction={deviceCameraAction}
              dock={cameraDock}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
