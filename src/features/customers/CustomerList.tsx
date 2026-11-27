"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { ChevronRight, Link2, Plus } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { CollectionToolbar } from "@/components/system/CollectionToolbar";
import { CursorPagination } from "@/components/system/CursorPagination";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { useConnectionStall } from "@/components/system/connectionStall";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { choiceTargetClassName } from "@/components/ui/CheckboxControl";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TableScroller } from "@/components/ui/TableScroller";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCatalogueSync } from "@/hooks/useCatalogueSync";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import {
  useDebouncedSearch,
  useScanContinuation,
} from "@/hooks/useScanContinuation";
import { Link } from "@/i18n/navigation";
import { customerPath, ROUTES } from "@/lib/navigation";
import { CustomerLineEntry } from "./CustomerLineEntry";
import { useCustomerCatalogueState } from "./useCustomerCatalogueState";
import { CustomerGate, useCustomerAccess } from "./customerAccess";

const DASH = "—";

export function CustomerCatalogue() {
  const t = useTranslations("Customers");
  return (
    <CustomerGate loadingLabel={t("loading")}>
      <CatalogueContent />
    </CustomerGate>
  );
}

function NewCustomerAction() {
  const t = useTranslations("Customers");
  return (
    <Button asChild className="shrink-0">
      <Link href={`${ROUTES.customers}/new`} data-testid="new-customer-action">
        <Plus aria-hidden="true" className="size-4" />
        {t("newCustomer")}
      </Link>
    </Button>
  );
}

function CustomerReviewLink({
  names,
  scans,
  hasMore,
  canReview,
}: {
  readonly names: number;
  readonly scans: number;
  readonly hasMore: boolean;
  readonly canReview: boolean;
}) {
  const t = useTranslations("Customers");
  const title = canReview
    ? t(scans === 0 ? "reviewTitle" : "reviewUnlinkedNames")
    : t("reviewViewNames");
  return (
    <Link
      href={ROUTES.customerReview}
      data-testid="customer-review-banner"
      className="flex min-h-touch min-w-0 items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-1.5 focus-ring hover:bg-raised dense:min-h-control"
    >
      <Link2 aria-hidden="true" className="size-4 shrink-0 text-link" />
      <span className="min-w-0 flex-1 text-sm leading-5 wrap-anywhere">
        <span className="block font-semibold text-link">{title}</span>
        {scans === 0 ? null : (
          <span className="block text-muted tabular-nums">
            {t(hasMore ? "reviewCountsPartial" : "reviewCounts", {
              names,
              scans,
            })}
          </span>
        )}
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted" />
    </Link>
  );
}

