import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { BalancesPanel } from "@/features/inventory/BalancesPanel";

/**
 * Stock lookup on a handheld.
 *
 * The same `listBalances` read and the same table as the supervisor screen — one
 * server function, one formatter, one status vocabulary (UX plan §1). What
 * differs is the shell around it: no sidebar, larger body text, and a viewport
 * where the table scrolls horizontally rather than shrinking its columns, because
 * a truncated lot code is worse than a swipe.
 *
 * Scan-to-resolve is not here yet. It needs `ScannerPort` and the identifier
 * resolution flow, and an input box that looked like a scan target but only
 * filtered a page of balances would teach an operator the wrong thing about how
 * this application works.
 */
export default async function HandheldInventoryPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Handheld");

  return (
    <>
      <PageHeader
        title={t("lookupTitle")}
        description={t("lookupDescription")}
      />
      <BalancesPanel />
    </>
  );
}
