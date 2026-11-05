"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { useObservability } from "@/components/providers/ObservabilityProvider";
import { PageFailure } from "@/components/shell/PageFailure";
import { pageRecovery } from "@/components/shell/pageRecovery";
import { useVisibleNavigation } from "@/components/shell/useVisibleNavigation";
import { usePathname } from "@/i18n/navigation";
import { applicationRenderErrorEvent } from "@/lib/observability/applicationError";

/**
 * A page that fails inside the app shell keeps the sidebar, header and
 * search, and its place under the module page above it. Retrying comes
 * first; the way out is chosen from the member's own menu, so it never names
 * a page that would send them back here. The failure is not classified, so
 * the copy names no cause (a bad link, removed data).
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
  const { sections, settled } = useVisibleNavigation();
  const recovery = pageRecovery(
    usePathname(),
    sections.flatMap((section) => section.items),
    settled,
  );
  const destination =
    recovery === undefined
      ? undefined
      : recovery.kind === "NEUTRAL"
        ? { href: recovery.href, label: t("goToStart") }
        : {
            href: recovery.item.href,
            label: t("goTo", {
              destination: navigation(recovery.item.labelKey),
            }),
          };

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
      {...(recovery?.kind === "HUB"
        ? {
            breadcrumbs: [
              {
                href: recovery.item.href,
                label: navigation(recovery.item.labelKey),
              },
            ],
          }
        : {})}
      {...(destination === undefined ? {} : { recovery: destination })}
      retryLabel={t("retry")}
      onRetry={retry}
    />
  );
}
