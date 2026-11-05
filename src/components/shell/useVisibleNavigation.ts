import { useAiUsageAccess } from "@/components/providers/AiUsageAccessProvider";
import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { useGrantedPermissions } from "@/components/shell/search/GlobalSearchProvider";
import {
  visibleDesktopNavigation,
  type NavigationSection,
} from "@/lib/navigation";

/**
 * The member's permitted menu, as the sidebar shows it, and whether it is
 * final. Storage, HR and AI usage grants settle independently; a storage
 * denial is a settled answer (an HR-only or usage-only member), not a reason
 * to keep waiting.
 */
export function useVisibleNavigation(): {
  readonly sections: readonly NavigationSection[];
  readonly settled: boolean;
} {
  const workspace = useWorkspace();
  const hr = useHrAccess();
  const usage = useAiUsageAccess();
  const sections = visibleDesktopNavigation(useGrantedPermissions());
  const settled =
    (workspace.permissionsReady || workspace.denied || workspace.failed) &&
    hr.status !== "LOADING" &&
    usage.status !== "LOADING";
  return { sections, settled };
}
