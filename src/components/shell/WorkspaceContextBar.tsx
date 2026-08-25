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
import { Building2, Warehouse as WarehouseIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";

import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { SelectControl } from "@/components/ui/SelectControl";
import { organizationLabel, warehouseLabel } from "@/lib/workspace/workspace";

export function WorkspaceContextBar() {
  const t = useTranslations("Workspace");
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

  /*
   * One compact row instead of two stacked labeled blocks: the icons carry the
   * visual grouping (decorative — the accessible names are the sr-only texts
   * beside them), so the context costs the shell a single line without losing
   * either fact. The organization stays a label and the warehouse stays a
   * control, exactly as before.
   */
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <span
        className="flex min-w-0 items-center gap-1.5"
        title={t("organization")}
      >
        <Building2 aria-hidden="true" className="size-4 shrink-0 text-muted" />
        <span className="sr-only">{t("organization")}</span>
        <span className="truncate font-semibold text-text">
          {organizationLabel(workspace.organization)}
        </span>
      </span>

      <span className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
        <WarehouseIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted"
        />
        {/*
         * `htmlFor` rather than a wrapping `<label>`: the Radix trigger is a
         * `<button>`, which is a labelable element, but only an explicit `for`
         * reaches it — a wrapping label associates with nothing and the control
         * loses its accessible name. The label is sr-only; the warehouse glyph
         * plus the selected value carry the meaning visually.
         */}
        <label htmlFor={warehouseId} className="sr-only">
          {t("warehouse")}
        </label>
        <SelectControl
          id={warehouseId}
          value={workspace.selectedWarehouseId ?? ""}
          onValueChange={(warehouse) => workspace.selectWarehouse(warehouse)}
          placeholder={t("selectWarehouse")}
          emptyLabel={t("noWarehouses")}
          className="w-full min-w-0 font-semibold sm:w-64"
          testId="warehouse-select"
          options={workspace.warehouses.map((warehouse) => ({
            value: warehouse.id,
            label: warehouseLabel(warehouse),
          }))}
        />
      </span>
    </div>
  );
}
