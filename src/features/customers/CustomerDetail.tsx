"use client";

import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import {
  Archive,
  ArchiveRestore,
  Mail,
  MapPin,
  PencilLine,
  Phone,
  Plus,
  User,
  X,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DescriptionList } from "@/components/ui/DescriptionList";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
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
import { useAsyncOperation } from "@/hooks/useAsyncOperation";
import { useNavigationDraft } from "@/components/navigation/navigationDraft";
import { Link } from "@/i18n/navigation";
import {
  customerEditPath,
  customerPath,
  productPath,
  ROUTES,
} from "@/lib/navigation";
import { readCustomerWrite, type CustomerWriteFailure } from "./customerWrites";
import {
  CustomerGate,
  useCustomerAccess,
  useSubmissionIdentity,
} from "./customerAccess";
import { mailtoHref, telHref } from "./contactLinks";
import { CustomerEditor } from "./CustomerForm";
import type { CustomerDetailRow } from "./customerTypes";

const DASH = "—";

export function CustomerDetail({
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
          breadcrumbs={[{ label: t("title"), href: ROUTES.customers }]}
        />
      }
    >
      <CustomerQuery customerId={customerId} page="detail" />
    </CustomerGate>
  );
}

export function EditCustomerForm({
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
          title={t("editTitle")}
          breadcrumbs={[
            { label: t("title"), href: ROUTES.customers },
            { label: t("detailTitle"), href: customerPath(customerId) },
          ]}
        />
      }
    >
      <CustomerQuery customerId={customerId} page="edit" />
    </CustomerGate>
  );
}

/** One subscription feeds the detail page or the editor; both keep a page frame while it loads. */
function CustomerQuery({
  customerId,
  page,
}: {
  readonly customerId: string;
  readonly page: "detail" | "edit";
}) {
  const t = useTranslations("Customers");
  const outcome = useQuery(api.customers.catalogue.getCustomer, {
    customerId,
  });
  const customer: CustomerDetailRow | null | undefined = outcome?.ok
    ? (outcome.value ?? null)
    : undefined;
  if (!customer) {
    const missing = customer === null;
    return (
      <>
        {page === "edit" ? (
          <PageHeader
            title={missing ? t("notFoundTitle") : t("editTitle")}
            breadcrumbs={[
              { label: t("title"), href: ROUTES.customers },
              { label: t("detailTitle"), href: customerPath(customerId) },
            ]}
          />
        ) : (
          <PageHeader
            title={missing ? t("notFoundTitle") : t("detailTitle")}
            breadcrumbs={[{ label: t("title"), href: ROUTES.customers }]}
          />
        )}
        {outcome === undefined ? (
          <LedgerPanelStatus
            state={{ kind: "LOADING" }}
            label={t("loadingCustomer")}
          />
        ) : missing ? (
          <Notice
            tone="warning"
            title={t("notFoundTitle")}
            body={t("notFoundBody")}
            testId="customer-not-found"
          />
        ) : (
          <LedgerPanelStatus
            state={{
              kind: "DENIED",
              requestId: outcome.ok ? "" : outcome.denial.requestId,
            }}
          />
        )}
      </>
    );
  }
  return page === "edit" ? (
    <CustomerEditor key={customerId} customer={customer} />
  ) : (
    <CustomerDetailContent customer={customer} />
  );
}

