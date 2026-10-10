"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/Notice";
import { BarcodeCropControls } from "../BarcodeCropControls";
import { barcodeImageProblem, type BarcodeCrop } from "../barcodeDecoder";
import type {
  LocationImageResult,
  LocationLabelCandidate,
} from "../../../../convex/model/finishedGoods/locationImage";
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
  const preview = useRef<HTMLImageElement>(null);
  const [photo, setPhoto] = useState(initialPhoto);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<
    readonly LocationLabelCandidate[]
  >([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [cropping, setCropping] = useState(Boolean(initialPhoto?.crop));
  const [crop, setCrop] = useState<BarcodeCrop>(
    initialPhoto?.crop ?? { x: 0, y: 0, width: 1, height: 1 },
  );
  const version = useRef(0);
  const pending = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const cancelPending = useCallback(() => {
    version.current++;
    abort.current?.abort();
  }, []);
  useEffect(() => {
    const url = photo ? URL.createObjectURL(photo.file) : undefined;
    if (url && preview.current) preview.current.src = url;
    return () => {
      cancelPending();
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo, cancelPending]);

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
    const problem = barcodeImageProblem(file);
    if (problem) {
      setPhoto(undefined);
      setError(problem);
      return;
    }
    setPhoto(locationPhoto(file));
    setCrop({ x: 0, y: 0, width: 1, height: 1 });
    setCropping(false);
  }
  async function read() {
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
        ...(cropping ? { crop } : {}),
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
  }

  return (
    <section
      className="space-y-3 rounded-lg border border-border p-3"
      aria-label={t("locationAiTitle")}
    >
      <h3 className="font-semibold">{t("locationAiTitle")}</h3>
      <p className="text-sm text-muted">{t("locationAiHint")}</p>
      <input
        ref={picker}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={t("chooseLocationImage")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) select(file);
        }}
      />
      <input
        ref={capture}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        aria-label={t("takeLocationPhoto")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) select(file);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => picker.current?.click()}
        >
          {t("chooseLocationImage")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => capture.current?.click()}
        >
          {t("takeLocationPhoto")}
        </Button>
      </div>
      {photo && (
        <>
          <div className="relative overflow-hidden rounded-lg bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element -- local photo preview and normalized crop share the same geometry */}
            <img
              ref={preview}
              alt={t("locationAiPhoto")}
              className="block h-auto w-full"
            />
            {cropping && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute border-2 border-white bg-white/10"
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.width * 100}%`,
                  height: `${crop.height * 100}%`,
                }}
              />
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              invalidate();
              setCropping(!cropping);
            }}
          >
            {t("cropBarcodeImage")}
          </Button>
          {cropping && (
            <BarcodeCropControls
              crop={crop}
              disabled={busy}
              onChange={(area) => {
                invalidate();
                setCrop(area);
              }}
            />
          )}
        </>
      )}
      {busy ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" aria-live="polite" className="flex-1 text-sm">
            {t("locationAiReading")}
          </p>
          <Button type="button" variant="outline" onClick={invalidate}>
            {t("cancel")}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          className="min-h-12 w-full"
          disabled={!photo}
          onClick={() => void read()}
        >
          {t("readLocationAi")}
        </Button>
      )}
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
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={() => {
          invalidate();
          onClose();
        }}
      >
        {t("backToLocationScanner")}
      </Button>
    </section>
  );
}
