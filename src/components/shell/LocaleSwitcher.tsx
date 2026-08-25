"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useTransition } from "react";

import { SelectControl } from "@/components/ui/SelectControl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { LOCALES, type AppLocale } from "@/i18n/routing";

export function LocaleSwitcher() {
  const t = useTranslations("Locale");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const controlId = useId();

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <label htmlFor={controlId} className="text-muted">
        {t("label")}
      </label>
      <SelectControl
        id={controlId}
        value={locale}
        pending={isPending}
        placeholder={t("label")}
        emptyLabel={t("label")}
        className="w-40"
        testId="locale-select"
        options={LOCALES.map((candidate) => ({
          value: candidate,
          label: t(candidate),
        }))}
        onValueChange={(next) => {
          startTransition(() => {
            router.replace(pathname, { locale: next as AppLocale });
          });
        }}
      />
    </span>
  );
}
