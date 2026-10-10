"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { classifyTicketBarcode } from "./jobScan/ticketDraft";
import {
  readBarcodeImage,
  ImageScanError,
  validateBarcodeFile,
  type BarcodeImageResult,
  type BarcodeImageTarget,
} from "./barcodeImage";

export function BarcodeImagePicker({
  target,
  disabled,
  onSelect,
  onCodes,
}: {
  target: BarcodeImageTarget;
  disabled: boolean;
  onSelect: () => void;
  onCodes: (codes: string[]) => void;
}) {
  const t = useTranslations("JobScan");
  const input = useRef<HTMLInputElement>(null),
    pending = useRef<AbortController | null>(null),
    version = useRef(0);
  const [image, setImage] = useState<string>(),
    [reading, setReading] = useState(false),
    [result, setResult] = useState<BarcodeImageResult>(),
    [error, setError] = useState<string>();
  const preview = useRef<string | undefined>(undefined);
  function clear() {
    version.current++;
    pending.current?.abort();
    pending.current = null;
    setReading(false);
    setResult(undefined);
    setError(undefined);
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current = undefined;
    setImage(undefined);
  }
  useEffect(
    () => () => {
      version.current++;
      pending.current?.abort();
      if (preview.current) URL.revokeObjectURL(preview.current);
    },
    [],
  );
  useEffect(() => {
    if (disabled) pending.current?.abort();
  }, [disabled]);
  async function select(file: File) {
    clear();
    onSelect();
    const current = version.current;
    try {
      validateBarcodeFile(file);
    } catch (cause) {
      setError(
        t(
          cause instanceof ImageScanError
            ? `barcodeImage${cause.code}`
            : "barcodeImageIMAGE",
        ),
      );
      return;
    }
    const url = URL.createObjectURL(file);
    preview.current = url;
    setImage(url);
    setReading(true);
    const controller = new AbortController();
    pending.current = controller;
    try {
      const found = await readBarcodeImage(file, target, controller.signal);
      if (current !== version.current || controller.signal.aborted) return;
      if (found.codes.length) setResult(found);
      else setError(t("barcodeImageNotFound"));
    } catch (cause) {
      if (current !== version.current || controller.signal.aborted) return;
      setError(
        t(
          cause instanceof ImageScanError
            ? `barcodeImage${cause.code}`
            : "barcodeImageDECODER",
        ),
      );
    } finally {
      if (current === version.current) setReading(false);
    }
  }
  const accept = (codes: string[]) => {
    if (disabled || reading) return;
    clear();
    onCodes(codes);
  };
  const isPair =
    target === "TICKET" &&
    result?.codes.length === 2 &&
    result.codes.filter(
      (code) => classifyTicketBarcode(code) === "factoryOrder",
    ).length === 1;
  return (
    <div className="space-y-3">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        aria-label={t("chooseBarcodeImage")}
        disabled={disabled || reading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void select(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="min-h-12 w-full"
        disabled={disabled || reading}
        onClick={() => input.current?.click()}
      >
        <ImagePlus className="size-4" aria-hidden="true" />
        {t("chooseBarcodeImage")}
      </Button>
      <p className="text-xs text-muted">{t("barcodeImagePrivacy")}</p>
      {image && (
        <a
          href={image}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-fit"
          aria-label={t("barcodeImageView")}
        >
          <Image
            src={image}
            alt={t("barcodeImagePreview")}
            width={120}
            height={160}
            unoptimized
            className="max-h-40 w-auto rounded object-contain"
          />
        </a>
      )}
      {reading && (
        <div className="space-y-2">
          <p role="status" className="text-sm">
            {t("barcodeImageReading")}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-12"
            onClick={() => {
              clear();
            }}
          >
            {t("cancel")}
          </Button>
        </div>
      )}
      {error && (
        <Notice
          tone="warning"
          title={error}
          body={t("barcodeImageRecovery")}
          role="alert"
        />
      )}
      {result && (
        <div className="space-y-3">
          {result.reviewRequired ? (
            <Notice
              tone="warning"
              title={t("barcodeImageReview")}
              body={t("barcodeImageReviewHint")}
            />
          ) : (
            <p role="status" className="text-sm">
              {t("barcodeImageRead")}
            </p>
          )}
          <ul className="space-y-2">
            {result.codes.map((code) => (
              <li key={code} className="font-mono text-sm break-all">
                {code}
              </li>
            ))}
          </ul>
          {result.codes.length > 1 && !isPair ? (
            <>
              <p className="text-sm text-muted">{t("barcodeImageMultiple")}</p>
              {result.codes.map((code) => (
                <Button
                  type="button"
                  key={code}
                  className="h-auto min-h-12 w-full font-mono break-all whitespace-normal"
                  disabled={disabled}
                  onClick={() => accept([code])}
                >
                  {code}
                </Button>
              ))}
            </>
          ) : (
            <Button
              type="button"
              className="min-h-12 w-full"
              disabled={disabled}
              onClick={() => accept(result.codes)}
            >
              {t(
                result.reviewRequired
                  ? "barcodeImageConfirm"
                  : "barcodeImageUse",
              )}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="min-h-12 w-full"
            onClick={clear}
          >
            {t("scanAgain")}
          </Button>
        </div>
      )}
    </div>
  );
}
