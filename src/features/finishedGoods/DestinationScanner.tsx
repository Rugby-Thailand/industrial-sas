"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { Camera, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/Notice";

import { useUnitText } from "./shared";

export interface DestinationScannerProps {
  readonly onCode: (code: string, method: "SCAN" | "MANUAL") => Promise<void>;
  readonly busy?: boolean;
  readonly verified?: boolean;
  readonly expectedLocation: string;
  /** Parent workflows can show their precise business error without a duplicate generic notice. */
  readonly showVerificationErrors?: boolean;
  readonly purpose?: "DESTINATION" | "PALLET" | "SOURCE" | "SUPPORT";
  readonly storageFormat?: string | undefined;
}

/** Reads destination identity only; the parent verifies it and confirms storage. */
export function DestinationScanner({
  onCode,
  busy = false,
  verified = false,
  expectedLocation,
  showVerificationErrors = true,
  purpose = "DESTINATION",
  storageFormat,
}: DestinationScannerProps) {
  const { t } = useUnitText(storageFormat);
  const inputId = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);
  const session = useRef(0);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const starting = useRef(false);
  const [camera, setCamera] = useState<"OFF" | "STARTING" | "ON">("OFF");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [startupPending, setStartupPending] = useState(false);

  const releaseCamera = useCallback(() => {
    session.current += 1;
    controlsRef.current?.stop();
    controlsRef.current = null;
    const video = activeVideoRef.current ?? videoRef.current;
    activeVideoRef.current = null;
    const stream = video?.srcObject;
    if (stream && "getTracks" in stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (video) video.srcObject = null;
  }, []);

  const stopCamera = useCallback(() => {
    releaseCamera();
    if (mounted.current) setCamera("OFF");
  }, [releaseCamera]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      releaseCamera();
    };
  }, [releaseCamera]);

  useEffect(() => {
    if (verified) stopCamera();
  }, [verified, stopCamera]);

  async function submit(value: string, method: "SCAN" | "MANUAL") {
    const trimmed = value.trim();
    if (!trimmed || busy || verified || inFlight.current) return;
    inFlight.current = true;
    stopCamera();
    setReading(true);
    setError("");
    try {
      await onCode(trimmed, method);
    } catch {
      if (mounted.current && showVerificationErrors) {
        setError(
          t(
            "copy.the-destination-could-not-be-verified-check-the-code-and-connection-then",
          ),
        );
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setReading(false);
    }
  }

  async function startCamera() {
    if (
      camera !== "OFF" ||
      busy ||
      verified ||
      inFlight.current ||
      starting.current
    )
      return;
    const video = videoRef.current;
    if (!video) return;
    activeVideoRef.current = video;
    starting.current = true;
    setStartupPending(true);
    const currentSession = ++session.current;
    setError("");
    setCamera("STARTING");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("CAMERA_UNAVAILABLE");
      }
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      if (!mounted.current || session.current !== currentSession) return;
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        video,
        (result, decodeError, callbackControls) => {
          if (!mounted.current || session.current !== currentSession) {
            callbackControls.stop();
            return;
          }
          if (result) {
            // Stop immediately, including when decoding precedes promise resolution.
            callbackControls.stop();
            void submit(result.getText(), "SCAN");
          } else if (
            decodeError &&
            ![
              "NotFoundException",
              "ChecksumException",
              "FormatException",
            ].includes(
              typeof decodeError.getKind === "function"
                ? decodeError.getKind()
                : decodeError.name,
            )
          ) {
            callbackControls.stop();
            stopCamera();
            setError(
              t(
                "copy.the-camera-could-not-read-the-code-retry-the-camera-or-enter-the-destina",
              ),
            );
          }
        },
      );
      if (!mounted.current || session.current !== currentSession) {
        controls.stop();
        // Startup may attach a stream after Stop/unmount; release that late stream.
        const stream = video.srcObject;
        if (stream && "getTracks" in stream)
          stream.getTracks().forEach((track) => track.stop());
        video.srcObject = null;
        return;
      }
      controlsRef.current = controls;
      setCamera("ON");
    } catch {
      if (mounted.current && session.current === currentSession) {
        stopCamera();
        setError(
          t(
            "copy.camera-unavailable-allow-camera-access-and-retry-or-enter-the-destinatio",
          ),
        );
      }
    } finally {
      starting.current = false;
      if (mounted.current) setStartupPending(false);
    }
  }

  const disabled = busy || reading || verified;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-3">
        <p className="text-xs text-muted">
          {purpose === "SUPPORT"
            ? t("copy.supporting-pallet")
            : purpose === "PALLET"
              ? t("copy.expected-pallet")
              : purpose === "SOURCE"
                ? t("copy.expected-source")
                : t("copy.expected-destination")}
        </p>
        <p className="mt-1 font-medium break-words">{expectedLocation}</p>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {purpose === "SUPPORT"
            ? t(
                "copy.identify-the-lower-pallet-that-supports-this-placement-then-confirm-plac",
              )
            : purpose === "PALLET"
              ? t(
                  "copy.scan-the-pallet-label-or-enter-its-pallet-code-before-confirming-pickup",
                )
              : t(
                  "copy.verify-the-location-label-then-follow-the-exact-position-shown-in-the-pl",
                )}
        </p>
      </div>
      <div className="space-y-2">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label={t("copy.destination-camera-preview")}
          className={`aspect-video w-full rounded-lg bg-black object-cover ${camera === "OFF" ? "hidden" : ""}`}
        />
        {camera === "OFF" ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void startCamera()}
            disabled={disabled || startupPending}
            className="w-full"
          >
            <Camera className="size-4" aria-hidden="true" />
            {t("copy.start-camera")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={stopCamera}
            className="w-full"
          >
            <Square className="size-4" aria-hidden="true" />
            {t("copy.stop-camera")}
          </Button>
        )}
        {camera === "STARTING" ? (
          <p role="status" className="text-sm text-muted">
            {t("copy.starting-camera")}
          </p>
        ) : null}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(code, "MANUAL");
        }}
        className="space-y-3"
      >
        <div className="space-y-2">
          <Label htmlFor={inputId}>
            {purpose === "SUPPORT"
              ? t("copy.supporting-pallet-code")
              : purpose === "PALLET"
                ? t("copy.pallet-code")
                : purpose === "SOURCE"
                  ? t("copy.source-code")
                  : t("copy.destination-code")}
          </Label>
          <Input
            id={inputId}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            maxLength={500}
            placeholder={
              purpose === "PALLET" || purpose === "SUPPORT"
                ? "ISAS:PALLET:1:…"
                : "ISAS:LOCATION:1:…"
            }
            aria-describedby={`${inputId}-hint`}
          />
          <p
            id={`${inputId}-hint`}
            className="text-xs leading-relaxed text-muted"
          >
            {t(
              "copy.paste-type-or-use-a-handheld-scanner-this-is-recorded-as-manual-code-ver",
            )}
          </p>
        </div>
        <Button
          type="submit"
          variant="outline"
          disabled={disabled || !code.trim()}
          className="w-full"
        >
          {reading || busy
            ? t("copy.verifying")
            : t("copy.verify-entered-code")}
        </Button>
      </form>
      {error ? <Notice tone="warning" title={error} role="alert" /> : null}
      {verified ? (
        <Notice
          tone="success"
          title={
            purpose === "SUPPORT"
              ? t("copy.supporting-pallet-verified")
              : purpose === "PALLET"
                ? t("copy.pallet-identified")
                : purpose === "SOURCE"
                  ? t("copy.source-code-captured")
                  : t("copy.destination-verified")
          }
          body={
            purpose === "SUPPORT"
              ? t(
                  "copy.place-the-upper-pallet-at-the-shown-coordinates-before-confirming",
                )
              : purpose === "PALLET"
                ? t(
                    "copy.confirm-pickup-only-after-physically-picking-up-this-pallet",
                  )
                : purpose === "SOURCE"
                  ? t(
                      "copy.confirm-return-only-after-physically-returning-to-the-exact-source-posit",
                    )
                  : t(
                      "copy.place-the-pallet-at-the-guided-position-before-confirming-storage",
                    )
          }
        />
      ) : null}
    </div>
  );
}
