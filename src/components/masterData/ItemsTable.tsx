"use client";

/**
 * The item catalogue, as a semantic table.
 *
 * The columns are what the ledger actually depends on, and nothing decorative:
 *
 * - **SKU** — the tenant's normalized code, unique per organization by contract.
 *   A code identifier, so it stays English (`D-06`) and is rendered monospaced.
 * - **Name** — may be Thai, and is the column allowed to wrap. Thai has no word
 *   spaces, so it breaks differently from Latin text; giving it the flexible
 *   column is what keeps a long Thai name from pushing the quantity-bearing
 *   columns off a handheld screen.
 * - **Base UOM** — the one unit quantities are stored in (`ADR-0004`). Shown
 *   because a lot code means nothing without it.
 * - **Tracking mode** — decides whether a lot is required on a posting (D-09).
 *   `LOT_SERIAL` is displayed and deliberately marked: the schema is
 *   serial-ready and the flows are off, so an operator seeing one should know
 *   it is not yet postable.
 * - **Status** — a word plus a glyph, never colour alone (`INV-0010-07`).
 */
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import type { ItemRow } from "@/lib/convex/masterDataApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";

const STATUS_TONES: Readonly<Record<string, BadgeTone>> = {
  ACTIVE: "success",
  INACTIVE: "muted",
};

/**
 * `LOT_SERIAL` is `warning`, not `neutral`.
 *
 * Its flows are feature-disabled (D-09, `INV-0005-08`) and the ledger refuses a
 * serial outright, so an item in that mode cannot be received today. That is a
 * fact worth showing on the row rather than discovering at the dock.
 */
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
  /**
   * A per-row control, when the screen has one. Optional so the read-only
   * rendering of this table stays exactly what it was: a table that grew a
   * blank column for screens with no controls would be a table with a header
   * an assistive technology reads out for nothing.
   */
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
