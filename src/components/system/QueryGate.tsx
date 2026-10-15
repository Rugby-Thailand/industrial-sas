"use client";

import { useTranslations } from "next-intl";
import { useId, type ReactNode } from "react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { Notice } from "@/components/ui/Notice";
import { SelectControl } from "@/components/ui/SelectControl";
import type { ReadScope } from "@/lib/convex/ledgerState";
import { warehouseLabel } from "@/lib/workspace/workspace";
import { LedgerPanelStatus } from "./LedgerPanelStatus";

/** Readiness is resolved once by WorkspaceProvider, before mounting feature queries. */
export function QueryGate({
  scope,
  children,
}: {
  readonly scope: ReadScope;
  readonly children: (warehouseId: string, preview: false) => ReactNode;
}): ReactNode {
  const workspace = useWorkspace();
  if (workspace.readiness.kind !== "READY_TO_QUERY") {
    return <LedgerPanelStatus state={workspace.readiness} />;
  }
  if (scope === "ORG") return <>{children("", false)}</>;
  if (workspace.selectedWarehouseId === undefined) {
    return workspace.warehouses.length === 0 ? (
      <NoWarehouseAccess />
    ) : (
      <LedgerPanelStatus
        state={{ kind: "WAREHOUSE_MISSING" }}
        action={<WarehouseChoice />}
      />
    );
  }
  return <>{children(workspace.selectedWarehouseId, false)}</>;
}

/** The member's organization has no active warehouse they may open. */
function NoWarehouseAccess() {
  const t = useTranslations("Panel");
  return (
    <Notice
      tone="neutral"
      role="status"
      title={t("warehouseUnavailable")}
      body={t("warehouseUnavailableHint")}
      testId="panel-WAREHOUSE_UNAVAILABLE"
    />
  );
}

/**
 * Lets a direct link opened without a stored selection choose its warehouse
 * in place: the gated page then renders on the same URL. Nothing gated is
 * mounted yet, so no draft can be lost. Once a warehouse is selected, task and
 * detail pages keep it read-only.
 */
function WarehouseChoice() {
  const t = useTranslations("Workspace");
  const workspace = useWorkspace();
  const id = useId();
  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5 sm:max-w-sm">
      <label htmlFor={id} className="text-sm font-medium text-text">
        {t("warehouse")}
      </label>
      <SelectControl
        id={id}
        value=""
        onValueChange={(warehouse) => workspace.selectWarehouse(warehouse)}
        placeholder={t("selectWarehouse")}
        emptyLabel={t("noWarehouses")}
        testId="warehouse-gate-select"
        options={workspace.warehouses.map((warehouse) => ({
          value: warehouse.id,
          label: warehouseLabel(warehouse),
        }))}
      />
    </div>
  );
}
