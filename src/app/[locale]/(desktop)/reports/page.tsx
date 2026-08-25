import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { ExportWorkbench } from "@/features/reporting/ExportWorkbench";
import { OperationalReportsWorkbench } from "@/features/reporting/OperationalReportsWorkbench";

export default async function ReportsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Reports");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="space-y-8">
        <OperationalReportsWorkbench />
        <ExportWorkbench />
      </div>
    </>
  );
}
