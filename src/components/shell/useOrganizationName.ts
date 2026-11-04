import { useTranslations } from "next-intl";

import { useAiUsageAccess } from "@/components/providers/AiUsageAccessProvider";
import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";

/**
 * The organization this session works in. Storage, HR and AI usage access
 * settle independently, so any of them can name it. `undefined` while none
 * has named it and one is still loading; the app name only once all have
 * settled without an organization.
 */
export function useOrganizationName(): string | undefined {
  const app = useTranslations("App");
  const workspace = useWorkspace();
  const hr = useHrAccess();
  const usage = useAiUsageAccess();
  const name =
    workspace.organization?.name ??
    hr.organizationName ??
    usage.organizationName;
  if (name !== undefined) return name;
  const loading =
    workspace.loading || hr.status === "LOADING" || usage.status === "LOADING";
  return loading ? undefined : app("name");
}
