"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { useObservability } from "@/components/providers/ObservabilityProvider";
import { PageFailure } from "@/components/shell/PageFailure";
import { START_DESTINATION } from "@/components/shell/pageRecovery";
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
  const navigation = useTranslations("Navigation");
  const observability = useObservability();
  const pathname = usePathname();
  // Outside the shell the start page is the one safe place, unless it failed.
  const recovery =
    START_DESTINATION === undefined || START_DESTINATION.href === pathname
      ? undefined
      : START_DESTINATION;

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
        {...(recovery === undefined
          ? {}
          : {
              recovery: {
                href: recovery.href,
                label: t("goTo", {
                  destination: navigation(recovery.labelKey),
                }),
              },
            })}
        retryLabel={t("retry")}
        onRetry={retry}
      />
    </main>
  );
}
