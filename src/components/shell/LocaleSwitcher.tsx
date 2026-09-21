"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useTransition } from "react";

import { SelectControl } from "@/components/ui/SelectControl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { LOCALES, type AppLocale } from "@/i18n/routing";

const LANGUAGE_FLAGS: Record<AppLocale, string> = { th: "🇹🇭", en: "🇬🇧" };

export function LocaleSwitcher() {
  const t = useTranslations("Locale");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const controlId = useId();

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <label htmlFor={controlId} className="sr-only">
        {t("label")}
      </label>
      <SelectControl
        id={controlId}
        value={locale}
        pending={isPending}
        placeholder={t("label")}
        emptyLabel={t("label")}
        size="compact"
        className="w-28 whitespace-nowrap"
        testId="locale-select"
        options={LOCALES.map((candidate) => ({
          value: candidate,
          label: `${LANGUAGE_FLAGS[candidate]} ${t(candidate)}`,
        }))}
        onValueChange={(next) => {
          startTransition(() => {
            router.replace(
              `${pathname}${window.location.search}${window.location.hash}`,
              {
                locale: next as AppLocale,
              },
            );
          });
        }}
      />
    </span>
  );
}
