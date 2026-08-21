import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowRight,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  FileText,
  History,
  PackageCheck,
  ScanLine,
  Smartphone,
} from "lucide-react";

import { SetupChecklist } from "@/components/system/SetupChecklist";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardScope } from "@/features/reporting/DashboardScope";
import { OccupancyMap } from "@/features/reporting/OccupancyMap";
import { OperationsTiles } from "@/features/reporting/OperationsTiles";
import { WarehouseForkliftAnimation } from "@/features/reporting/WarehouseForkliftAnimation";
import { Notice } from "@/components/ui/Notice";
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
  // The checklist itself no longer opens with this sentence, because the setup
  // page states it in its header and printing it twice on one screen is what the
  // audit found. The section that mounts the checklist here supplies it instead.
  const setupT = await getTranslations("Setup");

  const entries = [
    {
      href: ROUTES.receiving,
      labelKey: "receivingCard",
      icon: PackageCheck,
    },
    { href: ROUTES.quality, labelKey: "qualityCard", icon: ClipboardCheck },
    { href: ROUTES.putaway, labelKey: "putawayCard", icon: ScanLine },
    { href: ROUTES.items, labelKey: "itemsCard", icon: Boxes },
    { href: ROUTES.balances, labelKey: "balancesCard", icon: ClipboardList },
    { href: ROUTES.history, labelKey: "historyCard", icon: History },
    { href: ROUTES.handheld, labelKey: "handheldCard", icon: Smartphone },
    { href: ROUTES.reports, labelKey: "reportsCard", icon: FileText },
  ] as const;

  return (
    <>
      <header
        className="mb-8 overflow-hidden rounded-xl border border-border bg-surface"
        data-testid="warehouse-control-hero"
      >
        <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <div className="p-5 sm:p-7 lg:p-8">
            <p className="mb-2 text-xs font-semibold tracking-widest text-accent uppercase">
              {t("controlTowerEyebrow")}
            </p>
            <h1 className="max-w-2xl text-3xl leading-tight font-bold tracking-tight text-text sm:text-4xl">
              {t("title")}
            </h1>
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted">
              {t("description")}
            </p>
            <div className="mt-5">
              <DashboardScope />
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href={ROUTES.receiving}
                className="inline-flex min-h-touch items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                {t("heroStartAction")}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
              <Link
                href={ROUTES.reports}
                className="inline-flex min-h-touch items-center gap-2 rounded-md border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-text hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                {t("heroReportAction")}
              </Link>
            </div>
          </div>

          <div
            className="relative flex min-h-56 items-center justify-center overflow-hidden border-t border-border bg-raised/60 p-5 lg:min-h-full lg:border-t-0 lg:border-l"
            aria-hidden="true"
          >
            <div className="absolute top-4 right-4 rounded-md border border-border bg-surface px-2 py-1 font-mono text-[0.6875rem] text-muted">
              {t("heroAssetLabel")}
            </div>
            <WarehouseForkliftAnimation />
          </div>
        </div>
      </header>

      <section className="mb-8" aria-labelledby="tiles-heading">
        <div className="mb-3">
          <h2 id="tiles-heading" className="text-lg font-semibold text-text">
            {t("tilesHeading")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("tilesDescription")}</p>
        </div>
        <OperationsTiles />
      </section>

      <div className="mb-8 grid items-start gap-6 xl:grid-cols-2">
        <Card className="min-w-0">
          <section aria-labelledby="occupancy-heading">
            <CardHeader>
              <CardTitle>
                <h2 id="occupancy-heading">{t("occupancyHeading")}</h2>
              </CardTitle>
              <CardDescription>{t("occupancyDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <OccupancyMap />
            </CardContent>
          </section>
        </Card>

        <Card>
          <section aria-labelledby="entry-heading">
            <CardHeader>
              <CardTitle>
                <h2 id="entry-heading">{t("entryHeading")}</h2>
              </CardTitle>
              <CardDescription>{t("entryDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 sm:grid-cols-2">
                {entries.map(({ href, labelKey, icon: Icon }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="group flex min-h-touch items-center gap-3 rounded-lg border border-border bg-surface p-3 text-sm font-medium text-text hover:border-accent hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-raised text-accent">
                        <Icon aria-hidden="true" className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">{t(labelKey)}</span>
                      <ArrowRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted group-hover:text-accent"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </section>
        </Card>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <section aria-labelledby="capability-heading">
          <h2
            id="capability-heading"
            className="mb-3 text-lg font-semibold text-text"
          >
            {t("capabilityHeading")}
          </h2>
          <Notice
            tone="neutral"
            title={t("capabilityNoticeTitle")}
            body={t("capabilityBody")}
          />
        </section>

        <section aria-labelledby="system-heading">
          <h2
            id="system-heading"
            className="mb-3 text-lg font-semibold text-text"
          >
            {t("systemHeading")}
          </h2>
          <p className="mb-3 max-w-prose text-sm leading-relaxed text-muted">
            {setupT("intro")}
          </p>
          <SetupChecklist />
        </section>
      </div>
    </>
  );
}
