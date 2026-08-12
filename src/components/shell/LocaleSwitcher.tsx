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
 * Two languages, so this stays a Select rather than becoming an autocomplete —
 * a search field over two options is a worse control than a list of two. The
 * choice was a native `<select>` until the shared Radix Select existed, on the
 * grounds that it needed no focus management to be correct; that argument held
 * for the keyboard and failed for the colour scheme, because a native popup is
 * painted by the operating system and stayed white on a dark screen.
 *
 * The control disables itself while the route transition is in flight. That is
 * `pending`, not `disabled`: the shared Select marks it `aria-busy`, so the
 * reason it cannot be used is available to a screen reader and not only to
 * whoever can see it greyed.
 */
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
