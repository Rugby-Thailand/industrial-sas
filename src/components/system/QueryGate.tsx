"use client";

import type { ReactNode } from "react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import type { ReadScope } from "@/lib/convex/ledgerState";
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
    return <LedgerPanelStatus state={{ kind: "WAREHOUSE_MISSING" }} />;
  }
  return <>{children(workspace.selectedWarehouseId, false)}</>;
}
