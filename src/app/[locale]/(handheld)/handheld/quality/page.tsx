import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { QualityWorkbench } from "@/features/inbound/QualityWorkbench";

/**
 * Quality control on a scanner.
 *
 * The same workbench as the supervisor screen. An inspection is a short decision
 * with a reason attached, and it does not need a different flow on a smaller
 * viewport — only larger targets, which the shell provides.
 */
export default async function HandheldQualityPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Quality");

  return (
    <>
      <PageHeader
        title={t("handheldTitle")}
        description={t("handheldDescription")}
      />
      <QualityWorkbench />
    </>
  );
}
