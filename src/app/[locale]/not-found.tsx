import { getTranslations } from "next-intl/server";

import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { PageHeader } from "@/components/ui/PageHeader";
import { Link } from "@/i18n/navigation";
import { ROUTES } from "@/lib/navigation";

/**
 * An unknown address, rendered outside the signed-in shell: the product
 * wordmark keeps the app recognisable, and the one way out is the start
 * route. Who is signed in, and what they may open, is not known here, so the
 * action names the start page neutrally; the start route itself redirects
 * each member to a page they can open. The header's language button (it
 * needs no shell) opens the same address in the other language, for a
 * reader who followed a link in a language they do not read.
 */
export default async function LocaleNotFound() {
  const t = await getTranslations("NotFound");
  const app = await getTranslations("App");

  return (
    <div className="min-h-dvh bg-canvas text-text">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2 sm:px-6">
        <p className="text-base font-semibold" data-testid="not-found-brand">
          {app("name")}
        </p>
        <div className="flex items-center gap-1 sm:gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main
        data-testid="not-found"
        className="mx-auto max-w-xl px-6 pt-16 pb-8 sm:pt-[16vh]"
      >
        <PageHeader
          backFallbackHref={null}
          title={t("title")}
          summary={t("body")}
        />
        <Button asChild className="w-fit">
          <Link href={ROUTES.storageLayouts} data-testid="not-found-action">
            {t("action")}
          </Link>
        </Button>
      </main>
    </div>
  );
}
