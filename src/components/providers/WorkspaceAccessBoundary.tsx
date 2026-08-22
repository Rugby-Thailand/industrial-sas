"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { QueryErrorBoundary } from "@/components/system/QueryErrorBoundary";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";

/** Turn an unprovisioned tenant query into a clear access state. */
export function WorkspaceAccessBoundary({
  children,
}: {
  readonly children: ReactNode;
}) {
  const t = useTranslations("Access");

  return (
    <QueryErrorBoundary
      resetKey="workspace"
      fallback={() => (
        <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6">
          <PageHeader title={t("organizationRequiredTitle")} />
          <Notice
            tone="warning"
            title={t("organizationRequiredTitle")}
            body={t("organizationRequiredBody")}
            testId="organization-required"
          />
        </main>
      )}
    >
      {children}
    </QueryErrorBoundary>
  );
}
