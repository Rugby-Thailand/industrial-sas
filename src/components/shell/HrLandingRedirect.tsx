"use client";

import { useEffect } from "react";

import { useAiUsageAccess } from "@/components/providers/AiUsageAccessProvider";
import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { usePathname, useRouter } from "@/i18n/navigation";
import {
  isActivePath,
  PLANNER_PATHS,
  ROUTES,
  visibleDesktopNavigation,
} from "@/lib/navigation";

/**
 * Sends a member without storage access from a storage page (the sign-in
 * default) to their first HR destination, or else to the AI usage report,
 * instead of a storage denial. Storage members and members without either
 * access are never redirected.
 */
export function HrLandingRedirect() {
  const workspace = useWorkspace();
  const hr = useHrAccess();
  const usage = useAiUsageAccess();
  const pathname = usePathname();
  const router = useRouter();
  const hrTarget =
    hr.status === "READY"
      ? visibleDesktopNavigation(hr.permissions)
          .flatMap((section) => section.items)
          .find((item) => item.href.startsWith("/hr/"))?.href
      : undefined;
  // HR keeps precedence, so wait for it to settle before choosing the report.
  const usageTarget =
    hr.status !== "LOADING" &&
    usage.status === "READY" &&
    usage.permissions.includes("aiUsage.read")
      ? ROUTES.aiUsage
      : undefined;
  const target = workspace.denied ? (hrTarget ?? usageTarget) : undefined;
  const onPlannerPage = PLANNER_PATHS.some((path) =>
    isActivePath(pathname, path),
  );
  useEffect(() => {
    if (target !== undefined && onPlannerPage) router.replace(target);
  }, [onPlannerPage, router, target]);
  return null;
}
