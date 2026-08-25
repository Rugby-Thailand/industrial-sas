"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import type { ItemRow } from "@/lib/convex/masterDataApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";

const STATUS_TONES: Readonly<Record<string, BadgeTone>> = {
  ACTIVE: "success",
  INACTIVE: "muted",
};

const TRACKING_TONES: Readonly<Record<string, BadgeTone>> = {
  NONE: "neutral",
  LOT: "accent",
  LOT_SERIAL: "warning",
};

export function ItemsTable({
  rows,
  renderAction,
}: {
  readonly rows: readonly ItemRow[];

  readonly renderAction?: (row: ItemRow) => ReactNode;
}) {
  const t = useTranslations("MasterData");
  const statusT = useTranslations(
    "MasterDataStatus",
  ) as unknown as CodeTranslator;
  const trackingT = useTranslations(
    "TrackingMode",
  ) as unknown as CodeTranslator;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <caption className="px-4 py-3 text-left text-sm text-muted">
          {t("itemsCaption", { count: rows.length })}
        </caption>
        <thead>
          <tr className="border-b border-border-strong text-left">
            <th scope="col" className="px-4 py-2 font-semibold">
              {t("columnSku")}
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              {t("columnName")}
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              {t("columnBaseUom")}
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              {t("columnTrackingMode")}
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              {t("columnStatus")}
            </th>
            {renderAction === undefined ? null : (
              <th scope="col" className="px-4 py-2 font-semibold">
                {t("columnAction")}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.itemId}
              className="border-b border-border last:border-0"
            >
              <th
                scope="row"
                className="px-4 py-3 text-left font-mono text-xs font-normal text-text"
              >
                {row.sku}
              </th>
              <td className="px-4 py-3">{row.name}</td>
              <td className="px-4 py-3 font-mono text-xs">{row.baseUom}</td>
              <td className="px-4 py-3">
                <StatusBadge
                  tone={TRACKING_TONES[row.trackingMode] ?? "neutral"}
                  label={codeLabel(trackingT, row.trackingMode)}
                />
              </td>
              <td className="px-4 py-3">
                <StatusBadge
                  tone={STATUS_TONES[row.status] ?? "neutral"}
                  label={codeLabel(statusT, row.status)}
                />
              </td>
              {renderAction === undefined ? null : (
                <td className="px-4 py-3">{renderAction(row)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
