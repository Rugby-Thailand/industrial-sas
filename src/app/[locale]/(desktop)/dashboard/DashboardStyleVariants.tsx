import { CircleDotDashed, MapPinned, RadioTower } from "lucide-react";
import { getTranslations } from "next-intl/server";

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
import { OwnerPressureRadar } from "@/features/reporting/OwnerPressureRadar";
import { OwnerPulse } from "@/features/reporting/OwnerPulse";

// Three dashboard directions, switchable through ?variant=, on the existing route.
export const DASHBOARD_STYLE_IDS = ["a", "b", "c"] as const;

export type DashboardStyleId = (typeof DASHBOARD_STYLE_IDS)[number];

export function resolveDashboardStyle(
  value: string | readonly string[] | undefined,
): DashboardStyleId {
  const candidate = Array.isArray(value) ? value[0] : value;
  return DASHBOARD_STYLE_IDS.includes(candidate as DashboardStyleId)
    ? (candidate as DashboardStyleId)
    : "a";
}

function LiveBadge({ label }: { readonly label: string }) {
  return (
    <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-success/60 bg-success-surface px-3 text-xs font-semibold text-success">
      <span aria-hidden="true" className="size-2 rounded-full bg-success" />
      {label}
    </span>
  );
}

function Eyebrow({ label }: { readonly label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-accent uppercase">
      <span aria-hidden="true" className="h-px w-7 bg-accent" />
      {label}
    </span>
  );
}

