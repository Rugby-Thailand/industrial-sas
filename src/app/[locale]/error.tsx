"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { useObservability } from "@/components/providers/ObservabilityProvider";
import { PageFailure } from "@/components/shell/PageFailure";
import { START_HREF } from "@/components/shell/pageRecovery";
import { usePathname } from "@/i18n/navigation";
import { applicationRenderErrorEvent } from "@/lib/observability/applicationError";

export default function LocaleError({
  error,
  retry,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly retry: () => void;
}) {
  const t = useTranslations("Error");
  const observability = useObservability();
  // Outside the shell the member's access is unknown, so the way out is the
  // start route (it redirects by permission), named neutrally, unless it is
  // the page that failed.
  const startFailed = usePathname() === START_HREF;

  useEffect(() => {
    // `error` is intentionally a dependency but never part of the event: a new
    // caught error is a new occurrence, while its text and stack are tenant data.
    void error;
    observability.record(applicationRenderErrorEvent("locale", Date.now()));
  }, [error, observability]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center p-6">
      <PageFailure
        title={t("title")}
        cause={t("body")}
        hint={t("hint")}
        {...(startFailed
          ? {}
          : { recovery: { href: START_HREF, label: t("goToStart") } })}
        retryLabel={t("retry")}
        onRetry={retry}
      />
    </main>
  );
}
