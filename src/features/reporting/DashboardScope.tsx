"use client";

/**
 * Which site the numbers below belong to.
 *
 * The dashboard reads are all warehouse-scoped, and every figure on the page
 * changes completely when the selection does. Naming the site under the page
 * heading is what makes the rest of the screen legible — a supervisor with two
 * sites and a shared handheld should never have to look up at the shell chrome
 * to work out whose backlog they are reading (`UX §1`, `INV-0006-04`).
 *
 * It is a label, not a second control. The switcher lives in the shell, exactly
 * once; a second copy here would be two things to keep in agreement for no gain.
 * When nothing is selected it says so, because a heading with no site under it
 * reads as "all sites", which this page never shows.
 */
import { useLocale, useTranslations } from "next-intl";

import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { Badge } from "@/components/ui/badge";
import { warehouseLabel } from "@/lib/workspace/workspace";

export function DashboardScope() {
  const t = useTranslations("Workspace");
  const locale = useLocale();
  const workspace = useWorkspace();

  const selected = workspace.warehouses.find(
    (warehouse) => warehouse.id === workspace.selectedWarehouseId,
  );

  return (
    <p
      className="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted"
      data-testid="dashboard-scope"
    >
      <span>{t("warehouse")}</span>
      <Badge variant="secondary" className="h-auto py-1 whitespace-normal">
        {selected === undefined
          ? t("noWarehouse")
          : warehouseLabel(selected, locale)}
      </Badge>
    </p>
  );
}
