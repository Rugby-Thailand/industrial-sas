import { getTranslations, setRequestLocale } from "next-intl/server";

import { SetupChecklist } from "@/components/system/SetupChecklist";
import { OccupancyMap } from "@/features/reporting/OccupancyMap";
import { OperationsTiles } from "@/features/reporting/OperationsTiles";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Link } from "@/i18n/navigation";
import { ROUTES } from "@/lib/navigation";

/**
 * The supervisor entry point.
 *
 * Two sections carry the plan's §2.1 dashboard: the waiting-work counters and
 * the occupancy map. Both are backed by maintained rollups rather than by
 * counting rows on demand (`ADR-0011` §6, `INV-0011-07`) — a dashboard is the
 * screen opened most often, so the read that backs it is the one that must not
 * grow with the data.
 *
 * A zero here is a real zero and says when it was last true. Earlier this page
 * showed no numbers at all, deliberately, because a tile with an invented zero
 * reads as "the warehouse is empty" rather than as "this is not built". The
 * counters exist now; the honesty rule did not change, which is why every tile
 * carries its own "as of" and marks itself when a correction made it suspect.
 *
 * Low stock and reconciliation health are still absent: the first needs a
 * per-item reorder policy that no table holds, and the second is the ledger
 * reconciliation job's own report rather than a tile.
 */
export default async function DashboardPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Dashboard");

  const entries = [
    { href: ROUTES.items, labelKey: "itemsCard" },
    { href: ROUTES.balances, labelKey: "balancesCard" },
    { href: ROUTES.history, labelKey: "historyCard" },
    { href: ROUTES.handheld, labelKey: "handheldCard" },
    { href: ROUTES.reports, labelKey: "reportsCard" },
  ] as const;

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      <section className="mb-8" aria-labelledby="tiles-heading">
        <h2 id="tiles-heading" className="mb-3 text-lg font-semibold text-text">
          {t("tilesHeading")}
        </h2>
        <OperationsTiles />
      </section>

      <section className="mb-8" aria-labelledby="occupancy-heading">
        <h2
          id="occupancy-heading"
          className="mb-3 text-lg font-semibold text-text"
        >
          {t("occupancyHeading")}
        </h2>
        <OccupancyMap />
      </section>

      <section className="mb-8" aria-labelledby="capability-heading">
        <h2
          id="capability-heading"
          className="mb-3 text-lg font-semibold text-text"
        >
          {t("capabilityHeading")}
        </h2>
        <Notice
          tone="neutral"
          title={t("capabilityHeading")}
          body={t("capabilityBody")}
        />
      </section>

      <section className="mb-8" aria-labelledby="entry-heading">
        <h2 id="entry-heading" className="mb-3 text-lg font-semibold text-text">
          {t("entryHeading")}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map((entry) => (
            <li key={entry.href}>
              <Link
                href={entry.href}
                className="flex min-h-touch items-center rounded-lg border border-border bg-surface p-4 text-sm font-medium text-text hover:border-accent"
              >
                {t(entry.labelKey)}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="system-heading">
        <h2
          id="system-heading"
          className="mb-3 text-lg font-semibold text-text"
        >
          {t("systemHeading")}
        </h2>
        <SetupChecklist />
      </section>
    </>
  );
}
