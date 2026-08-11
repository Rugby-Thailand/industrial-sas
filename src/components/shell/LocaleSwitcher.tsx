"use client";

/**
 * Switching between Thai and English without losing the page.
 *
 * `usePathname` from `@/i18n/navigation` returns the path *without* its locale
 * segment, so `router.replace(pathname, { locale })` lands on the same screen in
 * the other language. Replacing rather than pushing keeps the back button
 * meaning "the previous screen" rather than "the same screen in the other
 * language", which is what an operator expects after an accidental tap.
 *
 * `next-intl` persists the choice in its own cookie, which is the "user
 * preference" half of `INV-0010-05`: the next visit to `/` resolves to the
 * language chosen here rather than re-negotiating `Accept-Language`.
 *
 * A native `<select>`, not a custom menu: it is keyboard- and HID-operable
 * everywhere without a focus trap to get wrong (`INV-0010-08`), and Android
 * Chrome renders it as a full-screen list with rows already larger than the
 * 48-pixel minimum.
 */
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { usePathname, useRouter } from "@/i18n/navigation";
import { LOCALES, type AppLocale } from "@/i18n/routing";

export function LocaleSwitcher() {
  const t = useTranslations("Locale");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-muted">{t("label")}</span>
      <select
        className="min-h-touch rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text"
        value={locale}
        disabled={isPending}
        onChange={(event) => {
          const next = event.target.value as AppLocale;
          startTransition(() => {
            router.replace(pathname, { locale: next });
          });
        }}
      >
        {LOCALES.map((candidate) => (
          <option key={candidate} value={candidate}>
            {t(candidate)}
          </option>
        ))}
      </select>
    </label>
  );
}
