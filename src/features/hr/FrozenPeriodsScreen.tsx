"use client";

import { useQuery } from "convex/react";
import { ArrowLeft, ArrowRight, Archive, Download } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { OutcomeGate } from "@/components/system/DataGate";
import { Button } from "@/components/ui/button";
import { DescriptionList } from "@/components/ui/DescriptionList";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
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
import { hrRefs } from "@/lib/convex/hrApi";
import type { RefValue } from "@/lib/convex/clientRef";
import { HR_CODES, ROUTES } from "@/lib/navigation";
import { formatBusinessDate, formatDateTime } from "./format";
import { Duration, HrGate, HrInlineError, TimeText } from "./HrShared";
import { HrActionCard } from "./HrActionCard";
import { downloadHolidayCsv } from "./selfService";

export function HrFrozenPeriodsScreen() {
  const t = useTranslations("Hr.frozen");
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")}>
        <Button asChild variant="outline">
          <Link href={ROUTES.hrTime}>{t("liveHistory")}</Link>
        </Button>
      </PageHeader>
      <HrGate code={HR_CODES.self} allowUnsupportedTimezone>
        <FrozenList />
      </HrGate>
    </>
  );
}
function FrozenList() {
  const t = useTranslations("Hr.frozen");
  const locale = useLocale();
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const outcome = useQuery(
    hrRefs.selfPeriods,
    cursor === undefined ? {} : { cursor },
  );
  return (
    <OutcomeGate outcome={outcome}>
      {({ value }) => {
        if (!value.ok) return <HrInlineError code={value.code} />;
        return (
          <div className="space-y-section">
            {value.items.length === 0 ? (
              <EmptyState
                icon={<Archive />}
                title={t(value.isDone ? "empty" : "scanEmpty")}
                body={t(value.isDone ? "emptyHint" : "scanHint")}
              />
            ) : (
              <ul className="space-y-3">
                {value.items.map((item) => (
                  <li key={item.id}>
                    <HrActionCard
                      icon={Archive}
                      href={`${ROUTES.hrFrozenPeriods}/${encodeURIComponent(item.id)}`}
                      label={`${formatBusinessDate(item.from, locale)} – ${formatBusinessDate(item.to, locale)}`}
                      description={`${item.siteName} · ${t("revision", { version: item.revision })}`}
                      value={formatDateTime(
                        item.closedAt,
                        locale,
                        item.timezone,
                      )}
                    />
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                variant="outline"
                disabled={cursors.length === 0}
                onClick={() => setCursors((list) => list.slice(0, -1))}
              >
                <ArrowLeft aria-hidden />
                {t("previous")}
              </Button>
              <Button
                variant="outline"
                disabled={value.isDone || value.continueCursor === undefined}
                onClick={() => {
                  if (value.continueCursor !== undefined)
                    setCursors((list) => [...list, value.continueCursor]);
                }}
              >
                {t("next")}
                <ArrowRight aria-hidden />
              </Button>
            </div>
          </div>
        );
      }}
    </OutcomeGate>
  );
}
export function HrFrozenPeriodDetailScreen({
  versionId,
}: {
  readonly versionId: string;
}) {
  const t = useTranslations("Hr.frozen");
  return (
    <>
      <PageHeader title={t("detailTitle")} summary={t("detailSummary")}>
        <Button asChild variant="outline">
          <Link href={ROUTES.hrFrozenPeriods}>{t("title")}</Link>
        </Button>
      </PageHeader>
      <HrGate code={HR_CODES.self} allowUnsupportedTimezone>
        <FrozenDetail versionId={versionId} />
      </HrGate>
    </>
  );
}
function FrozenDetail({ versionId }: { readonly versionId: string }) {
  const outcome = useQuery(hrRefs.selfPeriodDetail, { versionId });
  return (
    <OutcomeGate outcome={outcome}>
      {({ value }) => <FrozenDetailView result={value} />}
    </OutcomeGate>
  );
}
function FrozenDetailView({
  result,
}: {
  readonly result: RefValue<typeof hrRefs.selfPeriodDetail>;
}) {
  const t = useTranslations("Hr.frozen");
  const locale = useLocale();
  const common = useTranslations("Hr");
  if (!result.ok) return <HrInlineError code={result.code} />;
  const { version, rows, summary } = result;
  const timeZone = version.timezone;
  const download = () => {
    // Export only this already-authorized employee snapshot; no live/org totals.
    const data = [
      [
        "business_date",
        "original_captured",
        "original_in",
        "original_out",
        "effective_in",
        "effective_out",
        "worked_minutes",
        "outside_shift_minutes",
        "disposition",
      ],
      ...rows.map((row) => [
        row.date,
        String(row.originalCaptured),
        row.originalStart === undefined
          ? ""
          : new Date(row.originalStart).toISOString(),
        row.originalEnd === undefined
          ? ""
          : new Date(row.originalEnd).toISOString(),
        row.effectiveStart === undefined
          ? ""
          : new Date(row.effectiveStart).toISOString(),
        row.effectiveEnd === undefined
          ? ""
          : new Date(row.effectiveEnd).toISOString(),
        String(row.workedMinutes),
        String(row.outsideShiftMinutes),
        row.disposition,
      ]),
    ];
    downloadHolidayCsv(
      `attendance-${version.from}-${version.to}-v${version.revision}.csv`,
      "\uFEFF" +
        data
          .map((row) =>
            row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","),
          )
          .join("\r\n"),
    );
  };
  return (
    <div className="space-y-section">
      <Notice tone="accent" title={t("immutable")} body={t("immutableHint")} />
      <Panel>
        <DescriptionList
          items={[
            {
              label: t("employee"),
              value: `${result.employee.code} · ${result.employee.name}`,
            },
            {
              label: t("period"),
              value: `${formatBusinessDate(version.from, locale)} – ${formatBusinessDate(version.to, locale)}`,
            },
            {
              label: t("version"),
              value: t("revision", { version: version.revision }),
            },
            {
              label: t("site"),
              value: `${version.siteCode} · ${version.siteName}`,
            },
            {
              label: t("closedAt"),
              value: formatDateTime(version.closedAt, locale, timeZone),
            },
            {
              label: t("worked"),
              value: <Duration minutes={summary.workedMinutes} />,
            },
            {
              label: t("outside"),
              value: <Duration minutes={summary.outsideShiftMinutes} />,
            },
            { label: t("leave"), value: summary.leaveDays },
            { label: t("absent"), value: summary.absentDays },
            ...(version.revisionReason === undefined
              ? []
              : [
                  { label: t("revisionReason"), value: version.revisionReason },
                ]),
          ]}
        />
      </Panel>
      <Button variant="outline" onClick={download}>
        <Download aria-hidden />
        {t("download")}
      </Button>
      <TableScroller label={t("detailTitle")}>
        <Table scroll={false}>
          <TableHeader>
            <TableRow>
              {[
                "date",
                "planned",
                "original",
                "effective",
                "worked",
                "outside",
                "disposition",
              ].map((key) => (
                <TableHead key={key}>{t(key)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.date}>
                <TableCell>
                  {formatBusinessDate(row.date, locale, { short: true })}
                </TableCell>
                <TableCell>
                  <TimeText at={row.plannedStart} timeZone={timeZone} /> –{" "}
                  <TimeText at={row.plannedEnd} timeZone={timeZone} />
                </TableCell>
                <TableCell>
                  {row.originalCaptured ? (
                    <>
                      <TimeText at={row.originalStart} timeZone={timeZone} /> –{" "}
                      <TimeText at={row.originalEnd} timeZone={timeZone} />
                    </>
                  ) : (
                    <span className="text-muted">{t("originalUnknown")}</span>
                  )}
                </TableCell>
                <TableCell>
                  <TimeText at={row.effectiveStart} timeZone={timeZone} /> –{" "}
                  <TimeText at={row.effectiveEnd} timeZone={timeZone} />
                </TableCell>
                <TableCell className="tabular-nums">
                  <Duration minutes={row.workedMinutes} />
                </TableCell>
                <TableCell className="tabular-nums">
                  <Duration minutes={row.outsideShiftMinutes} />
                </TableCell>
                <TableCell>
                  {common(`status.disposition.${row.disposition}`)}
                  {row.correctionReason ? (
                    <p className="max-w-prose text-sm whitespace-pre-wrap text-muted">
                      {row.correctionReason}
                    </p>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroller>
    </div>
  );
}
