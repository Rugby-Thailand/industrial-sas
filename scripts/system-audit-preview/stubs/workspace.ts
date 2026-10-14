import type { ReactNode } from "react";
export const useWorkspace = () => ({
  permissionsReady: true,
  navigationPermissions: ["masterData.storageLayout.manage"],
  selectedWarehouseId: "audit-warehouse",
  organization: { id: "audit-org", name: "Demo organization" },
  readiness: { kind: "READY_TO_QUERY" },
  failed:
    new URLSearchParams(location.search).get("view") === "workspace-error",
});
export const WorkspaceProvider = ({ children }: { children: ReactNode }) =>
  children;
