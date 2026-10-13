"use client";

import { useMutation } from "convex/react";
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
import { Link } from "@/i18n/navigation";
import { hrRefs } from "@/lib/convex/hrApi";
import { HR_CODES, hrPeriodPath } from "@/lib/navigation";

import { addDays, formatBusinessDate } from "./format";
import { DateRangeFields } from "./HistoryScreen";
import {
  HrGate,
  HrInlineError,
  SectionTitle,
  useHrBack,
  WriteFeedback,
} from "./HrShared";
import { useHrListCriteria } from "./HrListCriteria";
import { HrPagedState, HrPager, useHrPagedQuery } from "./HrPagedList";
import { HrSiteSelect } from "./HrSiteSelect";
import { HrToolbar } from "./HrUi";
import { useWorkflowStep } from "@/hooks/useWorkflowStep";
import { useTaskCompletion } from "@/hooks/useTaskCompletion";
import { flushSync } from "react-dom";
import { useHrWrite, type HrWriteState } from "./useHrWrite";

export function HrPeriodsScreen() {
  const t = useTranslations("Hr.periods");
  const back = useHrBack();
  const canClose = useHrCan(HR_CODES.close);
  const live = useHrAccess().timezoneSupported;
  const creation = useWorkflowStep(
    "periodCreate",
    "hr-period-create",
    canClose && live,
  );
  const creating = creation.active;
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} {...back}>
        {canClose ? (
          <Button
            type="button"
            onClick={creation.enter}
            disabled={creating || !live}
            data-testid="hr-period-new"
          >
            <Plus aria-hidden="true" />
            {t("create")}
          </Button>
        ) : null}
      </PageHeader>
      <HrGate code={HR_CODES.close} allowUnsupportedTimezone>
        <PeriodsContent creating={creating} onCancel={creation.back} />
      </HrGate>
    </>
  );
}

const LIST_DEFAULTS = { site: "", status: "" } as const;

function PeriodsContent({
  creating,
  onCancel,
}: {
  readonly creating: boolean;
  readonly onCancel: () => void;
}) {
  const t = useTranslations("Hr.periods");
  const locale = useLocale();
  const id = useId();
  const access = useHrAccess();
  const live = access.timezoneSupported;
  const [criteria, setCriteria, entry] = useHrListCriteria(
    LIST_DEFAULTS,
    "periods",
  );
  const status =
    criteria.status === "DRAFT" || criteria.status === "CLOSED"
      ? criteria.status
      : undefined;
  const { view, paging } = useHrPagedQuery(
    hrRefs.periodsPage,
    {
      ...(criteria.site === "" ? {} : { warehouseId: criteria.site }),
      ...(status === undefined ? {} : { status }),
    },
    "periods",
    entry,
  );
  const filtered = criteria.site !== "" || status !== undefined;
  const clear = () => setCriteria(LIST_DEFAULTS);
  return (
    <div className="space-y-6">
      {creating && live ? <CreatePeriodForm onCancel={onCancel} /> : null}
      <section aria-label={t("tableLabel")} className="space-y-3">
        <HrToolbar label={t("filters")}>
          <div className="grid w-full gap-2 sm:w-56">
            <Label htmlFor={`${id}-site`}>{t("site")}</Label>
            <HrSiteSelect
              id={`${id}-site`}
              surface="periods-filter"
              value={criteria.site}
              onChange={(site) => setCriteria({ site })}
              placeholder={t("allSites")}
              emptyLabel={t("allSites")}
              allLabel={t("allSites")}
              includeInactive
            />
          </div>
          <div className="grid w-full gap-2 sm:w-44">
            <Label htmlFor={`${id}-status`}>{t("status")}</Label>
            <SelectControl
              id={`${id}-status`}
              value={criteria.status}
              onValueChange={(next) => setCriteria({ status: next })}
              placeholder={t("allStatuses")}
              emptyLabel={t("allStatuses")}
              options={[
                { value: "", label: t("allStatuses") },
                { value: "DRAFT", label: t("draft") },
                { value: "CLOSED", label: t("closed") },
              ]}
            />
          </div>
          {filtered ? (
            <Button type="button" variant="ghost" onClick={clear}>
              {t("clearFilters")}
            </Button>
          ) : null}
        </HrToolbar>
        <HrPagedState
          view={view}
          refused={(code) => <HrInlineError code={code} />}
        >
          {(value, items) => (
            <div className="space-y-2">
              {value.sitesComplete ? null : (
                <Notice
                  tone="warning"
                  role="alert"
                  title={t("sitesIncomplete")}
                  testId="hr-periods-incomplete"
                />
              )}
              {items.length === 0 ? (
                filtered ? (
                  <EmptyState
                    title={t("noMatches")}
                    body={t("noMatchesHint")}
                    action={
                      <Button type="button" variant="outline" onClick={clear}>
                        {t("clearFilters")}
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState title={t("empty")} body={t("emptyHint")} />
                )
              ) : (
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
                                  { short: true },
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
              )}
            </div>
          )}
        </HrPagedState>
        <HrPager paging={paging} label={t("pagination")} />
      </section>
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
  const complete = useTaskCompletion(write.pending, { retainPage: true });
  // A chosen site or range survives search and links unless discarded; a
  // creation in flight must settle first, so its period can still open.
  const draftControl = useDraftGuard(
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
    // Settle first: the shell removes its history buffer, then navigates, so
    // the new period's Back cannot be consumed by the removal traversal.
    if (result.kind === "SAVED")
      complete(hrPeriodPath(result.value.documentId));
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
        <HrSiteSelect
          surface="period-create"
          id={`${id}-site`}
          value={site}
          onChange={setSite}
          disabled={write.locked}
          placeholder={t("chooseSite")}
          emptyLabel={t("noSites")}
          invalid={siteError !== undefined}
          {...(siteError === undefined
            ? {}
            : { describedBy: `${id}-site-error` })}
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
          onClick={() => {
            flushSync(() => {
              setSite(initial.site);
              setRange(initial.range);
              setSiteError(undefined);
            });
            draftControl.settle(onCancel);
          }}
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
