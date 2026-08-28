"use client";

import { SquareArrowOutUpRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { ItemsTable } from "@/components/masterData/ItemsTable";
import { TableAction } from "@/components/table/TableRowControls";
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
            <TableAction asChild label={t("openItem")}>
              <Link
                href={itemDetailPath(row.itemId)}
                data-testid={`item-open-${row.sku}`}
              >
                <SquareArrowOutUpRight aria-hidden="true" className="size-4" />
              </Link>
            </TableAction>
          )}
        />
      )}
    />
  );
}
