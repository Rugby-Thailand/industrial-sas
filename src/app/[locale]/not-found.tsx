import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Link } from "@/i18n/navigation";
import { ROUTES } from "@/lib/navigation";

export default async function LocaleNotFound() {
  const t = await getTranslations("NotFound");
  const navigation = await getTranslations("Navigation");
  // The reviewed safe start page; the copy names it rather than a "home".
  const destination = navigation("storageLayouts");

  return (
    <main
      data-testid="not-found"
      className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-2 p-6"
    >
      <PageHeader
        backFallbackHref={null}
        title={t("title")}
        summary={t("body", { destination })}
      />
      <Button asChild className="w-fit">
        <Link href={ROUTES.storageLayouts} data-testid="not-found-action">
          {t("action", { destination })}
        </Link>
      </Button>
    </main>
  );
}
