"use client";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
/** Display affordance only; every server operation still authorizes the request. */
export function useCan(code: string): boolean {
  const { permissionsReady, navigationPermissions } = useWorkspace();
  return permissionsReady && navigationPermissions.includes(code);
}
