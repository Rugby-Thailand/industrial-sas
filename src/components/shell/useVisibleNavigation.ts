import { useAiUsageAccess } from "@/components/providers/AiUsageAccessProvider";
import { useCustomerNavigationAccess } from "@/components/providers/CustomerNavigationAccessProvider";
import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { useGrantedPermissions } from "@/components/shell/search/GlobalSearchProvider";
import {
  visibleDesktopNavigation,
  type NavigationSection,
} from "@/lib/navigation";

/**
 * The member's permitted menu, as the sidebar shows it, and whether it is
 * final. Warehouse, customer, HR and AI usage grants settle independently.
 */
export function useVisibleNavigation(): {
  readonly sections: readonly NavigationSection[];
  readonly settled: boolean;
} {
  const workspace = useWorkspace();
  const hr = useHrAccess();
  const usage = useAiUsageAccess();
  const customer = useCustomerNavigationAccess();
  const sections = visibleDesktopNavigation(useGrantedPermissions());
  const settled =
    (workspace.permissionsReady || workspace.denied || workspace.failed) &&
    !customer.loading &&
    hr.status !== "LOADING" &&
    usage.status !== "LOADING";
  return { sections, settled };
}
