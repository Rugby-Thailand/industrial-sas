import { getTranslations, setRequestLocale } from "next-intl/server";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardQuickActions } from "@/features/reporting/DashboardQuickActions";
import { OccupancyMap } from "@/features/reporting/OccupancyMap";
import { OwnerAttentionList } from "@/features/reporting/OwnerAttentionList";
import { OwnerOperationsSummary } from "@/features/reporting/OwnerOperationsSummary";
import { OwnerPulse } from "@/features/reporting/OwnerPulse";

/**
 * The first owner dashboard release.
 *
 * The top of the page answers three owner questions: what needs attention,
 * where capacity is tightening, and where to act next. Values remain bounded
 * server reads; the UI deliberately does not invent revenue, trends, or targets
 * that the current model cannot prove. Team-level counters and the detailed
 * occupancy map remain available lower on the page for operational follow-up.
 */
export default async function DashboardPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("OwnerDashboard");

  return (
    <>
      <header className="mb-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold tracking-wide text-accent uppercase">
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-accent"
            />
            {t("eyebrow")}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-success"
            />
            {t("liveData")}
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">
          {t("title")}
        </h1>
      </header>

      <section className="mb-6" aria-label={t("quickActionsTitle")}>
        <DashboardQuickActions />
      </section>

      <section className="mb-6" aria-labelledby="owner-pulse-heading">
        <div className="mb-3">
          <h2
            id="owner-pulse-heading"
            className="text-lg font-semibold text-text"
          >
            {t("pulseTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("pulseHelp")}</p>
        </div>
        <OwnerPulse />
      </section>

      <div className="mb-8 grid items-start gap-4 xl:grid-cols-5">
        <Card className="min-w-0 shadow-sm xl:col-span-3 xl:col-start-1 xl:row-start-1">
          <section aria-labelledby="attention-heading">
            <CardHeader>
              <CardTitle>
                <h2 id="attention-heading">{t("attentionTitle")}</h2>
              </CardTitle>
              <CardDescription>{t("attentionHelp")}</CardDescription>
            </CardHeader>
            <CardContent>
              <OwnerAttentionList />
            </CardContent>
          </section>
        </Card>

        <Card className="min-w-0 shadow-sm xl:col-span-2 xl:col-start-4 xl:row-span-2 xl:row-start-1">
          <section aria-labelledby="capacity-heading">
            <CardHeader>
              <CardTitle>
                <h2 id="capacity-heading">{t("capacityTitle")}</h2>
              </CardTitle>
              <CardDescription>{t("capacityHelp")}</CardDescription>
            </CardHeader>
            <CardContent>
              <OccupancyMap />
            </CardContent>
          </section>
        </Card>
        <section
          className="min-w-0 xl:col-span-3 xl:col-start-1 xl:row-start-2"
          aria-label={t("volumeTitle")}
        >
          <OwnerOperationsSummary />
        </section>
      </div>
    </>
  );
}
