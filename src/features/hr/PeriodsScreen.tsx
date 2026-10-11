"use client";

import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { useDraftGuard } from "@/components/providers/draftGuard";
import { useHrAccess, useHrCan } from "@/components/providers/HrAccessProvider";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { SelectControl } from "@/components/ui/SelectControl";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableScroller } from "@/components/ui/TableScroller";
import { Link, useRouter } from "@/i18n/navigation";
import { hrRefs } from "@/lib/convex/hrApi";
import { HR_CODES, hrPeriodPath } from "@/lib/navigation";

import { addDays, formatBusinessDate } from "./format";
import { DateRangeFields } from "./HistoryScreen";
import { HrGate, HrQueryState, SectionTitle, WriteFeedback } from "./HrShared";
import { useHrWrite, type HrWriteState } from "./useHrWrite";

export function HrPeriodsScreen() {
  const t = useTranslations("Hr.periods");
  const canClose = useHrCan(HR_CODES.close);
  const live = useHrAccess().timezoneSupported;
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} showBack={false}>
        {canClose ? (
          <Button
            type="button"
            onClick={() => setCreating(true)}
            disabled={creating || !live}
            data-testid="hr-period-new"
          >
            <Plus aria-hidden="true" />
            {t("create")}
          </Button>
        ) : null}
      </PageHeader>
      <HrGate code={HR_CODES.close} allowUnsupportedTimezone>
        <PeriodsContent
          creating={creating}
          onCancel={() => setCreating(false)}
        />
      </HrGate>
    </>
  );
}

function PeriodsContent({
  creating,
  onCancel,
}: {
  readonly creating: boolean;
  readonly onCancel: () => void;
}) {
  const t = useTranslations("Hr.periods");
  const locale = useLocale();
  const outcome = useQuery(hrRefs.periods, {});
  const live = useHrAccess().timezoneSupported;
  return (
    <div className="space-y-6">
      {creating && live ? <CreatePeriodForm onCancel={onCancel} /> : null}
      <HrQueryState outcome={outcome}>
        {() => {
          if (!outcome?.ok) return null;
          const { items, complete } = outcome.value;
          if (items.length === 0)
            return <EmptyState title={t("empty")} body={t("emptyHint")} />;
          return (
            <div className="space-y-2">
              {complete ? null : (
                <Notice
                  tone="warning"
                  role="alert"
                  title={t("incomplete", { count: items.length })}
                  testId="hr-periods-incomplete"
                />
              )}
              <TableScroller label={t("tableLabel")}>
                <Table scroll={false} className="min-w-[40rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("range")}</TableHead>
                      <TableHead>{t("site")}</TableHead>
                      <TableHead>{t("status")}</TableHead>
                      <TableHead className="text-right">
                        {t("version")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((period) => (
                      <TableRow key={period.id}>
                        <TableCell>
                          <Link
                            href={hrPeriodPath(period.id)}
                            className="inline-flex min-h-touch items-center font-semibold text-link underline-offset-4 hover:underline"
                          >
                            {t("rangeLabel", {
                              from: formatBusinessDate(
                                period.startDate,
                                locale,
                                {
                                  short: true,
                                },
                              ),
                              to: formatBusinessDate(period.endDate, locale, {
                                short: true,
                              }),
                            })}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {period.siteCode} · {period.siteName}
                          {period.siteActive ? null : (
                            <span className="block text-xs text-muted">
                              {t("siteInactive")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <PeriodStatus status={period.status} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {period.status === "DRAFT"
                            ? t("draftVersion", {
                                version: period.draftVersion,
                              })
                            : t("closedVersion", {
                                version: period.latestClosedVersion,
                              })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScroller>
            </div>
          );
        }}
      </HrQueryState>
    </div>
  );
}

export function PeriodStatus({ status }: { readonly status: string }) {
  const t = useTranslations("Hr.periods");
  return (
    <StatusBadge
      tone={status === "CLOSED" ? "success" : "pending"}
      label={t(status === "CLOSED" ? "closed" : "draft")}
    />
  );
}

function CreatePeriodForm({ onCancel }: { readonly onCancel: () => void }) {
  const t = useTranslations("Hr.periods");
  const form = useTranslations("Hr.form");
  const access = useHrAccess();
  const router = useRouter();
  const id = useId();
  const create = useMutation(hrRefs.createPeriod);
  const today = access.today ?? "";
  const [initial] = useState(() => ({
    site: access.sites.length === 1 ? access.sites[0]!.id : "",
    range: {
      from: addDays(today.slice(0, 8) + "01", -1).slice(0, 8) + "01",
      to: addDays(today.slice(0, 8) + "01", -1),
    },
  }));
  const [site, setSite] = useState(initial.site);
  const [range, setRange] = useState(initial.range);
  const [siteError, setSiteError] = useState<string>();
  const write = useHrWrite<{ documentId: string }>(
    `period:create:${site}:${range.from}:${range.to}`,
  );
  // A chosen site or range survives search and links unless discarded; a
  // creation in flight must settle first, so its period can still open.
  useDraftGuard(
    write.state.kind !== "SAVED" &&
      (site !== initial.site ||
        range.from !== initial.range.from ||
        range.to !== initial.range.to),
    () => {
      setSite(initial.site);
      setRange(initial.range);
      setSiteError(undefined);
    },
    write.pending,
  );
  const send = async () => {
    if (site === "") {
      setSiteError(t("siteRequired"));
      return;
    }
    setSiteError(undefined);
    finish(
      await write.submit((requestId) =>
        create({
          requestId,
          warehouseId: site,
          startDate: range.from,
          endDate: range.to,
        }),
      ),
    );
  };
  const finish = (result: HrWriteState<{ documentId: string }>) => {
    if (result.kind === "SAVED")
      router.push(hrPeriodPath(result.value.documentId));
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby={`${id}-title`}
      className="space-y-4 rounded-xl border border-border bg-surface p-4"
    >
      <SectionTitle>
        <span id={`${id}-title`}>{t("createTitle")}</span>
      </SectionTitle>
      <p className="text-sm text-muted">{t("createIntro")}</p>
      <div className="grid gap-2 sm:max-w-sm">
        <Label htmlFor={`${id}-site`}>{t("site")}</Label>
        <SelectControl
          id={`${id}-site`}
          value={site}
          onValueChange={setSite}
          disabled={write.locked}
          placeholder={t("chooseSite")}
          emptyLabel={t("noSites")}
          invalid={siteError !== undefined}
          {...(siteError === undefined
            ? {}
            : { describedBy: `${id}-site-error` })}
          options={access.sites.map((option) => ({
            value: option.id,
            label: `${option.code} · ${option.name}`,
          }))}
        />
        {siteError ? (
          <p
            id={`${id}-site-error`}
            role="alert"
            className="text-xs text-danger"
          >
            {siteError}
          </p>
        ) : null}
      </div>
      <fieldset disabled={write.locked} className="contents">
        <DateRangeFields {...range} onChange={setRange} />
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          disabled={write.locked}
          data-testid="hr-period-create"
        >
          {write.pending ? form("submitting") : t("createSubmit")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={write.pending}
        >
          {form("cancel")}
        </Button>
      </div>
      <WriteFeedback
        state={write.state}
        onRetry={() => void write.retry().then(finish)}
      />
    </form>
  );
}
