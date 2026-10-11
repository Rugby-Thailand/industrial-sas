"use client";

import { useQuery } from "convex/react";
import { ArrowLeft, CalendarCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/PageHeader";
import { SelectControl } from "@/components/ui/SelectControl";
import { Notice } from "@/components/ui/Notice";
import type { RefValue } from "@/lib/convex/clientRef";
import { hrRefs } from "@/lib/convex/hrApi";
import {
  useGuardedUrl,
  useQueryParams,
  useUrlBackedState,
} from "@/lib/deepLink";
import {
  HR_CODES,
  hrReviewPath,
  readReviewUrl,
  type ReviewTab,
} from "@/lib/navigation";

import { addDays, formatBusinessDate } from "./format";
import { compareDates } from "../../../convex/model/hr/calendar";
import { DateRangeFields } from "./HistoryScreen";
import {
  DayStatusBadge,
  HrGate,
  HrInlineError,
  HrQueryState,
} from "./HrShared";
import { HrInitials, HrToolbar } from "./HrUi";
import { ReviewDetail } from "./ReviewDetail";

export function HrReviewScreen() {
  const t = useTranslations("Hr.review");
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} showBack={false} />
      <HrGate code={HR_CODES.review}>
        <ReviewContent />
      </HrGate>
    </>
  );
}

type Queue = RefValue<typeof hrRefs.queue>;
type QueueItem = Extract<Queue, { ok: true }>["items"][number];

type Selection = { employeeId: string; businessDate: string };

const DEFAULT_DAYS = 14;

/**
 * The default two-week window, moved back to contain an earlier linked
 * date. A future linked date keeps the default window: the queue never
 * lists the future, and `from` must not pass `to` (the day itself still
 * opens through its own detail query).
 */
export function rangeFor(today: string, date: string | undefined) {
  const from = addDays(today, -(DEFAULT_DAYS - 1));
  if (
    date === undefined ||
    compareDates(date, today) > 0 ||
    compareDates(from, date) <= 0
  )
    return { from, to: today };
  const end = addDays(date, DEFAULT_DAYS - 1);
  return { from: date, to: compareDates(end, today) > 0 ? today : end };
}

