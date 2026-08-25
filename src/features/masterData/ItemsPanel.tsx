"use client";

import { useTranslations } from "next-intl";

import { ItemsTable } from "@/components/masterData/ItemsTable";
import { Link } from "@/i18n/navigation";
import { itemDetailPath } from "@/lib/navigation";
import { listItemsRef, type ItemRow } from "@/lib/convex/masterDataApi";
import { DEFAULT_LEDGER_PAGE_SIZE } from "@/lib/convex/ledgerApi";

import { MasterDataPanel } from "./MasterDataPanel";

export function ItemsPanel() {
  const t = useTranslations("MasterData");

  return (
    <MasterDataPanel<ItemRow, { maxPageSize?: number; cursor?: string }>
      queryRef={listItemsRef}
      scope="ORG"
      buildArgs={({ cursor }) => ({
        maxPageSize: DEFAULT_LEDGER_PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor }),
      })}
      renderRows={(rows) => (
        <ItemsTable
          rows={rows}

          renderAction={(row) => (
            <Link
              href={itemDetailPath(row.itemId)}
              className="inline-flex min-h-touch items-center rounded-md border border-border-strong px-3 text-xs font-semibold"
              data-testid={`item-open-${row.sku}`}
            >
              {t("openItem")}
            </Link>
          )}
        />
      )}
    />
  );
}
