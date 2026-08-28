"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { QueryErrorBoundary } from "@/components/system/QueryErrorBoundary";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";

import { useWorkspace } from "./WorkspaceProvider";

function QueryFailure() {
  const t = useTranslations("Panel");

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6">
      <PageHeader title={t("error")} />
      <Notice
        tone="danger"
        role="alert"
        title={t("error")}
        body={t("errorHint")}
        testId="workspace-query-error"
      >
        <Button type="button" onClick={() => window.location.reload()}>
          {t("retry")}
        </Button>
      </Notice>
    </main>
  );
}

export function WorkspaceAccessBoundary({
  children,
}: {
  readonly children: ReactNode;
}) {
  const workspace = useWorkspace();

  if (workspace.failed) return <QueryFailure />;

  return (
    <QueryErrorBoundary resetKey="workspace" fallback={() => <QueryFailure />}>
      {children}
    </QueryErrorBoundary>
  );
}
