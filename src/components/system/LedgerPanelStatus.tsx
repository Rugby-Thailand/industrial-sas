/**
 * Every non-`READY` ledger state, rendered.
 *
 * One component for all seven so that no screen invents its own wording for
 * "denied" or quietly renders a denial as an empty table. The mapping from state
 * to tone, politeness, and message lives here and nowhere else.
 *
 * Two details are load-bearing:
 *
 * - **The request ID is shown.** Every denial and every failure the wrapper
 *   produces carries the server-minted `requestId` that its audit row quotes
 *   (`ADR-0006` §4). Printing it is what turns "it said no" into a support
 *   request someone can answer.
 * - **A code is shown verbatim and in English.** `TRANSACTION_OUT_OF_WAREHOUSE_SCOPE`
 *   is a code identifier, and code identifiers stay English (`D-06`,
 *   `ADR-0010` §1). Translating it would break the only string that connects an
 *   operator's screenshot to a server log.
 */
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Notice } from "@/components/ui/Notice";
import type { BadgeTone } from "@/components/ui/StatusBadge";
import type { LedgerPanelState } from "@/lib/convex/ledgerState";

/** Every state except the one that has rows. */
export type LedgerFailureState = Exclude<
  LedgerPanelState<unknown>,
  { kind: "READY" }
>;

export function LedgerPanelStatus({
  state,
  action,
}: {
  readonly state: LedgerFailureState;
  /** An optional next step, e.g. a link to the setup page. */
  readonly action?: ReactNode;
}) {
  const t = useTranslations("Panel");

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
      case "LOADING":
        return {
          tone: "muted",
          role: "status",
          title: t("loading"),
          body: t("loadingHint"),
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
      /*
       * The state's own name, in the DOM. End-to-end tests must assert *which*
       * state a screen is in, and asserting on translated prose would make them
       * fail on a copy edit rather than on a behaviour change.
       */
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
