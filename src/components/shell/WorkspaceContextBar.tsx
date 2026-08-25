"use client";

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