function CustomerDetailContent({
  customer,
}: {
  readonly customer: CustomerDetailRow;
}) {
  const t = useTranslations("Customers");
  const { canManage } = useCustomerAccess();
  const { organization, warehouses } = useWorkspace();
  const productScope = JSON.stringify([
    customer.customerId,
    organization?.id,
    warehouses.map(({ id }) => id),
  ]);
  const activityOutcome = useQuery(api.customers.linking.getCustomerActivity, {
    customerId: customer.customerId,
  });
  const activity = activityOutcome?.ok ? activityOutcome.value : undefined;
  const archived = customer.status === "ARCHIVED";
  const address = customer.deliveryAddress;
  const contact = customer.contact;
  const addressLines = [
    address?.line,
    [address?.subdistrict, address?.district].filter(Boolean).join(" "),
    [address?.province, address?.postcode].filter(Boolean).join(" "),
  ].filter((line): line is string => Boolean(line));
  const showWarehouseSections = activity?.canViewWarehouseData === true;
  return (
    <>
      <PageHeader
        title={customer.name}
        breadcrumbs={[{ label: t("title"), href: ROUTES.customers }]}
        meta={
          <>
            <span className="font-mono">{customer.code}</span>
            <StatusBadge
              tone={archived ? "muted" : "success"}
              label={archived ? t("statusArchived") : t("statusActive")}
            />
          </>
        }
      >
        {canManage ? (
          <>
            {archived ? null : (
              <Button asChild variant="outline">
                <Link href={customerEditPath(customer.customerId)}>
                  <PencilLine aria-hidden="true" className="size-4" />
                  {t("edit")}
                </Link>
              </Button>
            )}
            {/* One instance across archive and restore, so a live status
                change never unmounts a confirmation that is still closing. */}
            <LifecycleAction customer={customer} />
          </>
        ) : null}
      </PageHeader>
      <div className="max-w-5xl space-y-4">
        {archived ? (
          <Notice
            tone="muted"
            title={t("archivedNotice")}
            {...(canManage ? { body: t("archivedNoticeBody") } : {})}
          />
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="min-w-0 space-y-4">
            <DetailCard title={t("sectionDelivery")}>
              {address?.label ? (
                <p className="font-medium wrap-anywhere text-text">
                  {address.label}
                </p>
              ) : null}
              {addressLines.length > 0 ? (
                <p className="flex gap-2 text-sm text-text">
                  <MapPin
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted"
                  />
                  <span className="min-w-0 wrap-anywhere">
                    {addressLines.map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                  </span>
                </p>
              ) : (
                <p className="text-sm text-muted">{t("noDelivery")}</p>
              )}
              <div className="border-t border-border pt-3">
                {contact?.name ||
                contact?.role ||
                contact?.phone ||
                contact?.email ? (
                  <div className="space-y-1 text-sm">
                    {contact.name || contact.role ? (
                      <p className="flex gap-2 text-text">
                        <User
                          aria-hidden="true"
                          className="mt-0.5 size-4 shrink-0 text-muted"
                        />
                        <span className="min-w-0 wrap-anywhere">
                          {[contact.name, contact.role]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </p>
                    ) : null}
                    {contact.phone && telHref(contact.phone) ? (
                      <a
                        href={telHref(contact.phone)}
                        className="-my-1 flex min-h-touch items-center gap-2 text-link hover:underline md:my-0 md:min-h-0"
                      >
                        <Phone aria-hidden="true" className="size-4 shrink-0" />
                        <span className="min-w-0 wrap-anywhere">
                          {contact.phone}
                        </span>
                      </a>
                    ) : contact.phone ? (
                      // Nothing dialable: show it as written, without a link.
                      <p className="flex items-center gap-2 text-text">
                        <Phone
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted"
                        />
                        <span className="min-w-0 wrap-anywhere">
                          {contact.phone}
                        </span>
                      </p>
                    ) : null}
                    {contact.email ? (
                      <a
                        href={mailtoHref(contact.email)}
                        className="-my-1 flex min-h-touch items-center gap-2 text-link hover:underline md:my-0 md:min-h-0"
                      >
                        <Mail aria-hidden="true" className="size-4 shrink-0" />
                        <span className="min-w-0 wrap-anywhere">
                          {contact.email}
                        </span>
                      </a>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted">{t("noContact")}</p>
                )}
              </div>
            </DetailCard>
            {showWarehouseSections ? (
              <>
                <CustomerJobsCard
                  key={`jobs-${productScope}`}
                  customerId={customer.customerId}
                  initialJobs={activity.recentJobs}
                  hasMoreInitial={activity.hasMoreJobs}
                />
                <CustomerProductsCard
                  key={productScope}
                  customerId={customer.customerId}
                  initialProducts={activity.linkedProducts}
                  hasMoreInitial={activity.hasMoreProducts}
                />
              </>
            ) : null}
          </div>
          <div className="min-w-0 space-y-4">
            <DetailCard title={t("sectionTax")}>
              <DescriptionList
                layout="rows"
                items={[
                  {
                    id: "legalNameTh",
                    label: t("legalNameTh"),
                    value: customer.legalNameTh ?? DASH,
                  },
                  {
                    id: "legalNameEn",
                    label: t("legalNameEn"),
                    value: customer.legalNameEn ?? DASH,
                  },
                  {
                    id: "taxId",
                    label: t("taxId"),
                    value: customer.taxId ? (
                      <span className="font-mono">{customer.taxId}</span>
                    ) : (
                      DASH
                    ),
                  },
                  {
                    id: "establishment",
                    label: t("establishment"),
                    value:
                      customer.establishment?.kind === "HEAD_OFFICE"
                        ? t("headOffice")
                        : customer.establishment?.kind === "BRANCH"
                          ? t("branch", { code: customer.establishment.code })
                          : DASH,
                  },
                ]}
              />
              {customer.taxIdChecksumValid === false ? (
                <Notice
                  tone="warning"
                  title={t("taxIdChecksumWarning")}
                  testId="customer-tax-id-warning"
                />
              ) : null}
            </DetailCard>
            {activity ? (
              <CustomerAliasesCard
                customerId={customer.customerId}
                aliases={activity.aliases}
                hasMoreAliases={activity.hasMoreAliases}
                canEdit={canManage && !archived}
              />
            ) : null}
            {customer.notes ? (
              <DetailCard title={t("sectionNotes")}>
                <p className="text-sm wrap-anywhere whitespace-pre-line text-text">
                  {customer.notes}
                </p>
              </DetailCard>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

type LinkedProductItem = {
  readonly productId: Id<"finishedGoodsProducts">;
  readonly sku: string;
  readonly name: string;
  readonly unit: string;
  readonly status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  readonly warehouseId: Id<"warehouses">;
  readonly warehouseName: string;
  readonly customerReference?: string;
  readonly totalQuantity?: number;
};

type CustomerJobPage = NonNullable<
  Extract<
    FunctionReturnType<typeof api.customers.linking.listCustomerJobsPage>,
    { ok: true }
  >["value"]
>;
type CustomerJob = CustomerJobPage["items"][number];

function CustomerPageControls({
  onPrevious,
  onNext,
  nextLabel,
}: {
  readonly onPrevious: (() => void) | undefined;
  readonly onNext: (() => void) | undefined;
  readonly nextLabel: string;
}) {
  const t = useTranslations("Customers");
  return (
    <div className="flex flex-wrap gap-2">
      {onPrevious ? (
        <Button type="button" size="sm" variant="outline" onClick={onPrevious}>
          {t("previousPage")}
        </Button>
      ) : null}
      {onNext ? (
        <Button type="button" size="sm" variant="outline" onClick={onNext}>
          {nextLabel}
        </Button>
      ) : null}
    </div>
  );
}

function CustomerJobsCard({
  customerId,
  initialJobs,
  hasMoreInitial,
}: {
  readonly customerId: Id<"customers">;
  readonly initialJobs: readonly CustomerJob[];
  readonly hasMoreInitial: boolean;
}) {
  const t = useTranslations("Customers");
  const format = useFormatter();
  const [cursors, setCursors] = useState<(string | null)[]>([]);
  const cursor = cursors.at(-1);
  const outcome = useQuery(
    api.customers.linking.listCustomerJobsPage,
    cursor !== undefined
      ? { customerId, ...(cursor ? { cursor } : {}) }
      : "skip",
  );
  const page = outcome?.ok ? outcome.value : undefined;
  const loading = cursor !== undefined && outcome === undefined;
  const jobs =
    cursor === undefined
      ? initialJobs
      : page?.canViewWarehouseData
        ? page.items
        : [];
  const nextCursor =
    cursor === undefined
      ? hasMoreInitial
        ? null
        : undefined
      : page?.canViewWarehouseData && !page.isDone
        ? page.continueCursor || undefined
        : undefined;
  return (
    <DetailCard title={t("sectionRecentJobs")}>
      {loading ? (
        <LedgerPanelStatus state={{ kind: "LOADING" }} />
      ) : outcome && !outcome.ok ? (
        <LedgerPanelStatus
          state={{ kind: "DENIED", requestId: outcome.denial.requestId }}
        />
      ) : jobs.length === 0 ? (
        <p className="text-sm text-muted">
          {t(
            nextCursor !== undefined
              ? "recentJobsOutsidePreview"
              : "noLinkedJobs",
          )}
        </p>
      ) : (
        <>
          <div className="hidden sm:block">
            <TableScroller
              label={t("sectionRecentJobs")}
              testId="customer-recent-jobs"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colJobNo")}</TableHead>
                    <TableHead>{t("colPart")}</TableHead>
                    <TableHead>{t("colWarehouse")}</TableHead>
                    <TableHead>{t("colScannedAt")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.jobScanId}>
                      <TableCell className="font-mono text-xs text-text">
                        {job.factoryOrder}
                      </TableCell>
                      <TableCell className="text-xs wrap-anywhere text-text">
                        {job.partName ?? (
                          <span className="text-muted">{DASH}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted">
                        {job.warehouseName}
                      </TableCell>
                      <TableCell className="text-xs text-muted tabular-nums">
                        {format.dateTime(job.createdAt, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroller>
          </div>
          <ul
            className="divide-y divide-border sm:hidden"
            data-testid="customer-recent-jobs-mobile"
          >
            {jobs.map((job) => (
              <li
                key={job.jobScanId}
                className="flex items-baseline justify-between gap-2 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="block font-mono text-xs font-medium text-text">
                    {job.factoryOrder}
                  </span>
                  <span className="block text-xs wrap-anywhere text-muted">
                    {[job.partName, job.warehouseName]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted tabular-nums">
                  {format.dateTime(job.createdAt, {
                    dateStyle: "short",
                  })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <CustomerPageControls
        onPrevious={
          cursors.length > 0
            ? () => setCursors(cursors.slice(0, -1))
            : undefined
        }
        onNext={
          nextCursor !== undefined
            ? () => setCursors([...cursors, nextCursor])
            : undefined
        }
        nextLabel={t(cursor === undefined ? "browseLinkedJobs" : "nextPage")}
      />
    </DetailCard>
  );
}

function CustomerProductsCard({
  customerId,
  initialProducts,
  hasMoreInitial,
}: {
  readonly customerId: Id<"customers">;
  readonly initialProducts: readonly LinkedProductItem[];
  readonly hasMoreInitial: boolean;
}) {
  const t = useTranslations("Customers");
  const format = useFormatter();
  const [cursors, setCursors] = useState<(string | null)[]>([]);
  const cursor = cursors.at(-1);
  const outcome = useQuery(
    api.customers.linking.listCustomerProductsPage,
    cursor !== undefined
      ? { customerId, pageSize: 100, ...(cursor ? { cursor } : {}) }
      : "skip",
  );
  const page = outcome?.ok ? outcome.value : undefined;
  const loading = cursor !== undefined && outcome === undefined;
  const products =
    cursor === undefined
      ? initialProducts
      : page?.canViewWarehouseData
        ? page.items
        : [];
  const nextCursor =
    cursor === undefined
      ? hasMoreInitial
        ? null
        : undefined
      : page?.canViewWarehouseData && !page.isDone
        ? page.continueCursor || undefined
        : undefined;
  return (
    <DetailCard
      title={
        products.length === 0
          ? t("sectionProducts")
          : cursor === undefined && hasMoreInitial
            ? t("sectionProductsCountMore", { count: products.length })
            : t("sectionProductsCount", { count: products.length })
      }
    >
      {loading ? (
        <LedgerPanelStatus state={{ kind: "LOADING" }} />
      ) : outcome && !outcome.ok ? (
        <LedgerPanelStatus
          state={{
            kind: "DENIED",
            requestId: outcome.denial.requestId,
          }}
        />
      ) : products.length === 0 && nextCursor === undefined ? (
        <p className="text-sm text-muted">{t("noLinkedProducts")}</p>
      ) : (
        <>
          {products.length > 0 ? (
            <ul
              className="divide-y divide-border"
              data-testid="customer-linked-products"
            >
              {products.map((product) => (
                <li key={product.productId}>
                  <Link
                    href={productPath(product.productId, product.warehouseId)}
                    className="-mx-2 flex min-h-touch items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-raised focus-visible:outline-2 focus-visible:outline-link"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium wrap-anywhere text-text">
                        {product.name}
                      </span>
                      <span className="block text-xs text-muted">
                        <span className="font-mono">{product.sku}</span>
                        {product.warehouseName
                          ? ` · ${product.warehouseName}`
                          : null}
                      </span>
                    </span>
                    {product.totalQuantity !== undefined ? (
                      <span className="shrink-0 text-xs text-muted tabular-nums">
                        {t("inStock", {
                          quantity: format.number(product.totalQuantity),
                          unit: product.unit,
                        })}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p
              className="text-sm text-muted"
              data-testid="customer-products-empty-page"
            >
              {t("productsEmptyPage")}
            </p>
          )}
        </>
      )}
      <CustomerPageControls
        onPrevious={
          cursors.length > 0
            ? () => setCursors(cursors.slice(0, -1))
            : undefined
        }
        onNext={
          nextCursor !== undefined
            ? () => setCursors([...cursors, nextCursor])
            : undefined
        }
        nextLabel={t(
          cursor === undefined ? "browseLinkedProducts" : "nextPage",
        )}
      />
    </DetailCard>
  );
}

function CustomerAliasesCard({
  customerId,
  aliases,
  hasMoreAliases,
  canEdit,
}: {
  readonly customerId: Id<"customers">;
  readonly aliases: readonly {
    readonly aliasId: Id<"customerAliases">;
    readonly alias: string;
    readonly approvedAt: number;
  }[];
  readonly hasMoreAliases: boolean;
  readonly canEdit: boolean;
}) {
  const t = useTranslations("Customers");
  const addAlias = useMutation(api.customers.linking.addCustomerAlias);
  const removeAlias = useMutation(api.customers.linking.removeCustomerAlias);
  const identity = useSubmissionIdentity();
  const operation = useAsyncOperation({
    scope: `customer-aliases:${customerId}`,
    describeError: () => "UNKNOWN",
    navigation: "write",
  });
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pagingActive, setPagingActive] = useState(false);
  const [aliasCursors, setAliasCursors] = useState<string[]>([]);
  const [pagingCustomerId, setPagingCustomerId] = useState(customerId);
  if (pagingCustomerId !== customerId) {
    setPagingCustomerId(customerId);
    setPagingActive(false);
    setAliasCursors([]);
  }
  const activeAliasCursor = aliasCursors.at(-1);
  const aliasPageOutcome = useQuery(
    api.customers.linking.listCustomerAliasesPage,
    pagingActive
      ? {
          customerId,
          pageSize: 100,
          ...(activeAliasCursor ? { cursor: activeAliasCursor } : {}),
        }
      : "skip",
  );
  const loadingPage = pagingActive && aliasPageOutcome === undefined;
  const aliasPageDenied =
    pagingActive && aliasPageOutcome !== undefined && !aliasPageOutcome.ok;
  const pagedAliases = aliasPageOutcome?.ok ? aliasPageOutcome.value : null;
  const visibleAliases = pagingActive ? (pagedAliases?.items ?? []) : aliases;
  const hasPrevious = pagingActive && aliasCursors.length > 0;
  const hasMore = pagingActive
    ? Boolean(
        pagedAliases && !pagedAliases.isDone && pagedAliases.continueCursor,
      )
    : hasMoreAliases;

  useNavigationDraft({
    dirty: canEdit && draft.trim().length > 0,
    pending: operation.busy,
    discard: () => {
      setDraft("");
      setError(null);
    },
  });

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (operation.busy) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    setError(null);
    const { requestId } = identity.request(`add:${trimmed}`, undefined);
    await operation.run(
      async () => addAlias({ requestId, customerId, alias: trimmed }),
      (outcome) => {
        identity.clear();
        if (!outcome || typeof outcome !== "object" || !("ok" in outcome)) {
          setError(t("errors.UNKNOWN"));
          return;
        }
        if (!outcome.ok) {
          setError(t("errors.DENIED"));
          return;
        }
        if (!outcome.value.ok) {
          if (outcome.value.code === "DUPLICATE_KEY")
            setError(t("aliasDuplicate"));
          else if (outcome.value.code === "ALIAS_CONFLICT")
            setError(t("aliasConflict"));
          else if (outcome.value.code === "ALIAS_CAPACITY")
            setError(t("aliasCapacity"));
          else if (outcome.value.code === "FIELD_INVALID")
            setError(t("aliasInvalid"));
          else setError(t("errors.UNKNOWN"));
          return;
        }
        setDraft("");
      },
    );
  }

  async function handleRemove(aliasId: Id<"customerAliases">) {
    if (operation.busy) return;
    setError(null);
    const { requestId } = identity.request(`remove:${aliasId}`, undefined);
    await operation.run(
      async () => removeAlias({ requestId, aliasId }),
      (outcome) => {
        identity.clear();
        if (!outcome || typeof outcome !== "object" || !("ok" in outcome)) {
          setError(t("errors.UNKNOWN"));
          return;
        }
        if (!outcome.ok) {
          setError(t("errors.DENIED"));
          return;
        }
        if (!outcome.value.ok) setError(t("errors.UNKNOWN"));
      },
    );
  }

  const displayError = error ?? (operation.error ? t("errors.UNKNOWN") : null);

  return (
    <DetailCard title={t("sectionAliases")}>
      {loadingPage ? (
        <LedgerPanelStatus state={{ kind: "LOADING" }} label={t("loading")} />
      ) : aliasPageDenied ? (
        <LedgerPanelStatus
          state={{
            kind: "DENIED",
            requestId: aliasPageOutcome.denial.requestId,
          }}
        />
      ) : visibleAliases.length > 0 ? (
        <ul
          className="flex flex-wrap gap-2"
          data-testid="customer-aliases-list"
        >
          {visibleAliases.map((item) => (
            <li
              key={item.aliasId}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-raised px-2.5 py-1 text-xs text-text"
            >
              <span className="wrap-anywhere">{item.alias}</span>
              {canEdit ? (
                <button
                  type="button"
                  disabled={operation.busy}
                  aria-label={t("aliasRemove", { alias: item.alias })}
                  onClick={() => void handleRemove(item.aliasId)}
                  className="-mr-1 inline-flex size-5 items-center justify-center rounded text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-link"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : hasPrevious || hasMore ? (
        <p
          className="text-sm text-muted"
          data-testid="customer-aliases-empty-page"
        >
          {t("aliasesEmptyPage")}
        </p>
      ) : (
        <p className="text-sm text-muted">{t("noAliases")}</p>
      )}
      {!pagingActive && hasMoreAliases ? (
        <div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setPagingActive(true);
              setAliasCursors([]);
            }}
          >
            {t("loadMoreAliases")}
          </Button>
        </div>
      ) : pagingActive && (hasPrevious || hasMore) ? (
        <div className="flex flex-wrap items-center gap-2">
          {hasPrevious ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loadingPage}
              onClick={() => setAliasCursors((current) => current.slice(0, -1))}
              data-testid="customer-aliases-previous"
            >
              {t("previousPage")}
            </Button>
          ) : null}
          {hasMore && pagedAliases?.continueCursor ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loadingPage}
              onClick={() =>
                setAliasCursors((current) => [
                  ...current,
                  pagedAliases.continueCursor,
                ])
              }
              data-testid="customer-aliases-next"
            >
              {t("nextPage")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted">{t("aliasHint")}</p>
      {displayError ? (
        <Notice tone="danger" role="alert" title={displayError} />
      ) : null}
      {canEdit ? (
        <form
          onSubmit={(event) => void handleAdd(event)}
          className="flex gap-2"
        >
          <Input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError(null);
            }}
            placeholder={t("aliasPlaceholder")}
            aria-label={t("aliasPlaceholder")}
            maxLength={200}
            disabled={operation.busy}
            className="min-w-0 flex-1"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={operation.busy || !draft.trim()}
          >
            <Plus aria-hidden="true" className="size-4" />
            {operation.busy ? t("aliasAdding") : t("aliasAdd")}
          </Button>
        </form>
      ) : null}
    </DetailCard>
  );
}

function DetailCard({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="min-w-0 space-y-3 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={id} className="text-lg leading-7 font-semibold text-text">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Archive or restore, confirmed in the shared dialog that owns its Back entry. */
function LifecycleAction({
  customer,
}: {
  readonly customer: CustomerDetailRow;
}) {
  const t = useTranslations("Customers");
  const archive = useMutation(api.customers.writes.archiveCustomer);
  const restore = useMutation(api.customers.writes.restoreCustomer);
  // The confirmation keeps what it was opened for: the status and version
  // shown then. A live update while it is open or closing changes neither.
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState({
    archived: customer.status === "ARCHIVED",
    version: customer.version,
  });
  const [failure, setFailure] = useState<CustomerWriteFailure>();
  const identity = useSubmissionIdentity();
  const operation = useAsyncOperation({
    scope: `customer-lifecycle:${customer.customerId}`,
    describeError: () => "UNKNOWN",
    navigation: "write",
  });
  const archived = open ? target.archived : customer.status === "ARCHIVED";
  async function confirm() {
    if (operation.busy) return;
    setFailure(undefined);
    const args = {
      customerId: customer.customerId,
      expectedVersion: target.version,
    };
    await operation.run(
      async () =>
        (archived ? restore : archive)({
          ...args,
          requestId: identity.request(
            JSON.stringify({ archived, ...args }),
            undefined,
          ).requestId,
        }),
      (outcome) => {
        // An answered attempt never reuses its identity.
        identity.clear();
        const result = readCustomerWrite(outcome);
        if (!result.ok) setFailure(result.failure);
        else operation.complete(() => setOpen(false));
      },
    );
  }
  const error =
    failure !== undefined
      ? t(`errors.${failure.code}`)
      : operation.error
        ? t("errors.UNKNOWN")
        : null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setFailure(undefined);
          setTarget({
            archived: customer.status === "ARCHIVED",
            version: customer.version,
          });
          setOpen(true);
        }}
      >
        {archived ? (
          <ArchiveRestore aria-hidden="true" className="size-4" />
        ) : (
          <Archive aria-hidden="true" className="size-4" />
        )}
        {archived ? t("restore") : t("archive")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={
          archived
            ? t("restoreTitle", { name: customer.name })
            : t("archiveTitle", { name: customer.name })
        }
        description={archived ? t("restoreBody") : t("archiveBody")}
        error={error}
        cancelLabel={t("cancel")}
        confirmLabel={archived ? t("restore") : t("archive")}
        pendingLabel={archived ? t("restoring") : t("archiving")}
        pending={operation.busy}
        onConfirm={() => void confirm()}
        testId="customer-lifecycle-dialog"
      />
    </>
  );
}
