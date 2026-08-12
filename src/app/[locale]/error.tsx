"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { useObservability } from "@/components/providers/ObservabilityProvider";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { applicationRenderErrorEvent } from "@/lib/observability/applicationError";

export default function LocaleError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  const t = useTranslations("Error");
  const observability = useObservability();

  useEffect(() => {
    // `error` is intentionally a dependency but never part of the event: a new
    // caught error is a new occurrence, while its text and stack are tenant data.
    void error;
    observability.record(applicationRenderErrorEvent("locale", Date.now()));
  }, [error, observability]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center p-6">
      <Notice
        tone="danger"
        role="alert"
        title={t("title")}
        body={t("body")}
        testId="route-error"
      >
        <Button type="button" onClick={reset}>
          {t("retry")}
        </Button>
      </Notice>
    </main>
  );
}
