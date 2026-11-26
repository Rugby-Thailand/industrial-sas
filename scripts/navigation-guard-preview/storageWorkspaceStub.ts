import { createContext, useContext } from "react";
import type { WorkspaceContextValue } from "@/components/providers/WorkspaceProvider";

const workspace: WorkspaceContextValue = {
  authenticated: true,
  readiness: { kind: "READY_TO_QUERY" },
  organization: undefined,
  warehouses: [],
  selectedWarehouseId: undefined,
  selectable: false,
  complete: true,
  loading: false,
  failed: false,
  denied: false,
  permissionsReady: true,
  navigationPermissions: [
    "masterData.warehouse.read",
    "masterData.storageLayout.manage",
  ],
  selectWarehouse: () => {},
};

const catalogueWorkspace: WorkspaceContextValue = {
  ...workspace,
  selectedWarehouseId: "fixture-warehouse",
  navigationPermissions: [
    ...workspace.navigationPermissions,
    "masterData.storageLayout.activate",
  ],
};

export const CatalogueWorkspaceContext = createContext(false);

export function useWorkspace() {
  return useContext(CatalogueWorkspaceContext) ? catalogueWorkspace : workspace;
}
