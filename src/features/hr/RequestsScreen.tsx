"use client";

import { FilterRadios } from "@/components/system/FilterRadios";
import { useHrQuery } from "@/hooks/useHrQuery";
import { ArrowLeft, ArrowRight, ClipboardList, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";

import { OutcomeGate } from "@/components/system/DataGate";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/FormField";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Notice } from "@/components/ui/Notice";
import { DescriptionList } from "@/components/ui/DescriptionList";
import {
  AppliedFilterChip,
  ClearFilterButton,
  FilterTrigger,
} from "@/components/system/FilterActions";
import { SheetTrigger } from "@/components/ui/sheet";
import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { Link } from "@/i18n/navigation";
import { hrRefs } from "@/lib/convex/hrApi";
import type { RefValue } from "@/lib/convex/clientRef";
import { HR_CODES, ROUTES, hrDayPath } from "@/lib/navigation";

import { formatBusinessDate } from "./format";
import {
  CorrectionBadge,
  HrCorrectionTimeline,
  HrGate,
  HrInlineError,
  TimeText,
  useHrBack,
} from "./HrShared";
import { HrActionCard } from "./HrActionCard";
import { useHrListCriteria } from "./HrListCriteria";
import { HrToolbar } from "./HrUi";
import { HrFilterSheet } from "./HrFilterSheet";
import { filterRangeIssue, HrFilterRange } from "./HrFilterRange";

export function HrRequestsScreen() {
  const t = useTranslations("Hr.requests");
  const back = useHrBack();
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} {...back}>
        <Button asChild variant="outline">
          <Link href={ROUTES.hrTime}>
            <Plus aria-hidden="true" />
            {t("newCorrection")}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={ROUTES.hrLeave}>{t("leaveRequests")}</Link>
        </Button>
      </PageHeader>
      <HrGate code={HR_CODES.self}>
        <RequestsContent />
      </HrGate>
    </>
  );
}

const STATUSES = ["ALL", "PENDING", "CERTIFIED", "RETURNED"] as const;
type RequestStatus = (typeof STATUSES)[number];
const LIST_DEFAULTS = { status: "", from: "", to: "", text: "" } as const;

