"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { useRouter } from "@/i18n/navigation";
import { IconButton } from "./IconButton";
import {
  appHistoryIndex,
  subscribeHistoryWrites,
} from "@/lib/browser/appHistory";
import { guardedNavigate } from "@/lib/navigationGuard";

function subscribeDepth(listener: () => void) {
  const release = subscribeHistoryWrites(listener);
  window.addEventListener("popstate", listener);
  return () => {
    release();
    window.removeEventListener("popstate", listener);
  };
}
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
  const hasHistory =
    useSyncExternalStore(subscribeDepth, currentDepth, serverDepth) > 0;
  if (!hasHistory && !pending && fallbackHref === null) return null;
  return (
    <IconButton
      variant="ghost"
      label={t("back")}
      className="-mr-1 -ml-3 shrink-0 text-muted hover:text-text"
      disabled={!hasHistory && pending}
      onClick={() => {
        if ((appHistoryIndex() ?? 0) > 0) router.back();
        else if (fallbackHref !== null && !pending)
          guardedNavigate(() => router.replace(fallbackHref));
      }}
    >
      <ArrowLeft aria-hidden="true" />
    </IconButton>
  );
}
