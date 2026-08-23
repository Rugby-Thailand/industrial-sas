import { getTranslations, setRequestLocale } from "next-intl/server";

import { HandheldTaskLauncher } from "@/components/shell/HandheldTaskLauncher";
import { PageHeader } from "@/components/ui/PageHeader";
import { HANDHELD_TASKS } from "@/lib/navigation";

/**
 * A task launcher rather than a small dashboard: an operator arriving at a
 * handheld is starting work, so every available destination begins a task.
 * Unbuilt tasks remain explicit to distinguish unavailable functionality from
 * a task that the signed-in operator is not permitted to perform.
 */
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
