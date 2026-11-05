"use client";

import { useEffect } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { useObservability } from "@/components/providers/ObservabilityProvider";
import { FailureReference } from "@/components/shell/FailureReference";
import { PageFailure } from "@/components/shell/PageFailure";
import { pageRecovery } from "@/components/shell/pageRecovery";
import { useVisibleNavigation } from "@/components/shell/useVisibleNavigation";
import { usePathname } from "@/i18n/navigation";
import { activeNavigationHref } from "@/lib/navigation";
import {
  applicationRenderErrorEvent,
  renderFailureOccurrence,
} from "@/lib/observability/applicationError";

/**
 * A page that fails inside the app shell keeps the sidebar, header and
 * search, and its place under the module page above it. Retrying comes
 * first; the way out is chosen from the member's own menu, so it never names
 * a page that would send them back here. The failure is not classified, so
 * the copy names no cause (a bad link, removed data). A short reference, the
 * page and the time give the member something to quote; the recorded event
 * carries the same reference and the route pattern, never the error itself.
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
  const format = useFormatter();
  const locale = useLocale();
  const pathname = usePathname();
  const observability = useObservability();
  const { sections, settled } = useVisibleNavigation();
  const visible = sections.flatMap((section) => section.items);
  const recovery = pageRecovery(pathname, visible, settled);
  const occurrence = renderFailureOccurrence(error);
  // The page by the name of its row in the menu (the hub for a detail page),
  // as the sidebar highlights it; the copied line adds the full address.
  const activeHref = activeNavigationHref(
    pathname,
    visible.map((item) => item.href),
  );
  const current = visible.find((item) => item.href === activeHref);
  const page = current === undefined ? pathname : navigation(current.labelKey);
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
    // One event per caught error (its occurrence), never the error's text or
    // stack, which are tenant data; the route is reduced to its pattern.
    observability.record(
      applicationRenderErrorEvent("locale", occurrence.occurredAt, {
        reference: occurrence.reference,
        route: `/${locale}${pathname}`,
      }),
    );
  }, [locale, observability, occurrence, pathname]);

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
      reference={
        <FailureReference
          reference={occurrence.reference}
          page={page}
          address={pathname}
          time={format.dateTime(occurrence.occurredAt, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        />
      }
    />
  );
}
