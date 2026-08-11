"use client";

/**
 * Every write ending, rendered.
 *
 * The sibling of `LedgerPanelStatus`, and separate for the same reason the state
 * machines are separate: the endings differ. A read has no "may or may not have
 * happened"; a write does, and it is the ending that decides what the operator
 * should do next.
 *
 * - **`SAVED`** distinguishes a first write from a replay. A replay is not a
 *   failure and not a duplicate — it is the idempotency key doing its job — and
 *   saying so is what stops someone from "fixing" it by submitting again.
 * - **`DEMONSTRATED`** is preview mode, and it says *nothing was stored* in the
 *   title rather than in a footnote. This is the state a stakeholder is most
 *   likely to misread, so it is the one that gets the plainest wording.
 * - **`DENIED`** shows the request ID and nothing else. The server refuses to
 *   say which permission was missing (`INV-0002-07`), and inventing a reason
 *   here would be a guess that turns the screen into a permission oracle.
 * - **`FAILED`** tells the operator to retry, because the retry replays: the
 *   same request ID is reused, so a write that did reach the server is not
 *   applied twice.
 *
 * Refusal codes are shown verbatim and in English (`D-06`): the code is the only
 * string that connects a screenshot to a server log.
 */
import { useTranslations } from "next-intl";

import { Notice } from "@/components/ui/Notice";
import type { BadgeTone } from "@/components/ui/StatusBadge";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";
import type { WriteState } from "@/lib/convex/writeState";

export function WriteOutcomeNotice({ state }: { readonly state: WriteState }) {
  const t = useTranslations("Write");
  const errorT = useTranslations("WriteError") as unknown as CodeTranslator;

  if (state.kind === "IDLE" || state.kind === "SUBMITTING") {
    return state.kind === "SUBMITTING" ? (
      <Notice
        tone="pending"
        title={t("submitting")}
        body={t("submittingHint")}
        testId="write-SUBMITTING"
      />
    ) : null;
  }

  const presentation = ((): {
    tone: BadgeTone;
    role: "status" | "alert";
    title: string;
    body: string;
    code?: string;
  } => {
    switch (state.kind) {
      case "SAVED":
        return state.replayed
          ? {
              tone: "success",
              role: "status",
              title: t("savedReplayed"),
              body: t("savedReplayedHint"),
            }
          : {
              tone: "success",
              role: "status",
              title: t("saved"),
              body: t("savedHint"),
            };
      case "DEMONSTRATED":
        return {
          tone: "accent",
          role: "status",
          title: t("demonstrated"),
          body: t("demonstratedHint"),
        };
      case "DENIED":
        return {
          tone: "danger",
          role: "alert",
          title: t("denied"),
          body: t("deniedHint", { requestId: state.requestId }),
        };
      case "REFUSED":
        return {
          tone: "warning",
          role: "alert",
          title: t("refused"),
          body: codeLabel(errorT, state.code),
          code: state.code,
        };
      case "FAILED":
        return {
          tone: "danger",
          role: "alert",
          title: t("failed"),
          body: t("failedHint"),
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
      testId={`write-${state.kind}`}
    >
      {presentation.code === undefined ? undefined : (
        <code className="rounded bg-raised px-2 py-1 font-mono text-xs text-text">
          {presentation.code}
        </code>
      )}
    </Notice>
  );
}
