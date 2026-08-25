import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { OrganizationRequired } from "@/components/auth/OrganizationRequired";
import { WorkspaceAccessBoundary } from "@/components/providers/WorkspaceAccessBoundary";
import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";
import { DesktopShell } from "@/components/shell/DesktopShell";
import { readAppAccess } from "@/lib/auth/appAccess";

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
  if (access === "SIGN_IN") redirect(`/${locale}/sign-in`);
  if (access === "ORGANIZATION_REQUIRED") return <OrganizationRequired />;
  return (
    <WorkspaceAccessBoundary>
      <WorkspaceProvider>
        <DesktopShell>{children}</DesktopShell>
      </WorkspaceProvider>
    </WorkspaceAccessBoundary>
  );
}
