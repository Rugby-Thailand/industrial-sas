import { getTranslations, setRequestLocale } from "next-intl/server";

import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { BalancesPanel } from "@/features/inventory/BalancesPanel";

/**
 * Current balances for the selected warehouse.
 *
 * Backed by `inventory/ledger:listBalances` — the only way to see a balance, and
 * a read with no companion that writes one (`INV-0003-11`). The read-only notice
 * is on the page rather than in a tooltip because "corrections are reversals, not
 * edits" is a rule an operator has to know before they go looking for an edit
 * button.
 */
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
