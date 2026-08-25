import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { QualityWorkbench } from "@/features/inbound/QualityWorkbench";

export default async function QualityPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Quality");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <QualityWorkbench />
    </>
  );
}
