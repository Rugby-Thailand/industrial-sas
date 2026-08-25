import { getTranslations, setRequestLocale } from "next-intl/server";

import { HandheldTaskLauncher } from "@/components/shell/HandheldTaskLauncher";
import { PageHeader } from "@/components/ui/PageHeader";
import { HANDHELD_TASKS } from "@/lib/navigation";

export default async function HandheldHomePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, panel] = await Promise.all([
    getTranslations("Handheld"),
    getTranslations("Panel"),
  ]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <HandheldTaskLauncher
        labels={{
          tasks: Object.fromEntries(
            HANDHELD_TASKS.map(({ labelKey }) => [labelKey, t(labelKey)]),
          ),
          unavailable: t("taskUnavailable"),
          unavailableTitle: t("notBuiltYet"),
          loading: panel("loadingHint"),
        }}
      />
    </>
  );
}
