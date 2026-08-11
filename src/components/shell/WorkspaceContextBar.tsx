"use client";

/**
 * The organization and warehouse an operator is currently acting in.
 *
 * The UX plan (§1) puts this above decoration for a reason: a supervisor with
 * two sites and a handheld shared between shifts needs to see, without asking,
 * whose stock they are looking at. So it is permanent shell chrome, not a
 * setting buried in a menu.
 *
 * The organization is a **label**, never a control. It comes from the verified
 * token's active-organization claim server-side (`INV-0001-02`); switching it is
 * Clerk's organization switcher, not a dropdown in this application. The
 * warehouse *is* a control, because it is an argument the server revalidates on
 * every call (`INV-0006-04`).
 *
 * With no identity provider configured there is no organization to name and no
 * warehouse list to offer, so this renders the reason rather than an empty
 * dropdown — the difference between "nothing here" and "not available yet".
 */
import { useLocale, useTranslations } from "next-intl";

import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { organizationLabel, warehouseLabel } from "@/lib/workspace/workspace";

export function WorkspaceContextBar() {
  const t = useTranslations("Workspace");
  const locale = useLocale();
  const workspace = useWorkspace();

  if (!workspace.selectable || workspace.organization === undefined) {
    return (
      <div className="flex flex-col gap-0.5 text-sm">
        <span className="font-semibold text-text">{t("unavailable")}</span>
        <span className="text-muted">{t("unavailableHint")}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <span className="flex flex-col">
        <span className="text-xs text-muted">{t("organization")}</span>
        <span className="font-semibold text-text">
          {organizationLabel(workspace.organization, locale)}
        </span>
      </span>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">{t("warehouse")}</span>
        <select
          className="min-h-touch rounded-md border border-border-strong bg-surface px-3 py-2 text-sm font-semibold text-text"
          value={workspace.selectedWarehouseId ?? ""}
          onChange={(event) => workspace.selectWarehouse(event.target.value)}
        >
          <option value="" disabled>
            {t("selectWarehouse")}
          </option>
          {workspace.warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouseLabel(warehouse, locale)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
