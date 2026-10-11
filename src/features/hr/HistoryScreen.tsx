"use client";

import { useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableScroller } from "@/components/ui/TableScroller";
import { Link } from "@/i18n/navigation";
import type { RefValue } from "@/lib/convex/clientRef";
import { hrRefs } from "@/lib/convex/hrApi";
import { HR_CODES, hrDayPath } from "@/lib/navigation";

import { addDays, formatBusinessDate } from "./format";
import {
  CorrectionBadge,
  DayStatusBadge,
  Duration,
  HrGate,
  HrInlineError,
  HrQueryState,
  PlanText,
  TimeText,
} from "./HrShared";
import { HrToolbar } from "./HrUi";

export function HrHistoryScreen() {
  const t = useTranslations("Hr.history");
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} showBack={false} />
      <HrGate code={HR_CODES.self}>
        <HistoryContent />
      </HrGate>
    </>
  );
}

/** A bounded inclusive date range, at most 31 days, chosen by the user. */
export function DateRangeFields({
  from,
  to,
  onChange,
  max,
}: {
  readonly from: string;
  readonly to: string;
  readonly onChange: (range: { from: string; to: string }) => void;
  readonly max?: string;
}) {
  const t = useTranslations("Hr.range");
  const id = useId();
  return (
    <fieldset className="grid w-full grid-cols-2 gap-x-3 gap-y-1 sm:w-auto sm:grid-cols-[11rem_11rem]">
      <legend className="sr-only">{t("legend")}</legend>
      <div className="min-w-0">
        <FormField id={`${id}-from`} label={t("from")}>
          {(field) => (
            <Input
              {...field}
              type="date"
              value={from}
              {...(max === undefined ? {} : { max })}
              onChange={(event) => onChange({ from: event.target.value, to })}
            />
          )}
        </FormField>
      </div>
      <div className="min-w-0">
        <FormField id={`${id}-to`} label={t("to")}>
          {(field) => (
            <Input
              {...field}
              type="date"
              value={to}
              {...(max === undefined ? {} : { max })}
              onChange={(event) => onChange({ from, to: event.target.value })}
            />
          )}
        </FormField>
      </div>
      <p className="col-span-2 text-xs text-muted">{t("hint")}</p>
    </fieldset>
  );
}

function HistoryContent() {
  const access = useHrAccess();
  const today = access.today ?? "";
  const [range, setRange] = useState({ from: addDays(today, -13), to: today });
  const outcome = useQuery(hrRefs.history, range);
  return (
    <div className="space-y-4">
      <HrToolbar>
        <DateRangeFields {...range} max={today} onChange={setRange} />
      </HrToolbar>
      <HrQueryState outcome={outcome}>
        {() => (outcome?.ok ? <HistoryTable result={outcome.value} /> : null)}
      </HrQueryState>
    </div>
  );
}

type HistoryRow = Extract<
  RefValue<typeof hrRefs.history>,
  { ok: true }
>["rows"][number];

/** A start–end pair; a single dash when neither side was recorded. */
function Interval({
  start,
  end,
  timezone,
  emphasis = false,
}: {
  readonly start: number | undefined;
  readonly end: number | undefined;
  readonly timezone: string;
  readonly emphasis?: boolean;
}) {
  if (start === undefined && end === undefined)
    return <span className="text-muted">—</span>;
  return (
    <span
      className={`tabular-nums ${emphasis ? "font-semibold text-link" : "text-text"}`}
    >
      <TimeText at={start} timeZone={timezone} empty="—" />
      {" – "}
      <TimeText at={end} timeZone={timezone} empty="—" />
    </span>
  );
}

const changed = (row: HistoryRow) =>
  row.effectiveStartAt !== row.originalStartAt ||
  row.effectiveEndAt !== row.originalEndAt;

function HistoryTable({
  result,
}: {
  readonly result: RefValue<typeof hrRefs.history>;
}) {
  const t = useTranslations("Hr.history");
  const locale = useLocale();
  if (!result.ok) return <HrInlineError code={result.code} />;
  if (result.rows.length === 0)
    return <EmptyState title={t("empty")} body={t("emptyHint")} />;
  const timezone = result.timezone;
  const dateLink = (row: HistoryRow) => (
    <Link
      href={hrDayPath(row.businessDate)}
      className="inline-flex min-h-touch items-center font-semibold text-link underline-offset-4 hover:underline"
    >
      {formatBusinessDate(row.businessDate, locale, {
        weekday: true,
        short: true,
      })}
    </Link>
  );
  return (
    <>
      <div className="hidden md:block">
        <TableScroller label={t("tableLabel")}>
          <Table scroll={false} className="min-w-[52rem]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("date")}</TableHead>
                <TableHead>{t("planned")}</TableHead>
                <TableHead>{t("original")}</TableHead>
                <TableHead>{t("effective")}</TableHead>
                <TableHead className="text-right">{t("worked")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead>{t("request")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow
                  key={row.businessDate}
                  className={
                    row.plan.kind === "SCHEDULED" ? undefined : "bg-raised/50"
                  }
                >
                  <TableCell>{dateLink(row)}</TableCell>
                  <TableCell className="text-muted">
                    <PlanText plan={row.plan} />
                  </TableCell>
                  <TableCell>
                    <Interval
                      start={row.originalStartAt}
                      end={row.originalEndAt}
                      timezone={timezone}
                    />
                  </TableCell>
                  <TableCell>
                    <Interval
                      start={row.effectiveStartAt}
                      end={row.effectiveEndAt}
                      timezone={timezone}
                      emphasis={changed(row)}
                    />
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    <Duration minutes={row.workedMinutes} />
                  </TableCell>
                  <TableCell>
                    <DayStatusBadge
                      status={row.status}
                      issue={row.issue}
                      disposition={row.disposition}
                    />
                  </TableCell>
                  <TableCell>
                    {row.correction ? (
                      <CorrectionBadge status={row.correction.status} />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroller>
      </div>
      <ul className="space-y-2 md:hidden" aria-label={t("tableLabel")}>
        {result.rows.map((row) => (
          <li
            key={row.businessDate}
            className="rounded-xl border border-border bg-surface px-4 py-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              {dateLink(row)}
              <DayStatusBadge
                status={row.status}
                issue={row.issue}
                disposition={row.disposition}
              />
            </div>
            <p className="text-xs text-muted">
              <PlanText plan={row.plan} />
            </p>
            <dl className="mt-2 grid grid-cols-3 gap-2 pb-1 text-sm">
              <div className="min-w-0">
                <dt className="text-xs text-muted">{t("original")}</dt>
                <dd>
                  <Interval
                    start={row.originalStartAt}
                    end={row.originalEndAt}
                    timezone={timezone}
                  />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted">{t("effective")}</dt>
                <dd>
                  <Interval
                    start={row.effectiveStartAt}
                    end={row.effectiveEndAt}
                    timezone={timezone}
                    emphasis={changed(row)}
                  />
                </dd>
              </div>
              <div className="min-w-0 text-right">
                <dt className="text-xs text-muted">{t("worked")}</dt>
                <dd className="font-semibold tabular-nums">
                  <Duration minutes={row.workedMinutes} />
                </dd>
              </div>
            </dl>
            {row.correction ? (
              <div className="flex items-center gap-2 border-t border-border pt-2 pb-1 text-xs text-muted">
                {t("request")}
                <CorrectionBadge status={row.correction.status} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
