"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Camera, ImagePlus, Keyboard, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  type DialogCompletionHandle,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/Notice";
import type { RefValue } from "@/lib/convex/clientRef";
import type { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { barcodeImageProblem } from "../barcodeDecoder";
import { prepareLocationImage } from "./prepareLocationImage";
import {
  StillPhotoCamera,
  type StillPhotoCameraHandle,
} from "./StillPhotoCamera";

export type TicketPhotoSearchField = "factoryOrder" | "productBarcodeText";

export type TicketPhotoReadResult =
  | RefValue<typeof fgRefs.readJobTicketForSearch>
  | { ok: false; error: { code: "AI_DENIED" } };

export type TicketPhotoSearch = {
  search: string;
  searchField: TicketPhotoSearchField;
};

const FIELDS: readonly TicketPhotoSearchField[] = [
  "factoryOrder",
  "productBarcodeText",
];
const IMAGE_ERRORS = ["imageType", "imageSize", "imageUnreadable"];
const fileName = () => "ticket-search.jpg";

function readCandidates(result: TicketPhotoReadResult) {
  if (!result.ok) return [];
  return FIELDS.flatMap((field) => {
    const value = result.candidates[field]?.trim();
    return value && value.length <= 200 && !/\p{C}/u.test(value)
      ? [{ field, value }]
      : [];
  });
}

function readError(code: string) {
  return code === "RATE_LIMITED"
    ? "aiRateLimited"
    : code === "IMAGE_URL_INVALID"
      ? "imageSize"
      : code === "AI_UNREADABLE"
        ? "recordTools.photoUnreadable"
        : "recordTools.aiUnavailable";
}

/**
 * One temporary ticket photo, read for a job number or product barcode.
 * Nothing is stored: the photo lives in memory until the dialog closes.
 */
export function JobScanRecordPhotoSearch({
  active,
  read,
  onSearch,
  onTypeInstead,
}: {
  active: boolean;
  read: (imageDataUrl: string) => Promise<TicketPhotoReadResult>;
  onSearch: (search: TicketPhotoSearch) => void;
  onTypeInstead: () => void;
}) {
  const t = useTranslations("JobScan");
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const device = useRef<HTMLInputElement>(null);
  const camera = useRef<StillPhotoCameraHandle>(null);
  const retakeCompletion = useRef<DialogCompletionHandle>(null);
  const retakeOpener = useRef<HTMLElement | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const [photo, setPhoto] = useState<File>();
  const [retaking, setRetaking] = useState(false);
  const [retakeEpoch, setRetakeEpoch] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<
    { field: TicketPhotoSearchField; value: string }[]
  >([]);
  const [field, setField] = useState<TicketPhotoSearchField>("factoryOrder");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [fileError, setFileError] = useState<string>();
  const abort = useRef<AbortController | null>(null);

  const cancelRead = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
  }, []);
  useLayoutEffect(() => cancelRead, [cancelRead]);
  const hasCandidates = candidates.length > 0;
  useLayoutEffect(() => {
    if (hasCandidates) reviewHeading.current?.focus();
  }, [hasCandidates]);

  function stopReading() {
    cancelRead();
    setBusy(false);
  }

  function retireRetake() {
    setFileError(undefined);
    setRetaking(false);
    setRetakeEpoch((epoch) => epoch + 1);
  }

  function cancelRetake() {
    camera.current?.stop();
    if (!retakeCompletion.current?.completeOwned?.(retireRetake))
      retireRetake();
  }

  function select(file: File) {
    if (!active || (photo && !retaking)) return;
    const problem = barcodeImageProblem(file);
    if (problem) {
      setFileError(problem);
      return;
    }
    const commit = () => {
      camera.current?.stop();
      setFileError(undefined);
      setPhoto(file);
      void readPhoto(file);
    };
    if (retaking) {
      retakeCompletion.current?.completeOwned?.(() => {
        retireRetake();
        commit();
      });
    } else commit();
  }

  async function readPhoto(file: File) {
    cancelRead();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setCandidates([]);
    setCode("");
    setError(undefined);
    try {
      const data = await prepareLocationImage(file, {
        signal: controller.signal,
      }).catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error && IMAGE_ERRORS.includes(cause.message)
              ? cause.message
              : "imageUnreadable",
          );
        return null;
      });
      if (data === null || controller.signal.aborted) return;
      const result = await read(data);
      if (controller.signal.aborted) return;
      const found = readCandidates(result);
      if (!result.ok) setError(readError(result.error.code));
      else if (!found.length) setError("recordTools.photoUnreadable");
      else {
        setCandidates(found);
        setField(found[0]!.field);
        setCode(found[0]!.value);
      }
    } catch {
      if (!controller.signal.aborted) setError("recordTools.aiUnavailable");
    } finally {
      if (!controller.signal.aborted) {
        abort.current = null;
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    const url = photo ? URL.createObjectURL(photo) : undefined;
    const source = url?.startsWith("blob:") ? encodeURI(url) : undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the preview URL follows the selected photo lifetime
    setPreviewUrl(source);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo]);

  function chooseImage() {
    setFileError(undefined);
    picker.current?.click();
  }

  function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) select(file);
  }

  const deviceCamera = (
    // The device camera is a fallback only when the in-app camera fails.
    <Button
      type="button"
      variant="outline"
      className="min-h-12 flex-1"
      onClick={() => {
        setFileError(undefined);
        camera.current?.stop();
        device.current?.click();
      }}
    >
      <Camera aria-hidden="true" className="size-4" />
      {t("locationAiDeviceCamera")}
    </Button>
  );
  const typeInstead = (
    <Button
      type="button"
      variant="outline"
      className="h-auto max-w-full min-w-0 shrink py-2 [overflow-wrap:anywhere] whitespace-normal"
      disabled={!active}
      onClick={() => {
        stopReading();
        camera.current?.stop();
        onTypeInstead();
      }}
    >
      <Keyboard aria-hidden="true" className="size-5" />
      {t("recordTools.photoTypeInstead")}
    </Button>
  );
  const fileWarning = fileError && (
    <Notice role="alert" tone="warning" title={t(fileError)} />
  );
  const renderDock = (extra: ReactNode, shutter: ReactNode) => (
    <>
      {fileWarning}
      <div className="grid grid-cols-2 items-center justify-items-center gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-[1fr_auto_1fr]">
        <div className="flex min-w-0 sm:justify-self-start">
          <Button
            type="button"
            variant="outline"
            className="h-auto max-w-full min-w-0 shrink py-2 [overflow-wrap:anywhere] whitespace-normal"
            onClick={chooseImage}
          >
            <ImagePlus aria-hidden="true" className="size-5" />
            {t("recordTools.photoGallery")}
          </Button>
        </div>
        <div className="order-first col-span-2 sm:order-none sm:col-span-1">
          {shutter}
        </div>
        <div className="flex min-w-0 sm:justify-self-end">{extra}</div>
      </div>
    </>
  );
  const stillCamera = (extra: ReactNode) => (
    <StillPhotoCamera
      ref={camera}
      onPhoto={select}
      captureLabel={t("takePhoto")}
      fileName={fileName}
      captureDisabled={!active}
      stopAfterCapture
      errorAction={deviceCamera}
      presentation="fullscreen"
      dock={(shutter) => renderDock(extra, shutter)}
    />
  );
  const canRetry = Boolean(photo) && !busy && !hasCandidates;
  const search = code.trim();

  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-3"
      aria-label={t("recordTools.photoSearch")}
    >
      {!photo ? (
        stillCamera(typeInstead)
      ) : (
        <>
          <div className="flex shrink-0 items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- temporary local preview, never uploaded */}
            <img
              src={previewUrl}
              alt={t("recordTools.photoPreview")}
              className="block h-auto max-h-[45dvh] w-auto max-w-full rounded-lg"
            />
          </div>
          <div className="shrink-0 space-y-3 rounded-lg border border-border bg-surface p-3">
            {busy && (
              <div className="flex flex-wrap items-center gap-2">
                <p role="status" aria-live="polite" className="flex-1 text-sm">
                  {t("recordTools.photoReading")}
                </p>
                <Button type="button" variant="outline" onClick={stopReading}>
                  {t("recordTools.photoStopReading")}
                </Button>
              </div>
            )}
            {error && <Notice role="alert" tone="warning" title={t(error)} />}
            {!retaking && fileWarning}
            {canRetry && (
              <Button
                type="button"
                variant="outline"
                className="min-h-12 w-full"
                disabled={!active}
                onClick={() => {
                  if (photo) void readPhoto(photo);
                }}
              >
                {t("recordTools.photoRetry")}
              </Button>
            )}
            {hasCandidates && (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (active && search)
                    onSearch({ search, searchField: field });
                }}
              >
                <h3
                  ref={reviewHeading}
                  tabIndex={-1}
                  className="text-sm font-semibold"
                >
                  {t("recordTools.photoReview")}
                </h3>
                {candidates.length > 1 && (
                  <div
                    role="group"
                    aria-label={t("recordTools.photoChoice")}
                    className="grid gap-2"
                  >
                    {candidates.map((candidate) => (
                      <Button
                        key={candidate.field}
                        type="button"
                        variant="outline"
                        aria-pressed={field === candidate.field}
                        className="h-auto min-h-12 w-full justify-start py-2 text-left break-all whitespace-normal aria-pressed:border-accent aria-pressed:bg-accent-surface"
                        onClick={() => {
                          setField(candidate.field);
                          setCode(candidate.value);
                        }}
                      >
                        <span className="grid">
                          <span className="text-xs text-muted">
                            {t(candidate.field)}
                          </span>
                          <span className="font-mono">{candidate.value}</span>
                        </span>
                      </Button>
                    ))}
                  </div>
                )}
                <label htmlFor={id} className="grid gap-1 text-sm">
                  {t(field)}
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id={id}
                    className="min-w-0 flex-1 font-mono"
                    value={code}
                    maxLength={200}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="search"
                    onChange={(event) => setCode(event.target.value)}
                  />
                  <Button
                    type="submit"
                    className="shrink-0"
                    disabled={!active || !search}
                  >
                    {t("recordTools.photoSearchAction")}
                  </Button>
                </div>
              </form>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!active}
                onClick={(event) => {
                  retakeOpener.current = event.currentTarget;
                  // Keep the reviewed photo and corrected code until a
                  // replacement is captured; Back from retake restores them.
                  stopReading();
                  setFileError(undefined);
                  setRetaking(true);
                }}
              >
                <RotateCcw aria-hidden="true" className="size-5" />
                {t("recordTools.photoRetake")}
              </Button>
              {typeInstead}
            </div>
          </div>
        </>
      )}
      <input
        ref={picker}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={t("recordTools.photoGallery")}
        onChange={chooseFile}
      />
      <input
        ref={device}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        aria-label={t("locationAiDeviceCamera")}
        onChange={chooseFile}
      />
      <Dialog
        open={retaking && photo !== undefined}
        onOpenChange={(open) => {
          setFileError(undefined);
          setRetaking(open);
        }}
        completionRef={retakeCompletion}
        backRevocationEpoch={retakeEpoch}
      >
        <DialogContent
          size="camera"
          showCloseButton={false}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            cancelRetake();
          }}
          onCloseAutoFocus={(event) => {
            if (retakeOpener.current?.isConnected) {
              event.preventDefault();
              retakeOpener.current.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("recordTools.photoRetake")}</DialogTitle>
            <DialogDescription>
              {t("recordTools.photoSearchHint")}
            </DialogDescription>
          </DialogHeader>
          {retaking && photo !== undefined && stillCamera(null)}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="fixed top-[max(.75rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] z-10 size-11 rounded-full border border-border bg-surface text-text"
            aria-label={t("backToPhoto")}
            onClick={cancelRetake}
          >
            <X aria-hidden="true" className="size-5" />
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
