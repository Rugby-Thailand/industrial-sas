"use client";

import { useConvexAuth } from "convex/react";
import type { ReactNode } from "react";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { resolveLedgerGate, type ReadScope } from "@/lib/convex/ledgerState";

import { LedgerPanelStatus } from "./LedgerPanelStatus";

export function QueryGate({
  scope,
  children,
}: {
  readonly scope: ReadScope;
  readonly children: (warehouseId: string, preview: false) => ReactNode;
}): ReactNode {
  const environment = useAppEnvironment();
  const warehouseId = useWorkspace().selectedWarehouseId;
  const gate = resolveLedgerGate(environment, warehouseId, scope);

  if (gate.kind !== "READY_TO_QUERY") {
    return <LedgerPanelStatus state={gate} />;
  }
  return (
    <AuthenticatedQueryGate warehouseId={gate.warehouseId}>
      {children}
    </AuthenticatedQueryGate>
  );
}

function AuthenticatedQueryGate({
  warehouseId,
  children,
}: {
  readonly warehouseId: string;
  readonly children: (warehouseId: string, preview: false) => ReactNode;
}): ReactNode {
  const authentication = useConvexAuth();

  if (authentication.isLoading) {
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  }
  if (!authentication.isAuthenticated) {
    return <LedgerPanelStatus state={{ kind: "SIGN_IN_REQUIRED" }} />;
  }
  return <>{children(warehouseId, false)}</>;
}
