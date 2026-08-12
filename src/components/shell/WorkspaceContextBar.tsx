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
import { useId } from "react";

import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { SelectControl } from "@/components/ui/SelectControl";
import { organizationLabel, warehouseLabel } from "@/lib/workspace/workspace";

export function WorkspaceContextBar() {
  const t = useTranslations("Workspace");
  const locale = useLocale();
  const workspace = useWorkspace();
  const warehouseId = useId();

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

      <span className="flex flex-col gap-1">
        {/*
         * `htmlFor` rather than a wrapping `<label>`: the Radix trigger is a
         * `<button>`, which is a labelable element, but only an explicit `for`
         * reaches it — a wrapping label associates with nothing and the control
         * loses its accessible name.
         */}
        <label htmlFor={warehouseId} className="text-xs text-muted">
          {t("warehouse")}
        </label>
        <SelectControl
          id={warehouseId}
          value={workspace.selectedWarehouseId ?? ""}
          onValueChange={(warehouse) => workspace.selectWarehouse(warehouse)}
          placeholder={t("selectWarehouse")}
          emptyLabel={t("noWarehouses")}
          className="w-full font-semibold sm:w-64"
          testId="warehouse-select"
          options={workspace.warehouses.map((warehouse) => ({
            value: warehouse.id,
            label: warehouseLabel(warehouse, locale),
          }))}
        />
      </span>
    </div>
  );
}
