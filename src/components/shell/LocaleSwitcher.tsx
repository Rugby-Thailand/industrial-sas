"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useTransition } from "react";

// eslint-disable-next-line no-restricted-imports -- SelectControl cannot render the flag-only current value; this reuses the shared Select primitives unchanged
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePathname, useRouter } from "@/i18n/navigation";
import { LOCALES, type AppLocale } from "@/i18n/routing";
import { guardedNavigate } from "@/lib/navigationGuard";

const LANGUAGE_FLAGS: Record<AppLocale, string> = { th: "🇹🇭", en: "🇬🇧" };

/** Flag-only language control; full language names remain in the menu. */
export function LocaleSwitcher() {
  const t = useTranslations("Locale");
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const controlId = useId();
  const labelId = `${controlId}-label`;
  const currentId = `${controlId}-current`;

  const choose = (next: string) => {
    if (next === locale) return;
    // The URL the user chose from; a guard prompt or its history buffer must
    // not change which query or hash the new language opens.
    const href = `${pathname}${window.location.search}${window.location.hash}`;
    guardedNavigate(() => {
      startTransition(() => {
        router.replace(href, { locale: next as AppLocale });
      });
    });
  };

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <label id={labelId} htmlFor={controlId} className="sr-only">
        {t("label")}
      </label>
      <Select value={locale} onValueChange={choose} disabled={isPending}>
        <SelectTrigger
          id={controlId}
          aria-busy={isPending ? true : undefined}
          data-testid="locale-select"
          aria-labelledby={`${labelId} ${currentId}`}
          className="w-touch justify-center border-transparent bg-transparent p-0 text-xl hover:bg-raised dense:w-control dense:p-0 [&>svg]:hidden"
        >
          <SelectValue>
            <span aria-hidden="true">{LANGUAGE_FLAGS[locale]}</span>
            <span id={currentId} className="sr-only">
              {t(locale)}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {LOCALES.map((candidate) => (
            <SelectItem
              key={candidate}
              value={candidate}
              data-value={candidate}
            >
              {t(candidate)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  );
}
