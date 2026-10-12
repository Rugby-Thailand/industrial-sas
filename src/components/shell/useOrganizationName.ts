import { useTranslations } from "next-intl";

import { useAiUsageAccess } from "@/components/providers/AiUsageAccessProvider";
import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";

/**
 * The organization this session works in. Storage, HR and AI usage access
 * settle independently, so any of them can name it; the app name is the
 * fallback until one does.
 */
export function useOrganizationName(): string {
  const app = useTranslations("App");
  const workspace = useWorkspace();
  const hr = useHrAccess();
  const usage = useAiUsageAccess();
  return (
    workspace.organization?.name ??
    hr.organizationName ??
    usage.organizationName ??
    app("name")
  );
}
