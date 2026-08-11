import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { TransactionsPanel } from "@/features/inventory/TransactionsPanel";

/**
 * The immutable transaction history for the selected warehouse.
 *
 * Backed by `inventory/ledger:listTransactions`, which is bounded and resumable
 * by construction: there is no unpaged variant on the server, because a tenant
 * accumulates around a million ledger lines a year (B-11).
 */
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
