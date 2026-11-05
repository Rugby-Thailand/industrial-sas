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
 * search. Retrying comes first; its module hub is the way out. The failure is
 * not classified, so the copy names no cause (a bad link, removed data).
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
  const hub =
    recovery === undefined
      ? undefined
      : { href: recovery.href, name: navigation(recovery.labelKey) };

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
      hint={
        hub === undefined
          ? t("pageHintRetry")
          : t("pageHint", { destination: hub.name })
      }
      {...(hub === undefined
        ? {}
        : {
            recovery: {
              href: hub.href,
              label: t("goTo", { destination: hub.name }),
            },
          })}
      retryLabel={t("retry")}
      onRetry={retry}
    />
  );
}
