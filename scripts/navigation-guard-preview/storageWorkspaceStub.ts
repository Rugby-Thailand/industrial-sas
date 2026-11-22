import type { WorkspaceContextValue } from "@/components/providers/WorkspaceProvider";

const workspace: WorkspaceContextValue = {
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

export function useWorkspace() {
  return workspace;
}
