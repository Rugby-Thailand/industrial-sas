"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { IconButton } from "./IconButton";
import { appHistoryIndex } from "@/lib/browser/appHistory";
import { guardedNavigate } from "@/lib/navigationGuard";

/** Returns to the previous page; a page opened directly falls back to its parent. */
export function PageBackButton({ fallbackHref }: { fallbackHref: string }) {
  const t = useTranslations("App");
  const router = useRouter();
  return (
    <IconButton
      variant="ghost"
      label={t("back")}
      className="-mr-1 -ml-3 shrink-0 text-muted hover:text-text"
      onClick={() => {
        if ((appHistoryIndex() ?? 0) > 0) router.back();
        else guardedNavigate(() => router.replace(fallbackHref));
      }}
    >
      <ArrowLeft aria-hidden="true" />
    </IconButton>
  );
}
