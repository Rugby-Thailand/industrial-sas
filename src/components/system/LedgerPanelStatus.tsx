import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Notice } from "@/components/ui/Notice";
import { Skeleton } from "@/components/ui/skeleton";
import type { BadgeTone } from "@/components/ui/StatusBadge";
import type { LedgerPanelState } from "@/lib/convex/ledgerState";

export type LedgerFailureState = Exclude<
  LedgerPanelState<unknown>,
  { kind: "READY" }
>;

export function LedgerPanelStatus({
  state,
  action,
}: {
  readonly state: LedgerFailureState;

  readonly action?: ReactNode;
}) {
  const t = useTranslations("Panel");

  if (state.kind === "LOADING") {
    return (
      <div
        role="status"
        data-testid="panel-LOADING"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <span className="text-sm font-semibold text-muted">{t("loading")}</span>
        <span className="sr-only">{t("loadingHint")}</span>
        <div aria-hidden="true" className="flex flex-col gap-2">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      </div>
    );
  }

  const presentation = ((): {
    tone: BadgeTone;
    role: "status" | "alert";
    title: string;
    body: string;
    code?: string;
  } => {
    switch (state.kind) {
      case "BACKEND_MISSING":
        return {
          tone: "warning",
          role: "status",
          title: t("backendMissing"),
          body: t("backendMissingHint"),
        };
      case "SIGN_IN_REQUIRED":
        return {
          tone: "accent",
          role: "status",
          title: t("signInRequired"),
          body: t("signInRequiredHint"),
        };
      case "WAREHOUSE_MISSING":
        return {
          tone: "neutral",
          role: "status",
          title: t("warehouseMissing"),
          body: t("warehouseMissingHint"),
        };
      case "DENIED":
        return {
          tone: "danger",
          role: "alert",
          title: t("denied"),
          body: t("deniedHint", { requestId: state.requestId }),
        };
      case "LEDGER_ERROR":
        return {
          tone: "danger",
          role: "alert",
          title: t("error"),
          body: t("deniedHint", { requestId: state.requestId }),
          code: state.code,
        };
      case "ERROR":
        return {
          tone: "danger",
          role: "alert",
          title: t("error"),
          body: t("errorHint"),
          code: state.code,
        };
    }
  })();

  return (
    <Notice
      tone={presentation.tone}
      role={presentation.role}
      title={presentation.title}
      body={presentation.body}

      testId={`panel-${state.kind}`}
    >
      {presentation.code === undefined && action === undefined ? undefined : (
        <div className="flex flex-wrap items-center gap-3">
          {presentation.code === undefined ? null : (
            <code className="rounded bg-raised px-2 py-1 font-mono text-xs text-text">
              {presentation.code}
            </code>
          )}
          {action}
        </div>
      )}
    </Notice>
  );
}
