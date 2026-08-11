import { getTranslations, setRequestLocale } from "next-intl/server";

import { SetupChecklist } from "@/components/system/SetupChecklist";
import { PageHeader } from "@/components/ui/PageHeader";

/** The configuration state of this machine, in one place. */
export default async function SetupPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Setup");

  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />
      <SetupChecklist />
    </>
  );
}
