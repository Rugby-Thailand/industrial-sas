import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { QualityWorkbench } from "@/features/inbound/QualityWorkbench";

/**
 * The inspection queue, and the decision that empties it.
 *
 * A disposition is a balanced ledger transition, never a status edit
 * (`ADR-0007` §6), and release and scrap need a second person. The screen says
 * both, because an inspector who does not know a release is parked reads the
 * parked state as a failure.
 */
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
