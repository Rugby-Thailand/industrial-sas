import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { ExportWorkbench } from "@/features/reporting/ExportWorkbench";
import { OperationalReportsWorkbench } from "@/features/reporting/OperationalReportsWorkbench";

/**
 * The export register.
 *
 * Its own route rather than a panel on the dashboard, because an export is a
 * task somebody comes to do — request, wait, take the file — while the dashboard
 * is a thing somebody glances at. Mixing them would put a form in the middle of
 * a screen whose value is being readable in three seconds.
 */
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
