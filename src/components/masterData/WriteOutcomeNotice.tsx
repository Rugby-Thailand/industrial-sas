"use client";

import { useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";

import {
  FloatingAlertCard,
  type FloatingAlertPayload,
  useFloatingAlerts,
  WRITE_ERROR_ALERT_DURATION_MS,
} from "@/components/providers/FloatingAlertProvider";
import { Notice } from "@/components/ui/Notice";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";
import type { WriteState } from "@/lib/convex/writeState";

export function WriteOutcomeNotice({ state }: { readonly state: WriteState }) {
  const t = useTranslations("Write");
  const errorT = useTranslations("WriteError") as unknown as CodeTranslator;
  const floatingAlerts = useFloatingAlerts();
  const requestId = state.kind === "DENIED" ? state.requestId : undefined;
  const errorCode =
    state.kind === "REFUSED" || state.kind === "FAILED"
      ? state.code
      : undefined;
  const errorField = state.kind === "REFUSED" ? state.field : undefined;

  const presentation = useMemo<FloatingAlertPayload | null>(() => {
    switch (state.kind) {
      case "DENIED":
        return {
          id: `write-DENIED-${requestId}`,
          variant: "destructive",
          title: t("denied"),
          body: t("deniedHint", { requestId: requestId ?? "" }),
          dismissLabel: t("dismissError"),
          durationMs: WRITE_ERROR_ALERT_DURATION_MS,
          testId: "write-DENIED",
        };
      case "REFUSED":
        return {
          id: `write-REFUSED-${errorCode}-${errorField ?? ""}`,
          variant: "warning",
          title: t("refused"),
          body: codeLabel(errorT, errorCode ?? "UNKNOWN"),
          code: errorCode ?? "UNKNOWN",
          dismissLabel: t("dismissError"),
          durationMs: WRITE_ERROR_ALERT_DURATION_MS,
          testId: "write-REFUSED",
        };
      case "FAILED":
        return {
          id: `write-FAILED-${errorCode}`,
          variant: "destructive",
          title: t("failed"),
          body: t("failedHint"),
          code: errorCode ?? "UNKNOWN",
          dismissLabel: t("dismissError"),
          durationMs: WRITE_ERROR_ALERT_DURATION_MS,
          testId: "write-FAILED",
        };
      case "IDLE":
      case "SAVED":
      case "SUBMITTING":
        return null;
    }
  }, [errorCode, errorField, errorT, requestId, state.kind, t]);

  useEffect(() => {
    if (presentation !== null && floatingAlerts !== null) {
      floatingAlerts.pushAlert(presentation);
    }
  }, [floatingAlerts, presentation]);

  if (state.kind === "IDLE" || state.kind === "SAVED") {
    return null;
  }

  if (state.kind === "SUBMITTING") {
    return (
      <Notice
        tone="pending"
        title={t("submitting")}
        body={t("submittingHint")}
        testId="write-SUBMITTING"
      />
    );
  }

  if (floatingAlerts !== null) {
    return null;
  }

  if (presentation === null) {
    return null;
  }

  return <FloatingAlertCard alert={presentation} />;
}
