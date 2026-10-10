"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/FormField";
import { ScanCodeInput } from "@/components/ui/ScanCodeInput";
import { Notice } from "@/components/ui/Notice";
import { BarcodeCameraBox } from "./BarcodeCameraBox";
import { useAsyncOperation } from "@/hooks/useAsyncOperation";

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
  const [code, setCode] = useState("");
  const verification = useAsyncOperation(() =>
    showVerificationErrors
      ? t(
          "copy.the-destination-could-not-be-verified-check-the-code-and-connection-then",
        )
      : "",
  );
  const disabled = busy || verification.busy || verified;

  function submit(value: string, method: "SCAN" | "MANUAL") {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    void verification.run(async () => {
      if (method === "SCAN") setCode(trimmed);
      await onCode(trimmed, method);
    });
  }

  const codeLabel =
    purpose === "SUPPORT"
      ? t("copy.supporting-pallet-code")
      : purpose === "PALLET"
        ? t("copy.pallet-code")
        : purpose === "SOURCE"
          ? t("copy.source-code")
          : t("copy.destination-code");
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
      <BarcodeCameraBox
        mode={
          purpose === "PALLET" || purpose === "SUPPORT"
            ? "PACKAGES"
            : "LOCATION"
        }
        startOnMount={false}
        stopAfterScan
        disabled={disabled}
        onCode={(value) => submit(value, "SCAN")}
        videoLabel={scanText("scanField", { field: codeLabel })}
      >
        {({ stopCamera, ...scan }) => (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              stopCamera();
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
                <ScanCodeInput
                  {...control}
                  {...scan}
                  scanLabel={scanText("scanField", { field: codeLabel })}
                  onScan={() => {
                    verification.setError("");
                    scan.onScan();
                  }}
                  value={code}
                  onChange={(event) => {
                    stopCamera();
                    setCode(event.target.value);
                  }}
                  disabled={disabled}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={500}
                  placeholder={
                    purpose === "PALLET" || purpose === "SUPPORT"
                      ? "ISAS:PALLET:1:…"
                      : "ISAS:LOCATION:1:…"
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
        )}
      </BarcodeCameraBox>
      {verification.error ? (
        <Notice tone="warning" title={verification.error} role="alert" />
      ) : null}
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
