"use client";

import { useQuery } from "convex/react";
import { CalendarDays, Download } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { OutcomeGate } from "@/components/system/DataGate";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Link } from "@/i18n/navigation";
import { hrRefs } from "@/lib/convex/hrApi";
import type { RefValue } from "@/lib/convex/clientRef";
import { HR_CODES, ROUTES } from "@/lib/navigation";

import { formatBusinessDate } from "./format";
import { HrGate, HrInlineError, useHrBack } from "./HrShared";
import { HrToolbar } from "./HrUi";
import { downloadHolidayCsv, holidayCsv } from "./selfService";

export function HrHolidaysScreen() {
  const t = useTranslations("Hr.holidays");
  const back = useHrBack();
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} {...back} />
      <HrGate code={HR_CODES.self}>
        <HolidaysContent />
      </HrGate>
    </>
  );
}

function HolidaysContent() {
  const t = useTranslations("Hr.holidays");
  const access = useHrAccess();
  const locale = useLocale();
  const yearOffset = locale === "th" ? 543 : 0;
  const currentYear = Number((access.today ?? "").slice(0, 4));
  const [year, setYear] = useState(String(currentYear + yearOffset));
  const valid =
    /^\d{4}$/.test(year) &&
    Number(year) - yearOffset >= 1900 &&
    Number(year) - yearOffset <= 2200;
  const outcome = useQuery(
    hrRefs.holidays,
    valid ? { year: Number(year) - yearOffset } : "skip",
  );
  const id = useId();
  return (
    <div className="space-y-group">
      <HrToolbar>
        <FormField id={id} label={t("year")}>
          {(field) => (
            <Input
              {...field}
              type="number"
              inputMode="numeric"
              min={1900 + yearOffset}
              max={2200 + yearOffset}
              value={year}
              onChange={(event) => setYear(event.target.value)}
              className="sm:w-32"
            />
          )}
        </FormField>
        <Button
          variant="outline"
          onClick={() => setYear(String(currentYear + yearOffset))}
        >
          {t("currentYear")}
        </Button>
      </HrToolbar>
      {valid ? (
        <OutcomeGate outcome={outcome}>
          {({ value }) => <HolidayList result={value} />}
        </OutcomeGate>
      ) : (
        <p role="alert" className="text-sm text-danger">
          {t("invalidYear")}
        </p>
      )}
    </div>
  );
}

function HolidayList({
  result,
}: {
  readonly result: RefValue<typeof hrRefs.holidays>;
}) {
  const t = useTranslations("Hr.holidays");
  const locale = useLocale();
  if (!result.ok) return <HrInlineError code={result.code} />;
  const site = result.employee.site?.name ?? "—";
  const groups = new Map<string, typeof result.holidays>();
  for (const holiday of result.holidays) {
    const month = holiday.date.slice(0, 7);
    groups.set(month, [...(groups.get(month) ?? []), holiday]);
  }
  const download = () =>
    downloadHolidayCsv(
      `holidays-${result.year}.csv`,
      holidayCsv(
        [t("csvDate"), t("csvName"), t("csvSite")],
        site,
        result.holidays,
      ),
    );
  return (
    <div className="space-y-group">
      <SectionHeader
        title={t("site", { site })}
        description={t("count", { count: result.holidays.length })}
        actions={
          <Button
            variant="outline"
            onClick={download}
            disabled={!result.complete || result.holidays.length === 0}
          >
            <Download aria-hidden="true" />
            {t("download")}
          </Button>
        }
      />
      {result.holidays.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title={t("empty")}
          body={t("emptyHint")}
        />
      ) : (
        [...groups].map(([month, holidays]) => (
          <Panel key={month} className="space-y-section">
            <SectionHeader
              title={formatBusinessDate(`${month}-01`, locale, {
                monthOnly: true,
              })}
            />
            <ul className="divide-y divide-border">
              {holidays.map((holiday) => (
                <li
                  key={holiday.id}
                  className="flex min-h-touch flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="font-medium text-text">{holiday.name}</p>
                    <time
                      dateTime={holiday.date}
                      className="text-sm text-muted"
                    >
                      {formatBusinessDate(holiday.date, locale, {
                        weekday: true,
                      })}
                    </time>
                  </div>
                  {result.nextHoliday?.id === holiday.id ? (
                    <StatusBadge tone="accent" label={t("next")} />
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
        ))
      )}
    </div>
  );
}

/** The home reuses the same site-scoped annual query and crosses the year boundary. */
export function HrUpcomingHoliday({ today }: { readonly today: string }) {
  const t = useTranslations("Hr.holidays");
  const locale = useLocale();
  const year = Number(today.slice(0, 4));
  const outcome = useQuery(hrRefs.holidays, { year });
  const current =
    outcome?.ok && outcome.value.ok && "holidays" in outcome.value
      ? outcome.value
      : null;
  const nextOutcome = useQuery(
    hrRefs.holidays,
    current?.nextHoliday === null && year < 2200 ? { year: year + 1 } : "skip",
  );
  const next =
    current?.nextHoliday ??
    (nextOutcome?.ok && nextOutcome.value.ok && "holidays" in nextOutcome.value
      ? nextOutcome.value.nextHoliday
      : null);
  if (!current) return null;
  if (
    current.nextHoliday === null &&
    year < 2200 &&
    !(
      nextOutcome?.ok &&
      nextOutcome.value.ok &&
      "holidays" in nextOutcome.value
    )
  )
    return null;
  return (
    <Panel className="space-y-3" aria-label={t("next")}>
      <SectionHeader title={t("next")} />
      <p className="font-semibold text-text">{next?.name ?? t("noUpcoming")}</p>
      {next ? (
        <p className="text-sm text-muted">
          {formatBusinessDate(next.date, locale, { weekday: true })}
        </p>
      ) : null}
      <Link
        href={ROUTES.hrHolidays}
        className="inline-flex min-h-touch items-center text-sm font-medium text-link underline-offset-4 focus-ring hover:underline"
      >
        {t("viewAll")}
      </Link>
    </Panel>
  );
}