function CatalogueContent() {
  const t = useTranslations("Customers");
  const format = useFormatter();
  const locale = useLocale();
  const stalled = useConnectionStall() !== null;
  const { userId, orgId } = useAuth();
  const { canManage } = useCustomerAccess();
  const review = useQuery(api.customers.linking.reviewSummary, {});
  const scope = `customers:${orgId ?? "null"}:${userId ?? "anonymous"}`;
  const { state: filters, update } = useCustomerCatalogueState(scope);
  const settled = useDebouncedSearch(filters.search);
  const criteria = { search: settled, status: filters.status };
  const paging = useCursorPagination({ scope, criteria });
  const scan = useScanContinuation(
    JSON.stringify([criteria, paging.cursor, paging.pageSize]),
  );
  const outcome = useQuery(
    api.customers.catalogue.listCustomersPage,
    filters.search === settled
      ? {
          search: settled,
          ...(filters.status === "ALL" ? {} : { status: filters.status }),
          pageSize: paging.pageSize,
          ...(paging.cursor ? { cursor: paging.cursor } : {}),
          ...(scan.cursor ? { scanCursor: scan.cursor } : {}),
        }
      : "skip",
  );
  const sync = useCatalogueSync({
    outcome,
    continuation: scan,
    paging,
    resetKey: JSON.stringify(criteria),
    hasRows: (value) => Boolean(value.page?.length),
  });
  const ready = outcome?.ok && outcome.value.status === "ready";
  const failed = outcome?.ok === true && outcome.value.status === "reset";
  const customers = ready ? outcome.value.page : [];
  const emptyRead =
    ready && customers.length === 0
      ? JSON.stringify([scope, outcome.requestId])
      : null;
  const [staleEmptyRead, setStaleEmptyRead] = useState<string | null>(null);
  // Reopening the socket does not refresh the last query response.
  if (stalled && emptyRead !== null && staleEmptyRead !== emptyRead)
    setStaleEmptyRead(emptyRead);
  else if (
    !stalled &&
    ready &&
    staleEmptyRead !== null &&
    staleEmptyRead !== emptyRead
  )
    setStaleEmptyRead(null);
  const lastResult =
    stalled || (emptyRead !== null && staleEmptyRead === emptyRead);
  const filtered = settled.trim() !== "" || filters.status !== "ACTIVE";
  const statusGroup = useId();
  const canViewWarehouseData = Boolean(
    review?.ok && review.value.canViewWarehouseData,
  );
  const activitySummaries = useQuery(
    api.customers.linking.listCustomerActivitySummaries,
    canViewWarehouseData && customers.length > 0
      ? { customerIds: customers.map((customer) => customer.customerId) }
      : "skip",
  );
  const activityByCustomerId = new Map(
    activitySummaries?.ok
      ? activitySummaries.value.summaries.map((item) => [item.customerId, item])
      : [],
  );
  const showWarehouseColumns = canViewWarehouseData;
  const unresolvedNames = review?.ok ? review.value.unresolvedNameCount : 0;
  const unresolvedScans = review?.ok ? review.value.unresolvedScanCount : 0;
  const reviewHasMore = Boolean(review?.ok && review.value.hasMore);
  return (
    <div className="space-y-3">
      <CollectionToolbar
        value={filters.search}
        // A search-only patch: typing coalesces into one history entry.
        onValueChange={(search) => update({ search })}
        searchLabel={t("search")}
        clearLabel={t("clearSearch")}
        actions={
          // Full width on phones wraps status and Add below a full-width
          // search, so the placeholder is never clipped.
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
            <fieldset className="flex flex-wrap items-center gap-x-3">
              <legend className="sr-only">{t("statusFilter")}</legend>
              {(["ACTIVE", "ARCHIVED", "ALL"] as const).map((status) => (
                <label key={status} className={choiceTargetClassName}>
                  <input
                    type="radio"
                    name={statusGroup}
                    value={status}
                    className="size-4 accent-link focus-ring"
                    checked={filters.status === status}
                    onChange={() => update({ status })}
                  />
                  {t(
                    {
                      ACTIVE: "statusActive",
                      ARCHIVED: "statusArchived",
                      ALL: "statusAll",
                    }[status],
                  )}
                </label>
              ))}
            </fieldset>
            <CustomerLineEntry />
            {canManage ? <NewCustomerAction /> : null}
          </div>
        }
      />
      {review?.ok &&
      review.value.canViewWarehouseData &&
      (unresolvedScans > 0 || reviewHasMore) ? (
        <CustomerReviewLink
          names={unresolvedNames}
          scans={unresolvedScans}
          hasMore={reviewHasMore}
          canReview={review.value.canReview}
        />
      ) : null}
      {outcome !== undefined && !outcome.ok ? (
        // A refused read is an access decision, not a connection problem.
        <LedgerPanelStatus
          state={{ kind: "DENIED", requestId: outcome.denial.requestId }}
        />
      ) : failed ? (
        // The list changed under a continuation more often than the automatic
        // reset allows; reloading from the first page is the person's call.
        <Notice
          tone="warning"
          role="alert"
          title={t("loadError")}
          body={t("loadErrorBody")}
          testId="customer-list-changed"
          action={
            <Button type="button" variant="outline" onClick={sync.retry}>
              {t("reload")}
            </Button>
          }
        />
      ) : !ready ? (
        <LedgerPanelStatus state={{ kind: "LOADING" }} label={t("loading")} />
      ) : customers.length === 0 ? (
        <EmptyState
          compact
          announce={!lastResult}
          title={t(
            lastResult
              ? "lastResultEmpty"
              : filtered
                ? "noMatches"
                : "emptyTitle",
          )}
          body={
            lastResult
              ? undefined
              : t(
                  filtered
                    ? "noMatchesBody"
                    : canManage
                      ? "emptyBody"
                      : "emptyBodyViewOnly",
                )
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <TableScroller label={t("tableLabel")} testId="customer-table">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className={showWarehouseColumns ? "w-[44%]" : "w-[64%]"}
                    >
                      {t("colCustomer")}
                    </TableHead>
                    <TableHead>{t("colProvince")}</TableHead>
                    {showWarehouseColumns ? (
                      <>
                        <TableHead className="w-[12%] text-right">
                          {t("colProducts")}
                        </TableHead>
                        <TableHead className="w-[24%]">
                          {t("colLatestJob")}
                        </TableHead>
                      </>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((customer) => {
                    const summary = activityByCustomerId.get(
                      customer.customerId,
                    );
                    return (
                      <TableRow key={customer.customerId}>
                        <TableCell className="align-top">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <Link
                              href={customerPath(customer.customerId)}
                              className="min-w-0 font-medium wrap-anywhere text-text hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-link"
                            >
                              {customer.name}
                            </Link>
                            {customer.status === "ARCHIVED" ? (
                              <StatusBadge
                                tone="muted"
                                label={t("statusArchived")}
                              />
                            ) : null}
                          </div>
                          <div className="mt-0.5 font-mono text-xs wrap-anywhere text-muted">
                            {customer.code}
                          </div>
                        </TableCell>
                        <TableCell className="align-top text-sm wrap-anywhere">
                          {customer.province ?? (
                            <span className="text-muted">{DASH}</span>
                          )}
                        </TableCell>
                        {showWarehouseColumns ? (
                          <>
                            <TableCell className="text-right align-top text-sm tabular-nums">
                              {summary !== undefined ? (
                                format.number(summary.linkedProductCount)
                              ) : (
                                <span className="text-muted">{DASH}</span>
                              )}
                            </TableCell>
                            <TableCell className="align-top text-sm">
                              {summary?.latestJob ? (
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                  <span className="font-mono text-xs text-text">
                                    {summary.latestJob.factoryOrder}
                                  </span>
                                  <span className="text-xs text-muted tabular-nums">
                                    {format.dateTime(
                                      summary.latestJob.createdAt,
                                      { dateStyle: "medium" },
                                    )}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-muted">{DASH}</span>
                              )}
                            </TableCell>
                          </>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableScroller>
          </div>
          <ul
            className="divide-y divide-border rounded-lg border border-border bg-surface md:hidden"
            aria-label={t("tableLabel")}
            data-testid="customer-cards"
          >
            {customers.map((customer) => {
              const summary = activityByCustomerId.get(customer.customerId);
              return (
                <li key={customer.customerId}>
                  <Link
                    href={customerPath(customer.customerId)}
                    className="flex min-h-touch items-center gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-link"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 font-medium wrap-anywhere text-text">
                          {customer.name}
                        </span>
                        {customer.status === "ARCHIVED" ? (
                          <StatusBadge
                            tone="muted"
                            label={t("statusArchived")}
                          />
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-xs wrap-anywhere text-muted">
                        <span className="font-mono">{customer.code}</span>
                        {customer.province ? ` · ${customer.province}` : null}
                        {summary?.latestJob
                          ? ` · ${t("latestJobMobile", {
                              date: format.dateTime(
                                summary.latestJob.createdAt,
                                {
                                  dateStyle: "short",
                                },
                              ),
                            })}`
                          : null}
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {failed ? null : (
        <CursorPagination
          page={paging.page}
          pageSize={paging.pageSize}
          onPageSizeChange={paging.setPageSize}
          onPrevious={paging.previous}
          onNext={() => {
            if (ready) paging.next(outcome.value.continueCursor);
          }}
          canPrevious={paging.canPrevious}
          canNext={Boolean(ready && !outcome.value.isDone)}
          loading={!ready}
          locale={locale === "th" ? "th" : "en"}
        />
      )}
    </div>
  );
}
