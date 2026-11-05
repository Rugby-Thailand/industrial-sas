import { getTranslations } from "next-intl/server";

import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { Button } from "@/components/ui/button";
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
    <main
      data-testid="not-found"
      className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-2 p-6"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <p
          className="text-base font-semibold text-text"
          data-testid="not-found-brand"
        >
          {app("name")}
        </p>
        {/* Its label, not its padding, lines up with the text below. */}
        <div className="-mr-3">
          <LocaleSwitcher />
        </div>
      </div>
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
  );
}
