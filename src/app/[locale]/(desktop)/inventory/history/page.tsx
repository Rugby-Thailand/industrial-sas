import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { TransactionsPanel } from "@/features/inventory/TransactionsPanel";

export default async function HistoryPage({
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
        title={t("historyTitle")}
        description={t("historyDescription")}
      />
      <TransactionsPanel />
    </>
  );
}