function RequestsContent() {
  const t = useTranslations("Hr.requests");
  const filterText = useTranslations("Hr.filterControls");
  const locale = useLocale();
  const access = useHrAccess();
  // Filters live in the URL and the page position in history metadata, so
  // returning from a request (Back) or reloading shows the same page.
  const [criteria, setCriteria, entry] = useHrListCriteria(
    LIST_DEFAULTS,
    "requests",
  );
  const status: RequestStatus = (STATUSES as readonly string[]).includes(
    criteria.status,
  )
    ? (criteria.status as RequestStatus)
    : "ALL";
  const filters = { from: criteria.from, to: criteria.to, text: criteria.text };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sheetOpen = useRef(false);
  const [draft, setDraft] =
    useState<Readonly<Record<keyof typeof LIST_DEFAULTS, string>>>(
      LIST_DEFAULTS,
    );
  const id = useId();
  const focus = useRef(`${id}-from`);
  const changeOpen = (next: boolean) => {
    if (sheetOpen.current === next) return;
    sheetOpen.current = next;
    if (next) setDraft({ status, ...filters });
    setFiltersOpen(next);
  };
  const paging = useCursorPagination({
    scope: `hr:requests:${access.identityKey ?? "anonymous"}`,
    criteria: { status, ...filters, entry },
  });
  const cursor = paging.cursor ?? undefined;
  const outcome = useHrQuery(hrRefs.requests, {
    limit: 20,
    ...(filters.from === "" ? {} : { from: filters.from }),
    ...(filters.to === "" ? {} : { to: filters.to }),
    ...(filters.text === "" ? {} : { text: filters.text }),
    ...(status === "ALL" ? {} : { status }),
    ...(cursor === undefined ? {} : { cursor }),
  });
  const statusOptions = STATUSES.map((value) => ({
    value,
    label: t(`filter.${value}`),
  }));
  const statusPatch = (value: string) => (value === "ALL" ? "" : value);
  const dateLabel = [filters.from, filters.to]
    .filter(Boolean)
    .map((date) => formatBusinessDate(date, locale))
    .join(" – ");
  const chips = [
    {
      key: "status",
      active: status !== "ALL",
      label: t(`filter.${status}`),
      remove: () => setCriteria({ status: "" }),
    },
    {
      key: filters.from === "" ? "to" : "from",
      active: dateLabel !== "",
      label:
        filters.from !== "" && filters.to !== ""
          ? dateLabel
          : `${t(filters.from === "" ? "to" : "from")} ${dateLabel}`,
      remove: () => setCriteria({ from: "", to: "" }),
    },
    {
      key: "text",
      active: filters.text !== "",
      label: filters.text,
      remove: () => setCriteria({ text: "" }),
    },
  ].filter(({ active }) => active);
  const clearFilters = () => setCriteria(LIST_DEFAULTS);
  return (
    <div className="space-y-group">
      <HrToolbar label={t("filters")} className="items-center justify-between">
        <FilterRadios
          id={`${id}-quick-status`}
          label={t("status")}
          value={status}
          options={statusOptions}
          onChange={(value) => setCriteria({ status: statusPatch(value) })}
          wrap
        />
        <div className="flex items-center gap-1">
          <HrFilterSheet
            open={filtersOpen}
            onOpenChange={changeOpen}
            title={t("filters")}
            focus={focus}
            trigger={
              <SheetTrigger asChild>
                <FilterTrigger
                  label={t("filters")}
                  count={chips.length}
                  onClick={() => {
                    focus.current = `${id}-from`;
                  }}
                />
              </SheetTrigger>
            }
            applyDisabled={filterRangeIssue(draft) !== undefined}
            onApply={() =>
              setCriteria({
                ...draft,
                status: statusPatch(draft.status),
                text: draft.text.trim(),
              })
            }
          >
            <HrFilterRange
              id={id}
              from={draft.from}
              to={draft.to}
              fromLabel={t("from")}
              toLabel={t("to")}
              onChange={(next, changed) =>
                setDraft((current) => ({
                  ...current,
                  [changed]: next[changed],
                }))
              }
            />
            <FormField id={`${id}-text`} label={t("text")}>
              {(field) => (
                <Input
                  {...field}
                  type="search"
                  maxLength={100}
                  value={draft.text}
                  onChange={(event) => {
                    const text = event.currentTarget.value;
                    setDraft((current) => ({ ...current, text }));
                  }}
                />
              )}
            </FormField>
            <section className="space-y-2">
              <h3 className="font-semibold text-text">{t("status")}</h3>
              <FilterRadios
                id={`${id}-status`}
                label={t("status")}
                value={draft.status}
                options={statusOptions}
                onChange={(status) =>
                  setDraft((current) => ({ ...current, status }))
                }
              />
            </section>
          </HrFilterSheet>
          {chips.length > 1 ? (
            <ClearFilterButton
              label={t("clearFilter")}
              onClick={clearFilters}
            />
          ) : null}
        </div>
        {chips.length > 0 ? (
          <ul className="flex w-full flex-wrap items-center gap-2">
            {chips.map(({ key, label, remove }) => (
              <li key={key} className="max-w-full">
                <AppliedFilterChip
                  label={label}
                  editLabel={filterText("edit", { label })}
                  removeLabel={filterText("remove", { label })}
                  onEdit={() => {
                    focus.current = `${id}-${key}`;
                    changeOpen(true);
                  }}
                  onRemove={remove}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </HrToolbar>
      <OutcomeGate outcome={outcome}>
        {({ value }) => (
          <RequestsPage
            result={value}
            status={chips.length === 0 ? "ALL" : "FILTERED"}
            page={paging.page}
            clear={clearFilters}
            previous={paging.canPrevious ? paging.previous : undefined}
            next={(nextCursor) => paging.next(nextCursor)}
          />
        )}
      </OutcomeGate>
    </div>
  );
}

function RequestsPage({
  result,
  status,
  page,
  clear,
  previous,
  next,
}: {
  readonly result: RefValue<typeof hrRefs.requests>;
  readonly status: string;
  readonly page: number;
  readonly clear: () => void;
  readonly previous: (() => void) | undefined;
  readonly next: (cursor: string) => void;
}) {
  const t = useTranslations("Hr.requests");
  const locale = useLocale();
  if (!result.ok) return <HrInlineError code={result.code} />;
  const items = result.items;
  return (
    <div className="space-y-section">
      {items.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title={t(
            !result.isDone
              ? "scanEmpty"
              : status === "ALL"
                ? "empty"
                : "noMatches",
          )}
          body={t(
            !result.isDone
              ? "scanHint"
              : status === "ALL"
                ? "emptyHint"
                : "noMatchesHint",
          )}
          action={
            status === "ALL" ? undefined : (
              <Button variant="outline" onClick={clear}>
                {t("clearFilter")}
              </Button>
            )
          }
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <HrActionCard
                icon={ClipboardList}
                href={`${ROUTES.hrRequests}/${encodeURIComponent(item.id)}`}
                label={formatBusinessDate(item.businessDate, locale, {
                  weekday: true,
                })}
                description={item.reason}
                value={<CorrectionBadge status={item.status} />}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          disabled={previous === undefined}
          onClick={previous}
        >
          <ArrowLeft aria-hidden="true" />
          {t("previous")}
        </Button>
        <p className="text-sm text-muted">{t("page", { page })}</p>
        <Button
          variant="outline"
          disabled={result.isDone || result.continueCursor === undefined}
          onClick={() => {
            if (result.continueCursor !== undefined)
              next(result.continueCursor);
          }}
        >
          {t("next")}
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export function HrRequestDetailScreen({
  requestId,
}: {
  readonly requestId: string;
}) {
  const t = useTranslations("Hr.requests");
  return (
    <>
      <PageHeader
        title={t("detailTitle")}
        summary={t("detailSummary")}
        backFallbackHref={ROUTES.hrRequests}
      />
      <HrGate code={HR_CODES.self}>
        <RequestDetail requestId={requestId} />
      </HrGate>
    </>
  );
}

function RequestDetail({ requestId }: { readonly requestId: string }) {
  const outcome = useHrQuery(hrRefs.requestDetail, { correctionId: requestId });
  return (
    <OutcomeGate outcome={outcome}>
      {({ value }) => <RequestDetailView result={value} />}
    </OutcomeGate>
  );
}

function RequestDetailView({
  result,
}: {
  readonly result: RefValue<typeof hrRefs.requestDetail>;
}) {
  const t = useTranslations("Hr.requests");
  const locale = useLocale();
  if (!result.ok) return <HrInlineError code={result.code} />;
  return (
    <Panel className="space-y-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold text-text">
          {formatBusinessDate(result.businessDate, locale, { weekday: true })}
        </p>
        <CorrectionBadge status={result.detail.status} />
      </div>
      <p className="text-sm wrap-anywhere whitespace-pre-wrap text-text">
        {result.detail.reason}
      </p>
      <DescriptionList
        items={[
          {
            id: "proposed",
            label: t("proposed"),
            value: (
              <>
                <TimeText
                  at={result.detail.proposedStartAt}
                  timeZone={result.timezone}
                />{" "}
                –{" "}
                <TimeText
                  at={result.detail.proposedEndAt}
                  timeZone={result.timezone}
                />
              </>
            ),
          },
        ]}
      />
      {result.detail.status === "PENDING" && result.detail.stale ? (
        <Notice tone="warning" title={t("stale")} />
      ) : null}
      <HrCorrectionTimeline
        entries={result.detail.history}
        timezone={result.timezone}
      />
      <Button asChild variant="outline">
        <Link href={hrDayPath(result.businessDate)}>
          {t("openDay")}
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </Panel>
  );
}
