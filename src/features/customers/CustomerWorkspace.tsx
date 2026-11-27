"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { List, PencilLine, Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { api } from "../../../convex/_generated/api";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { ScanIcon } from "@/components/ui/ScanIcon";
import { SelectControl } from "@/components/ui/SelectControl";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Link } from "@/i18n/navigation";
import {
  useGuardedUrl,
  useQueryParams,
  useUrlBackedState,
} from "@/lib/deepLink";
import {
  customerEditPath,
  customerJobScanPath,
  customerWorkspacePath,
  readCustomerWorkspaceUrl,
  ROUTES,
  type CustomerWorkspaceSection,
  type CustomerWorkspaceUrlState,
} from "@/lib/navigation";
import { warehouseLabel } from "@/lib/workspace/workspace";
import { CustomerGate, useCustomerAccess } from "./customerAccess";
import { CustomerAliasesCard, LifecycleAction } from "./CustomerDetail";
import { CustomerDetailCard } from "./CustomerDetailCard";
import { CustomerLineEntry } from "./CustomerLineEntry";
import { CustomerDelivery, CustomerRegistration } from "./CustomerProfileCards";
import { CustomerDirectory } from "./CustomerDirectory";
import {
  CustomerWarehouseSection,
  type Workspace,
} from "./CustomerWarehouseSection";
import type { CustomerDetailRow } from "./customerTypes";

const SECTIONS = ["overview", "jobs", "products", "details"] as const;
const PARAMS = ["section", "warehouse", "filter"] as const;

function workspaceHref(
  customerId: string,
  state: CustomerWorkspaceUrlState,
  query: string,
  hash: string,
) {
  const [path, search] = customerWorkspacePath(customerId, state).split("?");
  const current = new URLSearchParams(query);
  const next = new URLSearchParams(search);
  for (const param of PARAMS) {
    const value = next.get(param);
    if (value) current.set(param, value);
    else current.delete(param);
  }
  const serialized = current.toString();
  return `${path}${serialized ? `?${serialized}` : ""}${hash}`;
}

export function CustomerWorkspace({
  customerId,
}: {
  readonly customerId: string;
}) {
  const t = useTranslations("Customers");
  return (
    <CustomerGate
      loadingLabel={t("loadingCustomer")}
      frame={
        <PageHeader
          title={t("detailTitle")}
          backFallbackHref={ROUTES.customers}
        />
      }
    >
      <CustomerWorkspaceQuery key={customerId} customerId={customerId} />
    </CustomerGate>
  );
}

function CustomerWorkspaceQuery({
  customerId,
}: {
  readonly customerId: string;
}) {
  const t = useTranslations("Customers");
  const outcome = useQuery(api.customers.catalogue.getCustomer, { customerId });
  if (outcome?.ok && outcome.value)
    return <WorkspaceContent customer={outcome.value} />;
  return (
    <>
      <PageHeader
        title={outcome?.ok ? t("notFoundTitle") : t("detailTitle")}
        backFallbackHref={ROUTES.customers}
      />
      {outcome === undefined ? (
        <LedgerPanelStatus
          state={{ kind: "LOADING" }}
          label={t("loadingCustomer")}
        />
      ) : outcome.ok ? (
        <Notice
          tone="warning"
          title={t("notFoundTitle")}
          body={t("notFoundBody")}
          testId="customer-not-found"
        />
      ) : (
        <LedgerPanelStatus
          state={{ kind: "DENIED", requestId: outcome.denial.requestId }}
        />
      )}
    </>
  );
}

