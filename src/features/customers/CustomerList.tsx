"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { ChevronRight, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "../../../convex/_generated/api";
import { CollectionToolbar } from "@/components/system/CollectionToolbar";
import { CursorPagination } from "@/components/system/CursorPagination";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { SelectControl } from "@/components/ui/SelectControl";
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
import {
  useCustomerCatalogueState,
  type CustomerStatusFilter,
} from "./useCustomerCatalogueState";
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

function CatalogueContent() {
  const t = useTranslations("Customers");
  const locale = useLocale();
  const { userId, orgId } = useAuth();
  const { canManage } = useCustomerAccess();
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
  const denied = outcome !== undefined && !outcome.ok;
  const failed =
    denied || (outcome?.ok === true && outcome.value.status === "reset");
  const customers = ready ? outcome.value.page : [];
  const filtered = settled.trim() !== "" || filters.status !== "ACTIVE";
  const clear = () => update({ search: "", status: "ACTIVE" });
  return (
    <div className="space-y-4">
      <CollectionToolbar
        value={filters.search}
        // A search-only patch: typing coalesces into one history entry.
        onValueChange={(search) => update({ search })}
        searchLabel={t("search")}
        clearLabel={t("clearSearch")}
        actions={
          // Full width on phones wraps status and Add below a full-width
          // search, so the placeholder is never clipped.
          <div className="flex w-full min-w-0 gap-2 sm:w-auto">
            <SelectControl
              value={filters.status}
              onValueChange={(status) =>
                update({ status: status as CustomerStatusFilter })
              }
              options={[
                { value: "ACTIVE", label: t("statusActive") },
                { value: "ARCHIVED", label: t("statusArchived") },
                { value: "ALL", label: t("statusAll") },
              ]}
              label={t("statusFilter")}
              placeholder={t("statusFilter")}
              emptyLabel={t("statusActive")}
              className="flex-1 sm:w-48 sm:flex-none"
            />
            {canManage ? <NewCustomerAction /> : null}
          </div>
        }
      />
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
        >
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            onClick={sync.retry}
          >
            {t("reload")}
          </Button>
        </Notice>
      ) : !ready ? (
        <LedgerPanelStatus state={{ kind: "LOADING" }} label={t("loading")} />
      ) : customers.length === 0 ? (
        filtered ? (
          <EmptyState
            title={t("noMatches")}
            body={t("noMatchesBody")}
            action={
              <Button type="button" variant="ghost" onClick={clear}>
                {t("clearFilters")}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={t("emptyTitle")}
            body={canManage ? t("emptyBody") : t("emptyBodyViewOnly")}
          />
        )
      ) : (
        <>
          <div className="hidden md:block">
            <TableScroller label={t("tableLabel")} testId="customer-table">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[64%]">
                      {t("colCustomer")}
                    </TableHead>
                    <TableHead>{t("colProvince")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((customer) => (
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroller>
          </div>
          <ul
            className="divide-y divide-border rounded-lg border border-border bg-surface md:hidden"
            aria-label={t("tableLabel")}
            data-testid="customer-cards"
          >
            {customers.map((customer) => (
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
                        <StatusBadge tone="muted" label={t("statusArchived")} />
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs wrap-anywhere text-muted">
                      <span className="font-mono">{customer.code}</span>
                      {customer.province ? ` · ${customer.province}` : null}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted"
                  />
                </Link>
              </li>
            ))}
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
