"use client";

import { useHrQuery } from "@/hooks/useHrQuery";
import { ArrowLeft, ArrowRight, ClipboardList, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";

import { OutcomeGate } from "@/components/system/DataGate";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/FormField";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Notice } from "@/components/ui/Notice";
import { DescriptionList } from "@/components/ui/DescriptionList";
import { SelectControl } from "@/components/ui/SelectControl";
import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { Link } from "@/i18n/navigation";
import { useUrlBackedState } from "@/lib/deepLink";
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
  const [draft, setDraft] = useUrlBackedState(JSON.stringify(filters), filters);
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
  const setStatus = (value: RequestStatus) =>
    setCriteria({ status: value === "ALL" ? "" : value });
  const setFilters = (next: typeof filters) => setCriteria(next);
  const id = useId();
  return (
    <div className="space-y-group">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setFilters(draft);
        }}
      >
        <HrToolbar label={t("filters")}>
          <FormField id={id} label={t("status")}>
            {(field) => (
              <SelectControl
                id={field.id}
                value={status}
                options={STATUSES.map((value) => ({
                  value,
                  label: t(`filter.${value}`),
                }))}
                placeholder={t("status")}
                emptyLabel={t("filter.ALL")}
                onValueChange={(value) => {
                  if ((STATUSES as readonly string[]).includes(value))
                    setStatus(value as RequestStatus);
                }}
                className="sm:w-52"
              />
            )}
          </FormField>
          {["from", "to", "text"].map((key) => (
            <FormField key={key} id={`${id}-${key}`} label={t(key)}>
              {(field) => (
                <Input
                  id={field.id}
                  type={key === "text" ? "search" : "date"}
                  maxLength={key === "text" ? 100 : undefined}
                  value={draft[key as keyof typeof draft]}
                  onChange={(event) =>
                    setDraft({ ...draft, [key]: event.target.value })
                  }
                />
              )}
            </FormField>
          ))}
          <Button type="submit" variant="outline">
            {t("applyFilters")}
          </Button>
          <p className="text-xs text-muted">{t("pageFilter")}</p>
        </HrToolbar>
      </form>
      <OutcomeGate outcome={outcome}>
        {({ value }) => (
          <RequestsPage
            result={value}
            status={
              status === "ALL" &&
              Object.values(filters).every((value) => value === "")
                ? "ALL"
                : "FILTERED"
            }
            page={paging.page}
            clear={() => {
              setCriteria(LIST_DEFAULTS);
              setDraft({ from: "", to: "", text: "" });
            }}
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
