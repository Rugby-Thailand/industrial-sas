"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { useObservability } from "@/components/providers/ObservabilityProvider";
import { PageFailure } from "@/components/shell/PageFailure";
import { recoveryDestination } from "@/components/shell/pageRecovery";
import { usePathname } from "@/i18n/navigation";
import { applicationRenderErrorEvent } from "@/lib/observability/applicationError";

/**
 * A page that fails inside the app shell keeps the sidebar, header and
 * search, and offers its module hub before a retry.
 */
export default function DesktopPageError({
  error,
  retry,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly retry: () => void;
}) {
  const t = useTranslations("Error");
  const navigation = useTranslations("Navigation");
  const observability = useObservability();
  const recovery = recoveryDestination(usePathname());

  useEffect(() => {
    // `error` is intentionally a dependency but never part of the event: a new
    // caught error is a new occurrence, while its text and stack are tenant data.
    void error;
    observability.record(applicationRenderErrorEvent("locale", Date.now()));
  }, [error, observability]);

  return (
    <PageFailure
      title={t("pageTitle")}
      cause={t("pageCause")}
      hint={t("pageHint")}
      {...(recovery === undefined
        ? {}
        : {
            recovery: {
              href: recovery.href,
              label: t("goTo", { destination: navigation(recovery.labelKey) }),
            },
          })}
      retryLabel={t("retry")}
      onRetry={retry}
    />
  );
}
