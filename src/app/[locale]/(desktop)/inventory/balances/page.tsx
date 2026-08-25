import { getTranslations, setRequestLocale } from "next-intl/server";

import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { BalancesPanel } from "@/features/inventory/BalancesPanel";

export default async function BalancesPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Inventory");

  return (
    <>
      <PageHeader
        title={t("balancesTitle")}
        description={t("balancesDescription")}
      />
      <div className="mb-4">
        <Notice tone="muted" title={t("readOnlyNotice")} />
      </div>
      <BalancesPanel />
    </>
  );
}
