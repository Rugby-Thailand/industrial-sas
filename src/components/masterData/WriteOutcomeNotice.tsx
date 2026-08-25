"use client";

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
