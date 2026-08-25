import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { Link } from "@/i18n/navigation";
import { ROUTES } from "@/lib/navigation";

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
