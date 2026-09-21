"use client";

import { useTranslations } from "next-intl";
import { Notice } from "@/components/ui/Notice";

import { type StorageStackPlacementRow } from "@/lib/convex/storageLayoutApi";

import {
  maximumOccupiedHeight,
  uniqueStoragePallets,
} from "@/lib/storageLayouts/storagePlacementGeometry";
export {
  metres,
  millimetres,
  squareMetres,
} from "@/lib/storageLayouts/storageKit";
import { metres } from "@/lib/storageLayouts/storageKit";

/** Client-only identity for a newly drafted reserved block, not a command key. */
export const localEntityId = () => crypto.randomUUID();

export function storageErrorMessage(
  t: ReturnType<typeof useTranslations<"StorageLayouts">>,
  code: string,
) {
  if (code === "RESERVED_BLOCK_COLOR_INVALID") return t("areaColor.invalid");
  if (code === "LOCATION_OCCUPIED") return t("occupiedChangeBlocked");
  if (code === "VERSION_CONFLICT") return t("layoutChangedRetry");
  return t("writeError", { code });
}

export function ChangeImpactSummary({
  placements,
  currentPlan,
  proposedPlan,
}: {
  readonly placements: readonly StorageStackPlacementRow[];
  readonly currentPlan?: string;
  readonly proposedPlan?: string;
}) {
  const t = useTranslations("StorageLayouts");
  const occupiedHeightMm = maximumOccupiedHeight(placements);
  return (
    <Notice
      tone="warning"
      role="alert"
      title={t("impactReviewTitle")}
      body={t("impactReviewDescription")}
    >
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <Metric
          label={t("affectedHandlingUnits")}
          value={String(uniqueStoragePallets(placements).length)}
        />
        <Metric
          label={t("occupiedHeight")}
          value={`${metres(occupiedHeightMm)} m`}
        />
        {currentPlan === undefined ? null : (
          <Metric label={t("currentPlan")} value={currentPlan} />
        )}
        {proposedPlan === undefined ? null : (
          <Metric label={t("proposedPlan")} value={proposedPlan} />
        )}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {uniqueStoragePallets(placements).map((placement) => (
          <span
            key={placement.placementId}
            className="rounded-full border border-warning/35 bg-background px-2.5 py-1 font-mono text-xs text-text"
          >
            {placement.lpn}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">{t("impactAuditHelp")}</p>
    </Notice>
  );
}

export function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-semibold text-text tabular-nums">{value}</dd>
    </div>
  );
}
