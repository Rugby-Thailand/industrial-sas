import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { PutawayWorkbench } from "@/features/inbound/PutawayWorkbench";

/**
 * The putaway board, with the reasoning behind every recommendation.
 *
 * `ADR-0007` §13 requires the recommendation to be explainable to an operator or
 * an auditor, so the score components and the filtered-out locations are on the
 * screen rather than in a log.
 */
export default async function PutawayPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Putaway");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <PutawayWorkbench />
    </>
  );
}
