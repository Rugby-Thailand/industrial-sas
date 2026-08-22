import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { HrWorkspace } from "@/features/hr/HrWorkspace";

export default async function HrPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("HR");
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <HrWorkspace />
    </>
  );
}
