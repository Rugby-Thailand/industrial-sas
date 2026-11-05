"use client";

import { CloudOff } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { useConnectionStall } from "@/components/system/connectionStall";
import { Notice } from "@/components/ui/Notice";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { BadgeTone } from "@/components/ui/StatusBadge";
import type { LedgerPanelState } from "@/lib/convex/ledgerState";

export type LedgerFailureState = Exclude<
  LedgerPanelState<unknown>,
  { kind: "READY" }
>;

export function LedgerPanelStatus({
  state,
  action,
  label,
}: {
  readonly state: LedgerFailureState;

  readonly action?: ReactNode;
  /** Names what is loading, e.g. "กำลังโหลดสินค้าสำเร็จรูป…". */
  readonly label?: string;
}) {
  const t = useTranslations("Panel");
  const app = useTranslations("App");
  const waiting = useConnectionStall() !== null;

  if (state.kind === "LOADING") {
    // While the shell says the server can't be reached, the panel waits
    // without motion and leaves the announcement to that notice. A new
    // element rather than a changed one, so the switch is not read out.
    return (
      <div
        key={waiting ? "waiting" : "loading"}
        {...(waiting ? { "data-waiting": "connection" } : { role: "status" })}
        data-testid="panel-LOADING"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-muted">
          {waiting ? (
            <CloudOff aria-hidden="true" className="size-4 shrink-0" />
          ) : (
            <Spinner aria-hidden="true" />
          )}
          {waiting ? app("waitingForConnection") : (label ?? t("loading"))}
        </span>
        {waiting ? null : <span className="sr-only">{t("loadingHint")}</span>}
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
