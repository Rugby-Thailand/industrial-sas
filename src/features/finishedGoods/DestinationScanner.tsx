"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Camera } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogCompletionHandle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/Notice";
import { BarcodeCameraBox } from "./BarcodeCameraBox";
import { useAsyncOperation } from "@/hooks/useAsyncOperation";

import { useUnitText } from "./shared";

export interface DestinationScannerProps {
  readonly onCode: (code: string, method: "SCAN" | "MANUAL") => Promise<void>;
  readonly busy?: boolean;
  readonly verified?: boolean;
  readonly expectedLocation: string;
  readonly cameraLabel?: string;
  readonly alternateAction?: ReactNode;
  readonly onCameraOpen?: () => void;
  readonly showManualEntry?: boolean;
  readonly expectedCode?: string | undefined;
  readonly verificationError?: string | undefined;
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
      key={JSON.stringify([
        props.purpose,
        props.expectedLocation,
        props.expectedCode,
      ])}
      {...props}
    />
  );
}

function DestinationScanSession({
  onCode,
  busy = false,
  verified = false,
  expectedLocation,
  cameraLabel,
  alternateAction,
  onCameraOpen,
  showManualEntry = true,
  expectedCode,
  verificationError,
  showVerificationErrors = true,
  purpose = "DESTINATION",
  storageFormat,
}: DestinationScannerProps) {
  const { t } = useUnitText(storageFormat);
  const inputId = useId();
  const scanText = useTranslations("JobScan");
  const [code, setCode] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const cameraCompletion = useRef<DialogCompletionHandle>(null);
  const expected = useRef<HTMLDivElement>(null);
  const retryScan = useRef<HTMLButtonElement>(null);
  const verification = useAsyncOperation({
    navigation: "write",
    describeError: () => scanText("verificationFailed"),
  });
  const disabled = busy || verification.busy || verified;

  const rejected = verification.error;
  useEffect(() => {
    if (rejected) retryScan.current?.focus();
  }, [rejected]);

  function submit(value: string, method: "SCAN" | "MANUAL") {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    void verification.run(
      async () => {
        if (method === "SCAN") setCode(trimmed);
        await onCode(trimmed, method);
      },
      () => {
        if (method === "SCAN")
          verification.complete(() =>
            cameraCompletion.current?.complete(() => setCameraOpen(false)),
          );
      },
    );
  }

  const palletLabel = purpose === "PALLET" || purpose === "SUPPORT";
  const codeLabel =
    purpose === "SUPPORT"
      ? t("copy.supporting-pallet-code")
      : purpose === "PALLET"
        ? t("copy.pallet-code")
        : purpose === "SOURCE"
          ? t("copy.source-code")
          : t("copy.destination-code");
  const expectedLabel =
    purpose === "SUPPORT"
      ? t("copy.supporting-pallet")
      : purpose === "PALLET"
        ? t("copy.expected-pallet")
        : purpose === "SOURCE"
          ? t("copy.expected-source")
          : t("copy.expected-destination");
  const cameraTitle = scanText("scanField", { field: codeLabel });
  return (
    <div className="space-y-4">
      <div
        ref={expected}
        hidden={!showManualEntry}
        tabIndex={-1}
        className="rounded-lg border border-border bg-surface p-3"
      >
        <p className="text-xs text-muted">{expectedLabel}</p>
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
      <Dialog
        open={cameraOpen}
        onOpenChange={(open) => {
          if (open) {
            onCameraOpen?.();
            verification.setError("");
          }
          setCameraOpen(open);
        }}
        backPending={verification.busy || busy}
        completionRef={cameraCompletion}
      >
        <div className={alternateAction ? "grid grid-cols-2 gap-2" : undefined}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className="min-h-12 w-full whitespace-normal"
            >
              <Camera className="size-4" aria-hidden="true" />
              {cameraLabel ?? scanText("startCamera")}
            </Button>
          </DialogTrigger>
          {alternateAction}
        </div>
        <DialogContent
          size="camera"
          closeLabel={scanText("closeCamera")}
          onCloseAutoFocus={(event) => {
            if (disabled) {
              event.preventDefault();
              expected.current?.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{cameraTitle}</DialogTitle>
            <DialogDescription>
              {expectedLabel}: {expectedLocation}
              {expectedCode && expectedCode !== expectedLocation
                ? ` · ${expectedCode}`
                : null}
            </DialogDescription>
          </DialogHeader>
          {rejected ? (
            <div className="space-y-3">
              <Notice
                tone="warning"
                title={verificationError || rejected}
                role="alert"
              >
                <p className="text-sm text-muted">{scanText("scannedCode")}</p>
                <p className="mt-1 text-sm break-all">{code}</p>
              </Notice>
              <Button
                ref={retryScan}
                type="button"
                className="min-h-12 w-full"
                disabled={disabled}
                onClick={() => verification.setError("")}
              >
                <Camera className="size-4" aria-hidden="true" />
                {scanText("scanAgain")}
              </Button>
            </div>
          ) : (
            <BarcodeCameraBox
              mode={palletLabel ? "PACKAGES" : "LOCATION"}
              presentation="fullscreen"
              guide="label"
              closeControl={false}
              stopAfterScan
              disabled={disabled}
              onStart={() => verification.setError("")}
              onCode={(value) => submit(value, "SCAN")}
              videoLabel={cameraTitle}
              feedback={
                verification.busy || busy ? t("copy.verifying") : undefined
              }
            />
          )}
        </DialogContent>
      </Dialog>
      <form
        hidden={!showManualEntry}
        onSubmit={(event) => {
          event.preventDefault();
          submit(code, "MANUAL");
        }}
        className="space-y-3"
      >
        <FormField
          id={inputId}
          label={codeLabel}
          hint={t(
            "copy.paste-type-or-use-a-handheld-scanner-this-is-recorded-as-manual-code-ver",
          )}
        >
          {(control) => (
            <Input
              {...control}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              maxLength={500}
              placeholder={
                palletLabel ? "ISAS:PALLET:1:…" : "ISAS:LOCATION:1:…"
              }
            />
          )}
        </FormField>
        <Button
          type="submit"
          variant="outline"
          disabled={disabled || !code.trim()}
          className="w-full"
        >
          {verification.busy || busy
            ? t("copy.verifying")
            : t("copy.verify-entered-code")}
        </Button>
      </form>
      {showManualEntry && showVerificationErrors && rejected ? (
        <Notice tone="warning" title={rejected} role="alert" />
      ) : null}
      {showManualEntry && verified ? (
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
