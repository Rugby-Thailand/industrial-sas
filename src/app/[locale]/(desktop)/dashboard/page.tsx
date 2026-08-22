import { getTranslations, setRequestLocale } from "next-intl/server";

import { DashboardScope } from "@/features/reporting/DashboardScope";
import { DashboardQuickActions } from "@/features/reporting/DashboardQuickActions";
import { OccupancyMap } from "@/features/reporting/OccupancyMap";
import { OperationsTiles } from "@/features/reporting/OperationsTiles";
import { PageHeader } from "@/components/ui/PageHeader";

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
 *
 * ### The order of the sections
 *
 * Operations first, system last. The sequence follows the ReUI application
 * dashboard's hierarchy — scope, counters, capacity, work queue, notices — for
 * one reason that survives being restated without the reference: a supervisor
 * opens this page to find out what is waiting, and the deployment's setup state
 * is something they check once a quarter. Putting the checklist above the work
 * queue costs a scroll on every visit to save one on almost none.
 *
 * There is no revenue, growth, or trend section, and there will not be one from
 * this data. Every figure here is a maintained counter or a count of drawn
 * locations; a sparkline over a rollup that has no history would be a shape
 * invented to fill a card.
 */
export default async function DashboardPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Dashboard");
  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageHeader title={t("title")} description={t("description")} />
        <DashboardScope />
      </div>

      <section className="mb-6" aria-labelledby="tiles-heading">
        <h2 id="tiles-heading" className="mb-3 text-lg font-semibold text-text">
          {t("tilesHeading")}
        </h2>
        <OperationsTiles />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(20rem,1fr)]">
        <section aria-labelledby="occupancy-heading">
          <h2
            id="occupancy-heading"
            className="mb-3 text-lg font-semibold text-text"
          >
            {t("occupancyHeading")}
          </h2>
          <OccupancyMap />
        </section>

        <section aria-labelledby="entry-heading">
          <h2
            id="entry-heading"
            className="mb-3 text-lg font-semibold text-text"
          >
            {t("entryHeading")}
          </h2>
          <DashboardQuickActions />
        </section>
      </div>
    </>
  );
}
