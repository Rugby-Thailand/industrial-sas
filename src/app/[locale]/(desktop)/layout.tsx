import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import { OrganizationRequired } from "@/components/auth/OrganizationRequired";
import { WorkspaceAccessBoundary } from "@/components/providers/WorkspaceAccessBoundary";
import { DesktopShell } from "@/components/shell/DesktopShell";
import {
  SIDEBAR_COOKIE_NAME,
  sidebarOpenFromCookie,
} from "@/components/ui/sidebarState";
import { readAppAccess } from "@/lib/auth/appAccess";
import { plannerReturnPath, RETURN_PATH_HEADER } from "@/lib/auth/returnPath";

export default async function DesktopLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const access = await readAppAccess();
  if (access === "SIGN_IN") {
    const returnTo = plannerReturnPath(
      (await headers()).get(RETURN_PATH_HEADER),
      locale,
    );
    redirect(
      `/${locale}/sign-in${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`,
    );
  }
  if (access === "ORGANIZATION_REQUIRED") return <OrganizationRequired />;
  // The member's last sidebar choice, so the first render already matches it.
  const sidebarOpen = sidebarOpenFromCookie(
    (await cookies()).get(SIDEBAR_COOKIE_NAME)?.value,
  );
  return (
    <WorkspaceAccessBoundary>
      <DesktopShell defaultOpen={sidebarOpen}>{children}</DesktopShell>
    </WorkspaceAccessBoundary>
  );
}