function ReviewContent() {
  const t = useTranslations("Hr.review");
  const access = useHrAccess();
  const id = useId();
  const today = access.today ?? "";
  const params = useQueryParams();
  const url = readReviewUrl(params);
  const navigate = useGuardedUrl();
  // The selected day, tab and range follow the URL so a link, reload or
  // Back/Forward opens the same record; the detail loads by itself, so a
  // day outside the listed window or tab still opens.
  const urlKey = params.toString();
  const [selected, setSelected] = useUrlBackedState<Selection | undefined>(
    urlKey,
    url.selection === undefined
      ? undefined
      : {
          employeeId: url.selection.employeeId,
          businessDate: url.selection.date,
        },
  );
  const [chosenTab, setChosenTab] = useUrlBackedState<ReviewTab | undefined>(
    urlKey,
    url.tab,
  );
  const linkedDate = url.selection?.date;
  const [range, setRange] = useState(() => rangeFor(today, linkedDate));
  // A newly linked day outside the shown window moves the window to it;
  // a date the user can already see leaves their chosen range alone.
  const [rangeDate, setRangeDate] = useState(linkedDate);
  if (linkedDate !== rangeDate) {
    setRangeDate(linkedDate);
    if (
      linkedDate !== undefined &&
      (compareDates(linkedDate, range.from) < 0 ||
        compareDates(linkedDate, range.to) > 0)
    )
      setRange(rangeFor(today, linkedDate));
  }
  const [site, setSite] = useState("");
  const outcome = useQuery(hrRefs.queue, {
    ...range,
    ...(site === "" ? {} : { warehouseId: site }),
  });

  const allItems = outcome?.ok && outcome.value.ok ? outcome.value.items : [];
  const loaded = outcome?.ok === true && outcome.value.ok;
  const inTab = (value: "OPEN" | "CERTIFIED", item: QueueItem) =>
    value === "OPEN" ? item.status === "EXCEPTION" : item.certified;
  const isSelected = (item: QueueItem) =>
    selected !== undefined &&
    item.employeeId === selected.employeeId &&
    item.businessDate === selected.businessDate;
  const selectedItem = allItems.find(isSelected);
  // A linked certified day opens in the Certified tab unless one was chosen.
  const tab: ReviewTab =
    chosenTab ??
    (selectedItem !== undefined && !inTab("OPEN", selectedItem)
      ? "CERTIFIED"
      : "OPEN");
  const certifiedCount = loaded
    ? allItems.filter((item) => inTab("CERTIFIED", item)).length
    : undefined;
  const openCount = loaded
    ? allItems.filter((item) => inTab("OPEN", item)).length
    : undefined;
  const select = (next: Selection | undefined, nextTab: ReviewTab = tab) =>
    navigate(
      hrReviewPath({
        ...(next === undefined
          ? {}
          : { employeeId: next.employeeId, date: next.businessDate }),
        tab: nextTab,
      }),
      () => {
        setSelected(next);
        setChosenTab(nextTab);
      },
    );
  // Switching tabs keeps the open detail only if that record is in the new tab.
  const switchTab = (value: "OPEN" | "CERTIFIED") =>
    select(
      selected !== undefined &&
        allItems.some((item) => inTab(value, item) && isSelected(item))
        ? selected
        : undefined,
      value,
    );
  const outsideList =
    loaded && selected !== undefined && selectedItem === undefined;

  // The queue sits beside the open record whenever this pane (not the
  // window) is wide enough, so it stays usable next to the app sidebar.
  return (
    <div className="@container space-y-4">
      <HrToolbar
        className={selected === undefined ? undefined : "hidden @3xl:flex"}
      >
        <DateRangeFields {...range} max={today} onChange={setRange} />
        {access.sites.length > 1 ? (
          <div className="grid w-full gap-2 sm:w-56">
            <Label htmlFor={`${id}-site`}>{t("site")}</Label>
            <SelectControl
              id={`${id}-site`}
              value={site}
              onValueChange={setSite}
              placeholder={t("allSites")}
              emptyLabel={t("allSites")}
              options={[
                { value: "", label: t("allSites") },
                ...access.sites.map((option) => ({
                  value: option.id,
                  label: `${option.code} · ${option.name}`,
                })),
              ]}
            />
          </div>
        ) : null}
        <div
          role="group"
          aria-label={t("tabs")}
          className="flex w-full gap-1 rounded-lg border border-border bg-raised p-1 sm:ml-auto sm:w-auto"
        >
          {(["OPEN", "CERTIFIED"] as const).map((value) => {
            const count = value === "OPEN" ? openCount : certifiedCount;
            return (
              <Button
                key={value}
                type="button"
                variant={tab === value ? "active" : "ghost"}
                aria-pressed={tab === value}
                onClick={() => switchTab(value)}
                className="flex-1 sm:flex-none"
              >
                {t(value === "OPEN" ? "tabOpen" : "tabCertified")}
                {count === undefined ? null : (
                  <span className="rounded-full bg-surface px-2 text-xs text-muted tabular-nums">
                    {count}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      </HrToolbar>

      <div className="grid items-start gap-4 @3xl:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <div
          className={
            selected === undefined ? "min-w-0" : "hidden min-w-0 @3xl:block"
          }
        >
          <HrQueryState outcome={outcome}>
            {() => {
              if (!outcome?.ok) return null;
              const queue = outcome.value;
              if (!queue.ok) return <HrInlineError code={queue.code} />;
              const items = queue.items.filter((item) => inTab(tab, item));
              return (
                <div className="space-y-3">
                  {outsideList ? (
                    <Notice
                      tone="neutral"
                      title={t("selectedOutsideList")}
                      testId="hr-review-outside-list"
                    />
                  ) : null}
                  <QueueList
                    items={items}
                    tab={tab}
                    selected={selected}
                    onSelect={(item) =>
                      select({
                        employeeId: item.employeeId,
                        businessDate: item.businessDate,
                      })
                    }
                  />
                </div>
              );
            }}
          </HrQueryState>
        </div>
        <div className="min-w-0 @3xl:sticky @3xl:top-0 @3xl:max-h-[calc(100dvh-9rem)] @3xl:overflow-y-auto @3xl:pr-1">
          {selected === undefined && url.invalid ? (
            <HrInlineError code="NOT_FOUND" />
          ) : selected === undefined ? (
            <div
              role="status"
              className="hidden flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-12 text-center @3xl:flex"
            >
              <span className="flex size-12 items-center justify-center rounded-full bg-accent-surface text-link">
                <CalendarCheck aria-hidden="true" className="size-6" />
              </span>
              <p className="text-base font-semibold text-text">
                {t("selectTitle")}
              </p>
              <p className="max-w-sm text-sm text-muted">{t("selectHint")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <Button
                type="button"
                variant="outline"
                className="@3xl:hidden"
                onClick={() => select(undefined)}
              >
                <ArrowLeft aria-hidden="true" />
                {t("backToList")}
              </Button>
              <ReviewDetail
                key={`${selected.employeeId}:${selected.businessDate}`}
                employeeId={selected.employeeId}
                businessDate={selected.businessDate}
                {...(url.focus === undefined ? {} : { focus: url.focus })}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QueueList({
  items,
  tab,
  selected,
  onSelect,
}: {
  readonly items: readonly QueueItem[];
  readonly tab: "OPEN" | "CERTIFIED";
  readonly selected: { employeeId: string; businessDate: string } | undefined;
  readonly onSelect: (item: {
    employeeId: string;
    businessDate: string;
  }) => void;
}) {
  const t = useTranslations("Hr.review");
  const locale = useLocale();
  if (items.length === 0)
    return <EmptyState title={t("empty")} body={t("emptyHint")} />;
  return (
    <section aria-label={t("queueLabel")} className="space-y-2">
      <p className="px-1 text-sm text-muted" role="status">
        {t(tab === "OPEN" ? "openCount" : "certifiedCount", {
          count: items.length,
        })}
      </p>
      <ul className="space-y-2 @3xl:max-h-[calc(100dvh-16rem)] @3xl:overflow-y-auto @3xl:pr-1">
        {items.map((item) => {
          const active =
            selected?.employeeId === item.employeeId &&
            selected.businessDate === item.businessDate;
          return (
            <li
              key={`${item.employeeId}:${item.businessDate}`}
              className="@container"
            >
              <button
                type="button"
                onClick={() => onSelect(item)}
                aria-pressed={active}
                className={`grid min-h-touch w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring @md:grid-cols-[auto_minmax(0,1fr)_auto] @md:items-center ${
                  active
                    ? "border-link bg-selected shadow-[inset_4px_0_0_var(--color-link)]"
                    : "border-border bg-surface hover:border-border-strong hover:bg-raised"
                }`}
              >
                <HrInitials name={item.employeeName} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold break-words text-text">
                    {item.employeeName}
                  </span>
                  <span className="block text-xs break-words text-muted">
                    <span className="whitespace-nowrap">
                      {item.employeeCode}
                    </span>
                    {item.siteCode ? ` · ${item.siteCode}` : ""}
                  </span>
                  <span className="mt-1 block text-sm text-text">
                    {formatBusinessDate(item.businessDate, locale, {
                      weekday: true,
                      short: true,
                    })}
                  </span>
                </span>
                {/* Below the identity in a narrow card so the code stays readable. */}
                <span className="col-start-2 @md:col-start-3 @md:row-start-1">
                  <DayStatusBadge
                    status={item.status}
                    issue={item.issue}
                    disposition={item.disposition}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
