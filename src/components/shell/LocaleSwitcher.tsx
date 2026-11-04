"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "@/i18n/navigation";
import { LOCALES, type AppLocale } from "@/i18n/routing";
import { guardedNavigate } from "@/lib/navigationGuard";

/** Each language by its own name, so a reader finds theirs in any locale. */
const LANGUAGE_NAMES: Readonly<Record<AppLocale, string>> = {
  th: "ไทย",
  en: "English",
};

/**
 * There are two languages, so one button switches to the other. It shows
 * that language's own name (marked with its `lang`) after a hidden
 * "switch language to" in the current one.
 */
export function LocaleSwitcher() {
  const t = useTranslations("Locale");
  const locale = useLocale() as AppLocale;
  const next = LOCALES.find((candidate) => candidate !== locale) ?? locale;
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const choose = () => {
    // The URL the user chose from; a guard prompt or its history buffer must
    // not change which query or hash the new language opens.
    const href = `${pathname}${window.location.search}${window.location.hash}`;
    guardedNavigate(() => {
      startTransition(() => {
        router.replace(href, { locale: next });
      });
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      pending={isPending}
      onClick={choose}
      data-testid="locale-select"
      className="shrink-0 px-3 font-medium text-muted hover:text-text"
    >
      <span className="sr-only">{t("switchTo")}</span>{" "}
      <span lang={next}>{LANGUAGE_NAMES[next]}</span>
    </Button>
  );
}