function WorkspaceContent({
  customer,
}: {
  readonly customer: CustomerDetailRow;
}) {
  const t = useTranslations("Customers");
  const { orgId, userId } = useAuth();
  const { canManage } = useCustomerAccess();
  const workspace = useWorkspace();
  const params = useQueryParams();
  const query = params.toString();
  const customerId = customer.customerId;
  // Defer access normalization until the customer workspace has answered.
  const requested = readCustomerWorkspaceUrl(params, {
    canViewWarehouseData: true,
  });
  const [selection] = useUrlBackedState(query, requested);
  // Keep the current view in place until Next commits its browser entry.
  // A control rendered ahead of a push could replace the still-current entry
  // or push a destination before the new section becomes a Back step.
  const [changingUrl, setChangingUrl] = useUrlBackedState(query, false);
  const shellOutcome = useQuery(api.customers.workspace.getCustomerWorkspace, {
    customerId,
    ...(selection.warehouse === "all"
      ? {}
      : { warehouseId: selection.warehouse }),
    ...(selection.section === "overview" ? {} : { includeOverview: false }),
  });
  const shell = shellOutcome?.ok ? shellOutcome.value : undefined;
  const access = shell?.access;
  const showWarehouse = access?.canViewWarehouseData === true;
  const normalized = readCustomerWorkspaceUrl(params, {
    canViewWarehouseData: access?.canViewWarehouseData !== false,
  });
  const state = access?.canViewWarehouseData === false ? normalized : selection;
  const section = state.section;
  const navigate = useGuardedUrl();
  const canonicalHref = workspaceHref(customerId, normalized, query, "");
  const canonicalQuery = canonicalHref.split("?")[1] ?? "";
  const directorySearch = useRef<HTMLInputElement>(null);
  const contactRef = useRef<HTMLDivElement>(null);
  const focusContact = useRef(false);

  useEffect(() => {
    if (access && !changingUrl && canonicalQuery !== query)
      navigate(
        `${canonicalHref}${window.location.hash}`,
        () => setChangingUrl(true),
        "replace",
      );
  }, [
    access,
    canonicalHref,
    canonicalQuery,
    changingUrl,
    navigate,
    query,
    setChangingUrl,
  ]);

  useEffect(() => {
    if (section === "overview" && focusContact.current && contactRef.current) {
      focusContact.current = false;
      contactRef.current.focus();
    }
  }, [section]);

  function chooseSection(
    next: CustomerWorkspaceSection,
    filter: CustomerWorkspaceUrlState["filter"] = "all",
    after?: () => void,
  ) {
    const value = { section: next, filter, warehouse: state.warehouse };
    if (changingUrl || (next === section && filter === state.filter)) return;
    navigate(
      workspaceHref(customerId, value, query, window.location.hash),
      () => {
        after?.();
        setChangingUrl(true);
      },
    );
  }

  function chooseWarehouse(warehouse: string) {
    if (changingUrl || warehouse === state.warehouse) return;
    const value = { ...state, section, warehouse };
    navigate(
      workspaceHref(customerId, value, query, window.location.hash),
      () => setChangingUrl(true),
      "replace",
    );
  }

  function chooseFilter(filter: CustomerWorkspaceUrlState["filter"]) {
    if (changingUrl || filter === state.filter) return;
    const value = { ...state, section: "jobs" as const, filter };
    navigate(
      workspaceHref(customerId, value, query, window.location.hash),
      () => setChangingUrl(true),
    );
  }

  const archived = customer.status === "ARCHIVED";
  const manage = canManage && access?.canManage;
  return (
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)]">
      <CustomerDirectory
        key={`${orgId}:${userId}`}
        scope={`customers:${orgId ?? "null"}:${userId ?? "anonymous"}`}
        currentId={customerId}
        warehouse={state.warehouse}
        searchRef={directorySearch}
        navigating={changingUrl}
      />
      <div className="min-w-0 space-y-4">
        <div className="rounded-lg border border-border bg-surface px-4 pt-4">
          <PageHeader
            title={customer.name}
            backFallbackHref={ROUTES.customers}
            meta={
              <>
                <span className="font-mono">{customer.code}</span>
                <StatusBadge
                  tone={archived ? "muted" : "success"}
                  label={t(archived ? "statusArchived" : "statusActive")}
                />
                <span>{customer.deliveryAddress?.province}</span>
              </>
            }
          >
            <div inert={changingUrl} className="contents">
              <CustomerLineEntry customerId={customerId} />
              {showWarehouse && access?.canScan && !archived ? (
                <Button asChild>
                  <Link
                    href={customerJobScanPath(customerId)}
                    onNavigate={() => {
                      if (
                        workspace.warehouses.some(
                          ({ id }) => id === state.warehouse,
                        )
                      )
                        workspace.selectWarehouse(state.warehouse);
                    }}
                  >
                    <ScanIcon aria-hidden="true" className="size-4" />
                    {t("workspace.scan")}
                  </Link>
                </Button>
              ) : null}
              {customer.contact ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (section === "overview" || section === "details")
                      contactRef.current?.focus();
                    else
                      chooseSection("overview", "all", () => {
                        focusContact.current = true;
                      });
                  }}
                >
                  <Phone aria-hidden="true" className="size-4" />
                  {t("workspace.contact")}
                </Button>
              ) : null}
              <Button
                variant="outline"
                className="hidden lg:inline-flex"
                onClick={() => directorySearch.current?.focus()}
              >
                <List aria-hidden="true" className="size-4" />
                {t("workspace.allCustomers")}
              </Button>
              <Button asChild variant="outline" className="lg:hidden">
                <Link href={ROUTES.customers}>
                  {t("workspace.allCustomers")}
                </Link>
              </Button>
              {manage ? (
                <>
                  {!archived ? (
                    <Button asChild variant="outline">
                      <Link href={customerEditPath(customerId)}>
                        <PencilLine aria-hidden="true" className="size-4" />
                        {t("edit")}
                      </Link>
                    </Button>
                  ) : null}
                  <LifecycleAction customer={customer} />
                </>
              ) : null}
            </div>
          </PageHeader>
        </div>

        {archived ? (
          <Notice
            tone="muted"
            title={t("archivedNotice")}
            {...(manage ? { body: t("archivedNoticeBody") } : {})}
          />
        ) : null}

        <div inert={changingUrl} aria-busy={changingUrl} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border">
            <nav
              className="flex max-w-full gap-1 overflow-x-auto"
              aria-label={t("workspace.sections")}
            >
              {(showWarehouse
                ? SECTIONS
                : (["overview", "details"] as const)
              ).map((item) => {
                const selected =
                  item === section ||
                  (section === "stock" && item === "products");
                return (
                  <Button
                    key={item}
                    variant="ghost"
                    className={
                      selected
                        ? "rounded-none border-b-2 border-current text-link"
                        : "rounded-none border-b-2 border-transparent text-muted"
                    }
                    aria-current={selected ? "page" : undefined}
                    onClick={() => chooseSection(item)}
                  >
                    {t(`workspace.${item}`)}
                  </Button>
                );
              })}
            </nav>
            {showWarehouse && shell ? (
              <WarehouseScope
                shell={shell}
                warehouse={state.warehouse}
                onChange={chooseWarehouse}
              />
            ) : null}
          </div>

          {shellOutcome && !shellOutcome.ok ? (
            <LedgerPanelStatus
              state={{
                kind: "DENIED",
                requestId: shellOutcome.denial.requestId,
              }}
            />
          ) : null}
          {showWarehouse && shell && !shell.scopeAvailable ? (
            <Notice
              tone="warning"
              title={t("workspace.scopeUnavailable")}
              body={t("workspace.scopeUnavailableBody")}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => chooseWarehouse("all")}
                >
                  {t("workspace.allWarehouses")}
                </Button>
              }
            />
          ) : null}
          {section === "overview" ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div className="space-y-4">
                <CustomerDelivery customer={customer} contactRef={contactRef} />
                <CustomerDetailCard
                  title={t("sectionTax")}
                  action={
                    <Button
                      variant="link"
                      className="h-auto min-h-touch px-0"
                      onClick={() => chooseSection("details")}
                    >
                      {t("workspace.details")}
                    </Button>
                  }
                >
                  <p className="text-sm wrap-anywhere text-muted">
                    {[
                      customer.legalNameTh,
                      customer.legalNameEn,
                      customer.establishment?.kind === "HEAD_OFFICE"
                        ? t("headOffice")
                        : customer.establishment?.kind === "BRANCH"
                          ? t("branch", { code: customer.establishment.code })
                          : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ") || t("workspace.noRegistration")}
                  </p>
                </CustomerDetailCard>
              </div>
              <CustomerWarehouseSection
                key={JSON.stringify([
                  customerId,
                  state.warehouse,
                  state.filter,
                  section,
                ])}
                customerId={customerId}
                shell={shell}
                loading={shellOutcome === undefined}
                section={section}
                warehouse={state.warehouse}
                filter={state.filter}
                onSection={chooseSection}
                onFilter={chooseFilter}
              />
            </div>
          ) : section === "details" ? (
            <div className="grid items-start gap-4 xl:grid-cols-2">
              <CustomerDelivery
                customer={customer}
                contactRef={contactRef}
                showNotes={false}
              />
              <CustomerRegistration customer={customer} canManage={!!manage} />
              {showWarehouse ? (
                <CustomerAliasesCard
                  customerId={customerId}
                  canEdit={!!manage && !archived}
                />
              ) : null}
              {customer.notes ? (
                <CustomerDetailCard title={t("sectionNotes")}>
                  <p className="text-sm wrap-anywhere whitespace-pre-line">
                    {customer.notes}
                  </p>
                </CustomerDetailCard>
              ) : null}
            </div>
          ) : (
            <CustomerWarehouseSection
              key={JSON.stringify([
                customerId,
                state.warehouse,
                state.filter,
                section,
              ])}
              customerId={customerId}
              shell={shell}
              loading={shellOutcome === undefined}
              section={section}
              warehouse={state.warehouse}
              filter={state.filter}
              onSection={chooseSection}
              onFilter={chooseFilter}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function WarehouseScope({
  shell,
  warehouse,
  onChange,
}: {
  readonly shell: Workspace;
  readonly warehouse: string;
  readonly onChange: (warehouse: string) => void;
}) {
  const t = useTranslations("Customers.workspace");
  return (
    <div className="my-1 min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span aria-hidden="true">{t("warehouse")}</span>
        <SelectControl
          label={t("warehouse")}
          placeholder={t("warehouse")}
          emptyLabel={t("allWarehouses")}
          value={warehouse}
          onValueChange={onChange}
          className="min-w-0"
          options={[
            { value: "all", label: t("allWarehouses") },
            ...(warehouse !== "all" &&
            !shell.warehouses.some(
              ({ warehouseId }) => warehouseId === warehouse,
            )
              ? [{ value: warehouse, label: t("selectedWarehouse") }]
              : []),
            ...shell.warehouses.map(({ warehouseId, code, name }) => ({
              value: warehouseId,
              label: warehouseLabel({ id: warehouseId, code, name }),
            })),
          ]}
        />
      </div>
      {shell.warehousesComplete ? null : (
        <p className="mt-1 text-xs text-muted">{t("warehouseListPartial")}</p>
      )}
    </div>
  );
}
