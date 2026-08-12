import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { Link } from "@/i18n/navigation";
import { ROUTES } from "@/lib/navigation";

/**
 * The 404 inside a resolved locale.
 *
 * Localized, because a Thai operator who mistypes a URL should not be handed an
 * English error page. It offers the way back rather than only stating the
 * problem: a dead end on a handheld means restarting the browser.
 *
 * What reaches this file matters as much as what it renders. A URL that matches
 * no route at all is not a `notFound()` inside the locale segment, so it would
 * be answered by Next's own 404 above every layout here — no stylesheet, no
 * `lang`, no link. `[locale]/[...rest]/page.tsx` is what turns that miss into
 * this screen.
 */
export default async function LocaleNotFound() {
  const t = await getTranslations("NotFound");

  return (
    <main
      data-testid="not-found"
      className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6"
    >
      <PageHeader title={t("title")} description={t("body")} />
      <Link
        href={ROUTES.dashboard}
        className="flex min-h-touch w-fit items-center rounded-md border border-border-strong px-4 font-medium text-text"
      >
        {t("backHome")}
      </Link>
    </main>
  );
}
