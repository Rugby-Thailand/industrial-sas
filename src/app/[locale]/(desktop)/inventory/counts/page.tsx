import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { CountPlanBuilder } from "@/features/counting/CountPlanBuilder";
import { ReconciliationQueue } from "@/features/counting/ReconciliationQueue";

export default async function CountPlansPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Count");
  return (
    <>
      <PageHeader title={t("planTitle")} description={t("planDescription")} />
      <CountPlanBuilder />
      <ReconciliationQueue />
    </>
  );
}
