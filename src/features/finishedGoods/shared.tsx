"use client";

import { resolveWriteError } from "@/lib/resolveWriteError";
import { FG_PATH } from "@/lib/navigation";
import { unitCopy } from "./storageUnitLabels";
export { unitNoun, unitCountLabel } from "./storageUnitLabels";

import { useLocale, useTranslations } from "next-intl";
import { useId, type ReactNode } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { QrCode } from "@/features/storageKit/QrCode";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/FormField";
import { Notice } from "@/components/ui/Notice";
import { EmptyState } from "@/components/ui/EmptyState";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
export { ErrorNotice } from "@/components/ui/Notice";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { Panel } from "@/components/ui/Panel";
import { useAsyncOperation } from "@/hooks/useAsyncOperation";

export {
  FG_PATH,
  productPath,
  unitCorrectionPath,
  batchPath,
  palletPath,
  measurePath,
  storagePath,
} from "@/lib/navigation";
export const panel = "rounded-xl border border-border bg-surface p-4";
export { Panel };
export const STATUS_TONES: Readonly<Record<string, BadgeTone>> = {
  DRAFT: "pending",
  ACTIVE: "success",
  AWAITING_MEASUREMENT: "pending",
  AWAITING_PLACEMENT: "pending",
  RESERVED: "warning",
  STORED: "success",
  MOVE_RESERVED: "warning",
  IN_TRANSIT: "warning",
};
export function useFGText() {
  const locale: "th" | "en" = useLocale() === "th" ? "th" : "en";
  const t = useTranslations("FinishedGoods");
  return {
    locale,
    t,
    // Compatibility shim for dynamic copy tuples. Static copy is migrated to
    // FinishedGoods.copy keys; callers with runtime-generated text still use
    // this typed fallback until their messages can be parameterized safely.
    tr: (en: string, th: string) => (locale === "th" ? th : en),
  };
}
export function useUnitText(format: string | undefined) {
  const { locale, t, tr } = useFGText();
  return {
    locale,
    t: (key: Parameters<typeof t>[0], values?: Parameters<typeof t>[1]) =>
      unitCopy(t(key, values as never), format),
    tr: (en: string, th: string) => unitCopy(tr(en, th), format),
  };
}
export { useDraftKey } from "@/hooks/useDraftKey";
export { useCanManage } from "@/hooks/useCanManage";
export function ViewOnlyNotice() {
  const { t } = useFGText();
  return (
    <Notice
      title={t("copy.view-only-access")}
      body={t(
        "copy.you-can-view-products-and-storage-units-creating-or-changing-records-req",
      )}
    />
  );
}
export function Heading({
  title,
  description,
  back = FG_PATH,
  backLabel,
  children,
}: {
  title: string;
  description?: string;
  back?: string;
  backLabel?: string;
  children?: ReactNode;
}) {
  const { t } = useFGText();
  return (
    <PageHeader
      title={title}
      {...(description ? { summary: description } : {})}
      back={{
        href: back,
        label: backLabel ?? t("copy.finished-goods"),
      }}
    >
      {children}
    </PageHeader>
  );
}
/** Compatibility alias for existing feature imports. */
export function Loading() {
  return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
}
export function Missing() {
  const { t } = useFGText();
  return (
    <div className="space-y-4 py-4">
      <PageBackLink href={FG_PATH} label={t("copy.back-to-finished-goods")} />
      <EmptyState
        title={t("copy.this-record-is-unavailable")}
        body={t(
          "copy.it-may-belong-to-a-different-warehouse-or-you-may-not-have-access",
        )}
      />
    </div>
  );
}
export function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  min,
  max,
  step,
  hint,
  error,
  disabled = false,
  maxLength,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  maxLength?: number;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <FormField
      id={id}
      label={label}
      required={required}
      hint={hint}
      error={error}
    >
      {(field) => (
        <Input
          {...field}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          type={type}
          required={required}
          disabled={disabled}
          {...(min === undefined ? {} : { min })}
          {...(max === undefined ? {} : { max })}
          {...(step === undefined ? {} : { step })}
          {...(maxLength === undefined ? {} : { maxLength })}
          {...(placeholder === undefined ? {} : { placeholder })}
        />
      )}
    </FormField>
  );
}
export function QR({
  value,
  label,
  small = false,
}: {
  value: string;
  label: string;
  small?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <QrCode
        value={value}
        label={label}
        size={small ? 56 : 104}
        padding={small ? 4 : 8}
        className="self-start"
      />
      <div className="min-w-0 self-center">
        <p className="font-medium break-words">{label}</p>
        <p className="mt-1 font-mono text-[10px] break-all text-muted">
          {value}
        </p>
      </div>
    </div>
  );
}
export function Steps({
  step,
  packing = false,
}: {
  step: 1 | 2;
  packing?: boolean;
}) {
  const { t } = useFGText();
  return (
    <ol
      aria-label={t("copy.creation-steps")}
      className="mb-6 flex flex-wrap gap-4 text-sm"
    >
      {[
        t("copy.product-details"),
        packing
          ? t("copy.packing-and-dimensions-afff76")
          : t("copy.measure-pallet"),
      ].map((label, i) => (
        <li
          key={label}
          aria-current={step === i + 1 ? "step" : undefined}
          className={`flex items-center gap-2 ${step === i + 1 ? "font-semibold text-link" : "text-muted"}`}
        >
          <span
            className={`grid size-7 place-items-center rounded-full border ${step === i + 1 ? "border-link bg-selected" : "border-border"}`}
          >
            {i + 1}
          </span>
          {label}
        </li>
      ))}
    </ol>
  );
}
export function palletDisplayStatus(pallet: {
  status: string;
  moveStatus?: string;
}) {
  return pallet.moveStatus === "IN_TRANSIT"
    ? "IN_TRANSIT"
    : pallet.moveStatus === "RESERVED"
      ? "MOVE_RESERVED"
      : pallet.status;
}
export function Status({ value }: { value: string }) {
  const { t } = useFGText();
  const labels: Record<string, string> = {
    DRAFT: t("copy.draft"),
    ACTIVE: t("copy.ready"),
    AWAITING_MEASUREMENT: t("copy.awaiting-measurement"),
    AWAITING_PLACEMENT: t("copy.awaiting-placement"),
    RESERVED: t("copy.reserved-awaiting-storage"),
    STORED: t("copy.stored"),
    MOVE_RESERVED: t("copy.move-prepared"),
    IN_TRANSIT: t("copy.moving"),
  };
  return (
    <StatusBadge
      tone={STATUS_TONES[value] ?? "neutral"}
      label={labels[value] ?? value}
    />
  );
}
export function useWriteError(storageFormat?: string) {
  const t = useTranslations("WriteError");
  return (code: string) =>
    unitCopy(resolveWriteError(code, t, "finishedGoods"), storageFormat);
}
export function useOperation(scope?: string, storageFormat?: string) {
  const describeError = useWriteError(storageFormat);
  return useAsyncOperation({
    ...(scope === undefined ? {} : { scope }),
    describeError,
  });
}
export { written } from "@/lib/convex/mutationOutcome";
export { useUnsavedWarning } from "@/hooks/useUnsavedWarning";
export const mmText = (n: number) => `${Number((n / 1000).toFixed(3))} m`;
