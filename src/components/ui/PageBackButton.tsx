"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { useRouter } from "@/i18n/navigation";
import { resolvePageBackFallback } from "@/lib/pageBackFallback";
import { IconButton } from "./IconButton";
import {
  appHistoryIndex,
  subscribeHistoryChanges,
} from "@/lib/browser/appHistory";
import {
  BACK_AVAILABILITY_EVENT,
  hasBackWithinPage,
  navigateBack,
} from "@/lib/navigationGuard";

const currentDepth = () => appHistoryIndex() ?? 0;
const serverDepth = () => 0;

/**
 * Returns to the previous app page; a page opened directly falls back to
 * `fallbackHref`. With no fallback (`null`) a directly opened page shows no
 * Back. While the fallback is still being resolved (`pending`, e.g. access
 * loading) a directly opened page shows Back disabled rather than guessing.
 */
export function PageBackButton({
  fallbackHref,
  pending = false,
}: {
  fallbackHref: string | null;
  pending?: boolean;
}) {
  const t = useTranslations("App");
  const router = useRouter();
  const href = useSyncExternalStore(
    subscribeHistoryChanges,
    () =>
      window.location.pathname + window.location.search + window.location.hash,
    () => "",
  );
  const parent = resolvePageBackFallback(href, fallbackHref);
  const hasHistory =
    useSyncExternalStore(subscribeHistoryChanges, currentDepth, serverDepth) >
    0;
  const hasForeground = useSyncExternalStore(
    (listener) => {
      window.addEventListener(BACK_AVAILABILITY_EVENT, listener);
      return () =>
        window.removeEventListener(BACK_AVAILABILITY_EVENT, listener);
    },
    hasBackWithinPage,
    () => false,
  );
  if (!hasForeground && !hasHistory && !pending && fallbackHref === null)
    return null;
  return (
    <IconButton
      variant="ghost"
      label={t("back")}
      className="-mr-1 -ml-3 shrink-0 text-muted hover:text-text"
      disabled={!hasForeground && !hasHistory && (pending || parent === null)}
      onClick={() => {
        navigateBack(router, pending ? null : parent);
      }}
    >
      <ArrowLeft aria-hidden="true" />
    </IconButton>
  );
}
