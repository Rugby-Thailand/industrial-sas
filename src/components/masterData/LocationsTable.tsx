"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import type { LocationRow } from "@/lib/convex/masterDataApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";

const STATUS_TONES: Readonly<Record<string, BadgeTone>> = {
  ACTIVE: "success",
  INACTIVE: "muted",
};

export function LocationsTable({
  rows,
  renderAction,
}: {
  readonly rows: readonly LocationRow[];

  readonly renderAction?: (row: LocationRow) => ReactNode;
}) {
  const t = useTranslations("MasterData");
  const statusT = useTranslations(
    "MasterDataStatus",
  ) as unknown as CodeTranslator;
  const typeT = useTranslations("LocationType") as unknown as CodeTranslator;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <caption className="px-4 py-3 text-left text-sm text-muted">
          {t("locationsCaption", { count: rows.length })}
        </caption>
        <thead>
          <tr className="border-b border-border-strong text-left">
            <th scope="col" className="px-4 py-2 font-semibold">
              {t("columnLocationCode")}
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              {t("columnLocationType")}
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
              key={row.locationId}
              className="border-b border-border last:border-0"
            >
              <th
                scope="row"
                className="px-4 py-3 text-left font-mono text-xs font-normal text-text"
              >
                {row.code}
              </th>
              <td className="px-4 py-3">
                {codeLabel(typeT, row.locationType)}
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