export async function ExecutiveBriefDashboard() {
  const t = await getTranslations("OwnerDashboard");

  return (
    <div
      className="mx-auto max-w-[100rem]"
      data-testid="dashboard-style-a"
      data-dashboard-style="executive-brief"
    >
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <Eyebrow label={t("eyebrow")} />
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-text sm:text-4xl">
            {t("title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            {t("pulseHelp")}
          </p>
        </div>
        <LiveBadge label={t("liveData")} />
      </header>

      <section className="mb-7" aria-labelledby="style-a-pulse-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2
            id="style-a-pulse-heading"
            className="text-lg font-semibold text-text"
          >
            {t("pulseTitle")}
          </h2>
          <span className="hidden text-xs font-medium tracking-wide text-muted uppercase sm:inline">
            {t("prototype.styleAContext")}
          </span>
        </div>
        <OwnerPulse />
      </section>

      <div className="mb-7 grid items-start gap-4 xl:grid-cols-12">
        <Card className="min-w-0 border-l-4 border-l-warning shadow-sm xl:col-span-5">
          <section aria-labelledby="style-a-attention-heading">
            <CardHeader>
              <CardTitle>
                <h2 id="style-a-attention-heading">{t("attentionTitle")}</h2>
              </CardTitle>
              <CardDescription>{t("attentionHelp")}</CardDescription>
            </CardHeader>
            <CardContent>
              <OwnerAttentionList />
            </CardContent>
          </section>
        </Card>

        <section
          className="min-w-0 xl:col-span-3"
          aria-label={t("pressure.title")}
        >
          <OwnerPressureRadar />
        </section>

        <Card className="min-w-0 shadow-sm xl:col-span-4">
          <section aria-labelledby="style-a-capacity-heading">
            <CardHeader>
              <CardTitle>
                <h2 id="style-a-capacity-heading">{t("capacityTitle")}</h2>
              </CardTitle>
              <CardDescription>{t("capacityHelp")}</CardDescription>
            </CardHeader>
            <CardContent>
              <OccupancyMap />
            </CardContent>
          </section>
        </Card>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-5">
        <section
          className="min-w-0 xl:col-span-3"
          aria-label={t("quickActionsTitle")}
        >
          <DashboardQuickActions layout="compact" />
        </section>
        <section
          className="min-w-0 xl:col-span-2"
          aria-label={t("volumeTitle")}
        >
          <OwnerOperationsSummary />
        </section>
      </div>
    </div>
  );
}

export async function ActionQueueDashboard() {
  const t = await getTranslations("OwnerDashboard");

  return (
    <div
      className="mx-auto max-w-[100rem]"
      data-testid="dashboard-style-b"
      data-dashboard-style="action-queue"
    >
      <header className="relative mb-4 overflow-hidden rounded-2xl border border-border bg-surface px-5 py-6 shadow-sm sm:px-7">
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1.5 bg-warning"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-warning">
              <RadioTower aria-hidden="true" className="size-5" />
              <span className="text-xs font-bold tracking-[0.18em] uppercase">
                {t("prototype.styleBContext")}
              </span>
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-text sm:text-4xl">
              {t("attentionTitle")}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {t("attentionHelp")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border bg-raised px-3 py-2 text-xs font-semibold text-text">
              {t("title")}
            </span>
            <LiveBadge label={t("liveData")} />
          </div>
        </div>
      </header>

      <section className="mb-4" aria-label={t("pulseTitle")}>
        <OwnerPulse />
      </section>

      <div className="mb-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(19rem,0.8fr)]">
        <Card className="min-w-0 border-warning/40 shadow-sm">
          <section aria-labelledby="style-b-attention-heading">
            <CardHeader className="border-b border-warning/60 bg-warning-surface">
              <CardTitle className="flex items-center gap-2">
                <CircleDotDashed
                  aria-hidden="true"
                  className="size-5 text-warning"
                />
                <h2 id="style-b-attention-heading">
                  {t("prototype.reviewQueue")}
                </h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <OwnerAttentionList />
            </CardContent>
          </section>
        </Card>

        <aside className="min-w-0 xl:sticky xl:top-4">
          <DashboardQuickActions layout="rail" />
        </aside>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <Card className="min-w-0 shadow-sm">
          <section aria-labelledby="style-b-capacity-heading">
            <CardHeader>
              <CardTitle>
                <h2 id="style-b-capacity-heading">{t("capacityTitle")}</h2>
              </CardTitle>
              <CardDescription>{t("capacityHelp")}</CardDescription>
            </CardHeader>
            <CardContent>
              <OccupancyMap />
            </CardContent>
          </section>
        </Card>
        <div className="grid min-w-0 gap-4">
          <section aria-label={t("pressure.title")}>
            <OwnerPressureRadar />
          </section>
          <section aria-label={t("volumeTitle")}>
            <OwnerOperationsSummary />
          </section>
        </div>
      </div>
    </div>
  );
}

export async function SpatialCommandDashboard() {
  const t = await getTranslations("OwnerDashboard");

  return (
    <div
      className="mx-auto max-w-[105rem] rounded-2xl border border-border bg-raised p-3 sm:p-4"
      data-testid="dashboard-style-c"
      data-dashboard-style="spatial-command"
    >
      <header className="mb-3 grid gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-accent-contrast shadow-sm">
            <MapPinned aria-hidden="true" className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-xs font-bold tracking-[0.16em] text-accent uppercase">
              {t("prototype.styleCContext")}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-text sm:text-3xl">
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-muted">{t("pulseHelp")}</p>
          </div>
        </div>
        <div className="flex items-center lg:justify-end">
          <LiveBadge label={t("liveData")} />
        </div>
      </header>

      <section className="mb-3" aria-label={t("quickActionsTitle")}>
        <DashboardQuickActions layout="compact" />
      </section>

      <div className="mb-3 grid items-start gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(25rem,0.55fr)]">
        <Card className="min-w-0 shadow-sm">
          <section aria-labelledby="style-c-capacity-heading">
            <CardHeader className="border-b border-border">
              <CardTitle>
                <h2 id="style-c-capacity-heading">{t("capacityTitle")}</h2>
              </CardTitle>
              <CardDescription>{t("capacityHelp")}</CardDescription>
            </CardHeader>
            <CardContent>
              <OccupancyMap />
            </CardContent>
          </section>
        </Card>

        <div className="grid min-w-0 gap-3">
          <section aria-labelledby="style-c-pulse-heading">
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
              <h2
                id="style-c-pulse-heading"
                className="font-mono text-xs font-bold tracking-[0.14em] text-muted uppercase"
              >
                {t("pulseTitle")}
              </h2>
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
            </div>
            <OwnerPulse layout="compact" />
          </section>
          <section aria-label={t("volumeTitle")}>
            <OwnerOperationsSummary />
          </section>
          <section aria-label={t("pressure.title")}>
            <OwnerPressureRadar />
          </section>
        </div>
      </div>

      <Card className="min-w-0 border-l-4 border-l-warning shadow-sm">
        <section aria-labelledby="style-c-attention-heading">
          <CardHeader className="border-b border-border sm:grid-cols-[1fr_auto]">
            <div>
              <CardTitle>
                <h2 id="style-c-attention-heading">{t("attentionTitle")}</h2>
              </CardTitle>
              <CardDescription className="mt-1">
                {t("attentionHelp")}
              </CardDescription>
            </div>
            <span className="hidden self-center font-mono text-xs font-semibold text-warning uppercase sm:inline">
              {t("prototype.reviewQueue")}
            </span>
          </CardHeader>
          <CardContent>
            <OwnerAttentionList />
          </CardContent>
        </section>
      </Card>
    </div>
  );
}
