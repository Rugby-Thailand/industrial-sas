"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScanCodeInput } from "@/components/ui/ScanCodeInput";
import { useBarcodeCamera } from "./useBarcodeCamera";
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
export function DestinationScanner(props: DestinationScannerProps) {
  // A different verification target requires a fresh camera and manual draft.
  return (
    <DestinationScanSession
      key={JSON.stringify([props.purpose, props.expectedLocation])}
      {...props}
    />
  );
}

function DestinationScanSession({
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
  const scanText = useTranslations("JobScan");
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const disabled = busy || reading || verified;
  if ((busy || verified) && camera) setCamera(false);
  const {
    videoRef,
    state,
    error: cameraError,
    stop,
    start,
  } = useBarcodeCamera({
    active: camera && !disabled,
    mode:
      purpose === "PALLET" || purpose === "SUPPORT" ? "PACKAGES" : "LOCATION",
    onCode: (value) => {
      if (camera) void submit(value, "SCAN");
    },
  });
  const stopCamera = useCallback(() => {
    stop();
    setCamera(false);
  }, [stop]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit(value: string, method: "SCAN" | "MANUAL") {
    const trimmed = value.trim();
    if (!mounted.current || !trimmed || disabled || inFlight.current) return;
    inFlight.current = true;
    if (method === "SCAN") setCode(trimmed);
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

  const startupPending = !camera && state === "STARTING";
  const codeLabel =
    purpose === "SUPPORT"
      ? t("copy.supporting-pallet-code")
      : purpose === "PALLET"
        ? t("copy.pallet-code")
        : purpose === "SOURCE"
          ? t("copy.source-code")
          : t("copy.destination-code");
  function startCamera() {
    if (disabled || startupPending || inFlight.current) return;
    setError("");
    if (camera) start();
    else setCamera(true);
  }
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
          className={`aspect-video w-full rounded-lg bg-black object-cover ${!camera ? "hidden" : ""}`}
        />
        {!camera || cameraError ? (
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
        {camera && state === "STARTING" ? (
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
          <Label htmlFor={inputId}>{codeLabel}</Label>
          <ScanCodeInput
            scanLabel={scanText("scanField", { field: codeLabel })}
            onScan={() => {
              if (camera && !cameraError) stopCamera();
              else startCamera();
            }}
            scanning={camera && !cameraError}
            scanDisabled={startupPending}
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
      {cameraError ? (
        <Notice
          tone="warning"
          role="alert"
          title={
            cameraError === "DECODER"
              ? t(
                  "copy.the-camera-could-not-read-the-code-retry-the-camera-or-enter-the-destina",
                )
              : t(
                  "copy.camera-unavailable-allow-camera-access-and-retry-or-enter-the-destinatio",
                )
          }
        />
      ) : null}
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
