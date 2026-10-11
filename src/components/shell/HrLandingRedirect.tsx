"use client";

import { useEffect } from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { usePathname, useRouter } from "@/i18n/navigation";
import {
  isActivePath,
  PLANNER_PATHS,
  visibleDesktopNavigation,
} from "@/lib/navigation";

/**
 * Sends an HR-only member from a storage page (the sign-in default) to their
 * first HR destination instead of a storage denial. Storage members and
 * members without HR access are never redirected.
 */
export function HrLandingRedirect() {
  const workspace = useWorkspace();
  const hr = useHrAccess();
  const pathname = usePathname();
  const router = useRouter();
  const target =
    workspace.denied && hr.status === "READY"
      ? visibleDesktopNavigation(hr.permissions)
          .flatMap((section) => section.items)
          .find((item) => item.href.startsWith("/hr/"))?.href
      : undefined;
  const onPlannerPage = PLANNER_PATHS.some((path) =>
    isActivePath(pathname, path),
  );
  useEffect(() => {
    if (target !== undefined && onPlannerPage) router.replace(target);
  }, [onPlannerPage, router, target]);
  return null;
}
