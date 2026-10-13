"use client";

import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/Notice";
import { Link } from "@/i18n/navigation";
import type {
  StorageStackPlacementRow,
  StorageZoneRow,
} from "@/lib/convex/storageLayoutApi";
import { palletPath } from "@/lib/navigation";
import { uniqueStoragePallets } from "@/lib/storageLayouts/storagePlacementGeometry";
import { measuredMillimetres } from "./measure";

export { measuredMillimetres } from "./measure";

type StorageT = ReturnType<typeof useTranslations<"StorageLayouts">>;

/** Nudge without accumulating binary floating-point error. */
function nudged(value: string, deltaMm: number, minMm: number) {
  const current = measuredMillimetres(value) ?? 0;
  return String(Math.max(minMm, current + deltaMm) / 1_000);
}

/**
 * A metre input that accepts 1 mm precision while arrow keys move 0.1 m.
 * Native `step` would otherwise either reject saved survey values (PD 11.96 m
 * with step 0.1) or make keyboard nudges 1 mm. Validation uses the browser's
 * constraint API so `reportValidity` and form submission still block bad values.
 */
export function MeasureInput({
  min = 0,
  nudgeMm = 100,
  onKeyDown,
  onChange,
  ...props
}: Omit<ComponentProps<typeof Input>, "type" | "step" | "min"> & {
  readonly min?: number;
  readonly nudgeMm?: number;
}) {
  const t = useTranslations("StorageLayouts.layoutActions");
  const ref = useRef<HTMLInputElement>(null);
  const message = t("measureInvalid");
  const minMm = Math.round(min * 1_000);
  const validate = (input: HTMLInputElement) => {
    const mm = input.value === "" ? null : measuredMillimetres(input.value);
    input.setCustomValidity(
      input.value !== "" && (mm === null || mm < minMm) ? message : "",
    );
  };
  useLayoutEffect(() => {
    if (ref.current) validate(ref.current);
  });
  return (
    <Input
      ref={ref}
      type="number"
      inputMode="decimal"
      step="any"
      min={min}
      onChange={(event) => {
        validate(event.currentTarget);
        onChange?.(event);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || props.disabled || props.readOnly) return;
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        const input = event.currentTarget;
        const next = nudged(
          input.value,
          event.key === "ArrowUp" ? nudgeMm : -nudgeMm,
          minMm,
        );
        // Through the native setter so React's onChange observes the edit.
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(input, next);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }}
      {...props}
    />
  );
}

export function storageWriteMessage(t: StorageT, code: string): string {
  const known = `layoutActions.error.${code}` as Parameters<StorageT>[0];
  if (t.has(known)) return t(known);
  if (code === "RESERVED_BLOCK_COLOR_INVALID") return t("areaColor.invalid");
  if (code === "LOCATION_OCCUPIED") return t("occupiedChangeBlocked");
  if (code === "VERSION_CONFLICT") return t("layoutChangedRetry");
  return t("writeError", { code });
}

export interface LayoutFailure {
  readonly code: string;
  /**
   * The write threw (transport, runtime or access error) instead of returning
   * a refusal, so its server outcome is not confirmed.
   */
  readonly thrown: boolean;
}

/** Read the current failure: a returned refusal wins over a thrown error. */
export function layoutFailure(
  refusal: string | undefined,
  operation: { readonly error: string; readonly errorCode: string },
): LayoutFailure | undefined {
  if (refusal !== undefined) return { code: refusal, thrown: false };
  if (operation.error === "" && operation.errorCode === "") return undefined;
  return { code: operation.errorCode || "NETWORK_ERROR", thrown: true };
}

/**
 * The one save-failure surface for layout writes. It states that nothing was
 * lost, separates an unconfirmed thrown failure from a server refusal, and
 * offers Retry for the former, which resends the same request identity.
 */
export function OperationFailure({
  failure,
  onRetry,
  retrying = false,
}: {
  readonly failure: LayoutFailure | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly retrying?: boolean;
}) {
  const t = useTranslations("StorageLayouts");
  if (failure === undefined) return null;
  return (
    <Notice
      tone="danger"
      role="alert"
      title={t("layoutActions.failure.title")}
      body={
        failure.thrown
          ? `${t("layoutActions.failure.network")} (${failure.code})`
          : storageWriteMessage(t, failure.code)
      }
      testId="layout-operation-failure"
    >
      {onRetry && failure.thrown ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={retrying}
          onClick={onRetry}
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          {t("layoutActions.failure.retry")}
        </Button>
      ) : null}
    </Notice>
  );
}

/**
 * Stock blocks a structural change. This is a stop, not a review step: no
 * Confirm is offered because the server refuses the write regardless.
 */
export function BlockedImpact({
  placements,
  unmeasuredCount,
  currentPlan,
  proposedPlan,
  onBack,
  buildingHref,
}: {
  readonly placements: readonly StorageStackPlacementRow[];
  readonly unmeasuredCount: number;
  readonly currentPlan?: string;
  readonly proposedPlan?: string;
  readonly onBack: () => void;
  readonly buildingHref?: string;
}) {
  const t = useTranslations("StorageLayouts");
  const units = uniqueStoragePallets(placements);
  return (
    <Notice
      tone="warning"
      role="alert"
      title={t("layoutActions.blocked.title")}
      body={t("layoutActions.blocked.description")}
      testId="layout-blocked-impact"
    >
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">
            {t("layoutActions.blocked.measured")}
          </dt>
          <dd className="font-semibold tabular-nums">{units.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">
            {t("layoutActions.blocked.unmeasured")}
          </dt>
          <dd className="font-semibold tabular-nums">{unmeasuredCount}</dd>
        </div>
        {currentPlan === undefined ? null : (
          <div>
            <dt className="text-xs text-muted">{t("currentPlan")}</dt>
            <dd className="font-semibold tabular-nums">{currentPlan}</dd>
          </div>
        )}
        {proposedPlan === undefined ? null : (
          <div>
            <dt className="text-xs text-muted">{t("proposedPlan")}</dt>
            <dd className="font-semibold tabular-nums">{proposedPlan}</dd>
          </div>
        )}
      </dl>
      {units.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {units.map((unit) => (
            <li key={unit.placementId}>
              <Link
                href={palletPath(unit.handlingUnitId)}
                className="inline-flex min-h-11 items-center rounded-md border border-border px-2.5 font-mono text-xs text-link underline-offset-4 hover:underline"
                aria-label={t("layoutActions.blocked.openUnit", {
                  lpn: unit.lpn,
                })}
              >
                {unit.lpn}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          {t("backToEdit")}
        </Button>
        {buildingHref ? (
          <Button type="button" variant="ghost" size="sm" asChild>
            <Link href={buildingHref}>
              {t("layoutActions.blocked.findInventory")}
            </Link>
          </Button>
        ) : null}
      </div>
    </Notice>
  );
}

/** Units without coordinates count as stock too; they block structure the same. */
export function zoneUnmeasuredCount(zones: readonly StorageZoneRow[]) {
  return zones.reduce(
    (count, zone) => count + (zone.unmeasuredPalletCount ?? 0),
    0,
  );
}
