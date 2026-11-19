"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Mail,
  MapPin,
  PencilLine,
  Phone,
  Plus,
  User,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { NAVIGATION_PERMISSION } from "../../../convex/model/authorization/navigationPermissions";
import { useNavigationDraft } from "@/components/navigation/navigationDraft";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { CollectionToolbar } from "@/components/system/CollectionToolbar";
import { CursorPagination } from "@/components/system/CursorPagination";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DescriptionList } from "@/components/ui/DescriptionList";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { SelectControl } from "@/components/ui/SelectControl";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
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
import { useCan } from "@/hooks/useCan";
import { useCatalogueSync } from "@/hooks/useCatalogueSync";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import {
  useDebouncedSearch,
  useScanContinuation,
} from "@/hooks/useScanContinuation";
import { Link, useRouter } from "@/i18n/navigation";
import { customerEditPath, customerPath, ROUTES } from "@/lib/navigation";
import { completeTask, returnFromTask } from "@/lib/taskNavigation";
import {
  customerInput,
  draftFromCustomer,
  EMPTY_CUSTOMER_DRAFT,
  sectionFilled,
  sectionForField,
  taxIdDigits,
  taxIdState,
  type CustomerDraft,
  type CustomerDraftField,
  type CustomerSection,
} from "./customerDraft";
import {
  useCustomerCatalogueState,
  type CustomerStatusFilter,
} from "./useCustomerCatalogueState";
import { readCustomerWrite, type CustomerWriteFailure } from "./customerWrites";

const MANAGE = NAVIGATION_PERMISSION.customerManage;
const DASH = "—";

type CustomerDetailRow = Omit<Doc<"customers">, "codeSequenceKey"> & {
  readonly customerId: Id<"customers">;
  readonly taxIdChecksumValid?: boolean;
};

/* List ---------------------------------------------------------------- */

export function CustomerCatalogue() {
  const t = useTranslations("Customers");
  return (
    <QueryGate scope="ORG" loadingLabel={t("loading")}>
      {() => <CatalogueContent />}
    </QueryGate>
  );
}

export function NewCustomerAction() {
  const t = useTranslations("Customers");
  if (!useCan(MANAGE)) return null;
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
  const canManage = useCan(MANAGE);
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
  useCatalogueSync({
    outcome,
    continuation: scan,
    paging,
    resetKey: JSON.stringify(criteria),
    hasRows: (value) => Boolean(value.page?.length),
  });
  const ready = outcome?.ok && outcome.value.status === "ready";
  const failed = Boolean(
    outcome && (!outcome.ok || outcome.value.status === "reset"),
  );
  const customers = ready ? outcome.value.page : [];
  const filtered = settled.trim() !== "" || filters.status !== "ACTIVE";
  const clear = () => update({ search: "", status: "ACTIVE" });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <CollectionToolbar
          value={filters.search}
          onValueChange={(search) => update({ ...filters, search })}
          searchLabel={t("search")}
          clearLabel={t("clearSearch")}
          actions={<NewCustomerAction />}
        />
        <SelectControl
          value={filters.status}
          onValueChange={(status) =>
            update({ ...filters, status: status as CustomerStatusFilter })
          }
          options={[
            { value: "ACTIVE", label: t("statusActive") },
            { value: "ARCHIVED", label: t("statusArchived") },
            { value: "ALL", label: t("statusAll") },
          ]}
          label={t("statusFilter")}
          placeholder={t("statusFilter")}
          emptyLabel={t("statusActive")}
        />
      </div>
      {failed ? (
        <Notice
          tone="danger"
          role="alert"
          title={t("loadError")}
          body={t("loadErrorBody")}
        />
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
                            className="font-medium break-words text-text hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-link"
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
                        <div className="mt-0.5 font-mono text-xs text-muted">
                          {customer.code}
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        {customer.deliveryAddress?.province ?? (
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
                      <span className="font-medium break-words text-text">
                        {customer.name}
                      </span>
                      {customer.status === "ARCHIVED" ? (
                        <StatusBadge tone="muted" label={t("statusArchived")} />
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      <span className="font-mono">{customer.code}</span>
                      {customer.deliveryAddress?.province
                        ? ` · ${customer.deliveryAddress.province}`
                        : null}
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

/* Detail -------------------------------------------------------------- */

export function CustomerDetail({
  customerId,
}: {
  readonly customerId: string;
}) {
  const t = useTranslations("Customers");
  return (
    <QueryGate scope="ORG" loadingLabel={t("loadingCustomer")}>
      {() => <CustomerQuery customerId={customerId} page="detail" />}
    </QueryGate>
  );
}

export function EditCustomerForm({
  customerId,
}: {
  readonly customerId: string;
}) {
  const t = useTranslations("Customers");
  return (
    <QueryGate scope="ORG" loadingLabel={t("loadingCustomer")}>
      {() => <CustomerQuery customerId={customerId} page="edit" />}
    </QueryGate>
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
  const canManage = useCan(MANAGE);
  const archived = customer.status === "ARCHIVED";
  const address = customer.deliveryAddress;
  const contact = customer.contact;
  const addressLines = [
    address?.line,
    [address?.subdistrict, address?.district].filter(Boolean).join(" "),
    [address?.province, address?.postcode].filter(Boolean).join(" "),
  ].filter((line): line is string => Boolean(line));
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
          <DetailCard title={t("sectionDelivery")}>
            {address?.label ? (
              <p className="font-medium text-text">{address.label}</p>
            ) : null}
            {addressLines.length > 0 ? (
              <p className="flex gap-2 text-sm text-text">
                <MapPin
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-muted"
                />
                <span>
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
              {contact?.name || contact?.phone || contact?.email ? (
                <div className="space-y-1 text-sm">
                  {contact.name ? (
                    <p className="flex items-center gap-2 text-text">
                      <User aria-hidden="true" className="size-4 text-muted" />
                      <span>
                        {contact.name}
                        {contact.role ? (
                          <span className="text-muted"> · {contact.role}</span>
                        ) : null}
                      </span>
                    </p>
                  ) : null}
                  {contact.phone ? (
                    <a
                      href={`tel:${contact.phone.replace(/[^\d+]/gu, "")}`}
                      className="-my-1 flex min-h-touch items-center gap-2 text-link hover:underline md:my-0 md:min-h-0"
                    >
                      <Phone aria-hidden="true" className="size-4" />
                      {contact.phone}
                    </a>
                  ) : null}
                  {contact.email ? (
                    <a
                      href={`mailto:${contact.email}`}
                      className="-my-1 flex min-h-touch items-center gap-2 break-all text-link hover:underline md:my-0 md:min-h-0"
                    >
                      <Mail aria-hidden="true" className="size-4" />
                      {contact.email}
                    </a>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted">{t("noContact")}</p>
              )}
            </div>
          </DetailCard>
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
        </div>
        {customer.notes ? (
          <DetailCard title={t("sectionNotes")}>
            <p className="text-sm whitespace-pre-line text-text">
              {customer.notes}
            </p>
          </DetailCard>
        ) : null}
      </div>
    </>
  );
}

function DetailCard({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="min-w-0 space-y-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id={id} className="text-lg leading-7 font-semibold text-text">
        {title}
      </h2>
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
          requestId: operation.request(JSON.stringify({ archived, ...args })),
        }),
      (outcome) => {
        const result = readCustomerWrite(outcome);
        if (!result.ok) setFailure(result.failure);
        else {
          operation.clearRequests();
          operation.complete(() => setOpen(false));
        }
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

/* Create and edit ------------------------------------------------------ */

export function NewCustomerForm() {
  const t = useTranslations("Customers");
  return (
    <>
      <PageHeader
        title={t("newTitle")}
        summary={t("newSummary")}
        breadcrumbs={[{ label: t("title"), href: ROUTES.customers }]}
      />
      <QueryGate scope="ORG">{() => <NewCustomerContent />}</QueryGate>
    </>
  );
}

function NewCustomerContent() {
  const create = useMutation(api.customers.writes.createCustomer);
  const suggestion = useQuery(api.customers.catalogue.suggestCustomerCode, {});
  return (
    <CustomerFormBody
      mode="create"
      initial={EMPTY_CUSTOMER_DRAFT}
      codeSuggestion={suggestion?.ok ? suggestion.value : undefined}
      submit={(draft, requestId) =>
        create({
          requestId,
          ...(draft.code.trim() === "" ? {} : { code: draft.code.trim() }),
          ...customerInput(draft),
        })
      }
    />
  );
}

function CustomerEditor({
  customer,
}: {
  readonly customer: CustomerDetailRow;
}) {
  const t = useTranslations("Customers");
  const update = useMutation(api.customers.writes.updateCustomer);
  // The editor owns the version it was opened at. A newer saved version
  // arriving while editing does not replace the draft; saving reports it.
  const [baseline, setBaseline] = useState(customer);
  const archived = customer.status === "ARCHIVED";
  const header = (
    <PageHeader
      title={t("editTitle")}
      breadcrumbs={[
        { label: t("title"), href: ROUTES.customers },
        { label: customer.name, href: customerPath(customer.customerId) },
      ]}
    />
  );
  if (archived)
    return (
      <>
        {header}
        <Notice
          tone="muted"
          title={t("archivedNotice")}
          body={t("archivedCannotEdit")}
          testId="customer-archived-edit"
        />
      </>
    );
  return (
    <>
      {header}
      <CustomerFormBody
        key={baseline.version}
        mode="edit"
        initial={draftFromCustomer(baseline)}
        customerId={customer.customerId}
        latestVersion={customer.version}
        onReloadLatest={() => setBaseline(customer)}
        submit={(draft, requestId) =>
          update({
            requestId,
            customerId: customer.customerId,
            expectedVersion: baseline.version,
            ...customerInput(draft),
          })
        }
      />
    </>
  );
}

const SECTION_ORDER: readonly CustomerSection[] = [
  "tax",
  "address",
  "contact",
  "notes",
];

function CustomerFormBody({
  mode,
  initial,
  codeSuggestion,
  customerId,
  latestVersion,
  onReloadLatest,
  submit,
}: {
  readonly mode: "create" | "edit";
  readonly initial: CustomerDraft;
  readonly codeSuggestion?: string | undefined;
  /** The customer being edited; a create form has none. */
  readonly customerId?: string;
  readonly latestVersion?: number;
  readonly onReloadLatest?: () => void;
  readonly submit: (
    draft: CustomerDraft,
    requestId: string,
  ) => Promise<unknown>;
}) {
  const t = useTranslations("Customers");
  const router = useRouter();
  const canManage = useCan(MANAGE);
  const { permissionsReady } = useWorkspace();
  const idPrefix = useId();
  const [draft, setDraft] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [failure, setFailure] = useState<CustomerWriteFailure>();
  const [openSections, setOpenSections] = useState<
    ReadonlySet<CustomerSection>
  >(
    () =>
      new Set(
        SECTION_ORDER.filter((section) => sectionFilled(initial, section)),
      ),
  );
  const nameRef = useRef<HTMLInputElement>(null);
  const operation = useAsyncOperation({
    scope: `customer-${mode}:${customerId ?? "new"}`,
    describeError: () => "UNKNOWN",
    navigation: "write",
  });
  useNavigationDraft({
    dirty,
    pending: operation.busy,
    discard: () => {
      setDraft(initial);
      setDirty(false);
      setFailure(undefined);
    },
  });
  const settledName = useDebouncedSearch(draft.name, 400);
  const similar = useQuery(
    api.customers.catalogue.findSimilarCustomers,
    mode === "create" && settledName.trim() !== ""
      ? { name: settledName }
      : "skip",
  );
  const matches = similar?.ok ? similar.value : [];
  const field = (name: CustomerDraftField) => ({
    id: `${idPrefix}-${name}`,
    value: draft[name],
    onChange: (event: { target: { value: string } }) => {
      setDraft((previous) => ({ ...previous, [name]: event.target.value }));
      setDirty(true);
    },
  });
  const fieldError = (prefix: string) =>
    failure?.code === "FIELD_INVALID" && failure.field?.startsWith(prefix)
      ? t(`fieldErrors.${failure.field.split(".")[0] ?? "generic"}`, {
          reason: failure.reason ?? "",
        })
      : undefined;
  const taxState = taxIdState(draft.taxId);
  const stale =
    mode === "edit" &&
    latestVersion !== undefined &&
    failure?.code === "VERSION_CONFLICT";

  async function save(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (operation.busy) return;
    if (draft.name.trim() === "") {
      setFailure({ code: "FIELD_INVALID", field: "name", reason: "EMPTY" });
      nameRef.current?.focus();
      return;
    }
    setFailure(undefined);
    await operation.run(
      async () => submit(draft, operation.request(JSON.stringify(draft))),
      (outcome) => {
        const result = readCustomerWrite(outcome);
        if (!result.ok) {
          setFailure(result.failure);
          const section = sectionForField(result.failure.field);
          if (section)
            setOpenSections((previous) => new Set([...previous, section]));
          return;
        }
        operation.clearRequests();
        setDirty(false);
        // Completion consumes the form's entry: Back from the customer
        // returns to wherever the form was opened from.
        operation.complete(() =>
          completeTask(customerPath(result.customerId), router.replace),
        );
      },
    );
  }

  // Cancel consumes the task and restores the real origin; a directly
  // opened form falls back to its parent: the list, or the customer.
  function cancel() {
    if (customerId === undefined)
      returnFromTask(ROUTES.customers, router.replace);
    else returnFromTask(customerPath(customerId), router.replace);
  }

  if (permissionsReady && !canManage)
    return (
      <div className="max-w-3xl space-y-3">
        <Notice tone="muted" title={t("viewOnly")} />
        <Button type="button" variant="outline" onClick={cancel}>
          {mode === "create" ? t("backToList") : t("backToCustomer")}
        </Button>
      </div>
    );

  const sectionBadge = (section: CustomerSection) => {
    const count = sectionFilled(draft, section);
    return count === 0 ? t("notProvided") : t("filledCount", { count });
  };
  const toggle = (section: CustomerSection) => (open: boolean) =>
    setOpenSections((previous) => {
      const next = new Set(previous);
      if (open) next.add(section);
      else next.delete(section);
      return next;
    });
  // Field refusals and a duplicate code are shown on their field; the rest
  // explain themselves above the action bar.
  const failureMessage =
    failure === undefined || failure.code === "DUPLICATE_KEY"
      ? undefined
      : failure.code === "FIELD_INVALID"
        ? failure.field === undefined
          ? t("errors.FIELD_INVALID")
          : undefined
        : t(`errors.${failure.code}`);

  return (
    <form
      onSubmit={save}
      noValidate
      className="min-w-0"
      data-testid="customer-form"
    >
      <div className="max-w-3xl space-y-4">
        <div className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <FormField
            id={`${idPrefix}-name`}
            label={t("name")}
            required
            hint={t("nameHint")}
            error={fieldError("name")}
          >
            {(props) => (
              <Input
                {...props}
                {...field("name")}
                ref={nameRef}
                autoComplete="off"
                maxLength={200}
              />
            )}
          </FormField>
          <FormField
            id={`${idPrefix}-code`}
            label={t("codeLabel")}
            hint={
              mode === "edit"
                ? t("codeFixedHint")
                : codeSuggestion
                  ? t("codeHint", { code: codeSuggestion })
                  : t("codeHintGeneric")
            }
            error={
              failure?.code === "DUPLICATE_KEY"
                ? t("errors.DUPLICATE_KEY")
                : fieldError("code")
            }
          >
            {(props) => (
              <Input
                {...props}
                {...field("code")}
                className={
                  mode === "edit"
                    ? "bg-raised font-mono text-muted"
                    : "font-mono"
                }
                placeholder={codeSuggestion}
                readOnly={mode === "edit"}
                autoComplete="off"
                maxLength={64}
              />
            )}
          </FormField>
          {matches.length > 0 ? (
            <Notice
              tone="warning"
              role="status"
              title={t("similarTitle")}
              body={t("similarBody")}
              className="sm:col-span-2"
              testId="customer-similar"
            >
              <ul className="mt-2 space-y-1">
                {matches.map((match) => (
                  <li
                    key={match.customerId}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="min-w-0 text-sm text-text">
                      {match.name}{" "}
                      <span className="font-mono text-xs text-muted">
                        {match.code}
                      </span>
                      {match.status === "ARCHIVED" ? (
                        <span className="text-xs text-muted">
                          {" "}
                          · {t("statusArchived")}
                        </span>
                      ) : null}
                    </span>
                    <Button asChild size="sm" variant="outline">
                      <Link href={customerPath(match.customerId)}>
                        {t("useThisCustomer")}
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </div>

        <CollapsibleSection
          label={t("sectionTax")}
          badge={sectionBadge("tax")}
          open={openSections.has("tax")}
          onToggle={toggle("tax")}
          testId="customer-section-tax"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id={`${idPrefix}-legalNameTh`}
              label={t("legalNameTh")}
              error={fieldError("legalNameTh")}
            >
              {(props) => (
                <Input {...props} {...field("legalNameTh")} maxLength={200} />
              )}
            </FormField>
            <FormField
              id={`${idPrefix}-legalNameEn`}
              label={t("legalNameEn")}
              error={fieldError("legalNameEn")}
            >
              {(props) => (
                <Input {...props} {...field("legalNameEn")} maxLength={200} />
              )}
            </FormField>
            <FormField
              id={`${idPrefix}-taxId`}
              label={t("taxId")}
              hint={
                taxState === "LENGTH"
                  ? t("taxIdLength", { count: taxIdDigits(draft.taxId).length })
                  : taxState === "CHECKSUM"
                    ? t("taxIdChecksumWarning")
                    : t("taxIdHint")
              }
              error={fieldError("taxId")}
            >
              {(props) => (
                <Input
                  {...props}
                  {...field("taxId")}
                  inputMode="numeric"
                  autoComplete="off"
                  className="font-mono"
                  maxLength={17}
                />
              )}
            </FormField>
            <EstablishmentField
              idPrefix={idPrefix}
              draft={draft}
              error={fieldError("establishment")}
              onChange={(change) => {
                setDraft((previous) => ({ ...previous, ...change }));
                setDirty(true);
              }}
            />
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          label={t("sectionAddress")}
          badge={sectionBadge("address")}
          open={openSections.has("address")}
          onToggle={toggle("address")}
          testId="customer-section-address"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["addressLabel", "addressLabel", 200, "sm:col-span-2"],
                ["addressLine", "addressLine", 200, "sm:col-span-2"],
                ["subdistrict", "subdistrict", 200, ""],
                ["district", "district", 200, ""],
                ["province", "province", 200, ""],
                ["postcode", "postcode", 10, ""],
              ] as const
            ).map(([name, label, max, span]) => (
              <FormField
                key={name}
                id={`${idPrefix}-${name}`}
                label={t(label)}
                className={span}
                error={fieldError(
                  `deliveryAddress.${name === "addressLabel" ? "label" : name === "addressLine" ? "line" : name}`,
                )}
              >
                {(props) => (
                  <Input
                    {...props}
                    {...field(name)}
                    maxLength={max}
                    {...(name === "postcode"
                      ? { inputMode: "numeric" as const }
                      : {})}
                  />
                )}
              </FormField>
            ))}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          label={t("sectionContact")}
          badge={sectionBadge("contact")}
          open={openSections.has("contact")}
          onToggle={toggle("contact")}
          testId="customer-section-contact"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id={`${idPrefix}-contactName`}
              label={t("contactName")}
              error={fieldError("contact.name")}
            >
              {(props) => (
                <Input {...props} {...field("contactName")} maxLength={200} />
              )}
            </FormField>
            <FormField
              id={`${idPrefix}-contactRole`}
              label={t("contactRole")}
              error={fieldError("contact.role")}
            >
              {(props) => (
                <Input {...props} {...field("contactRole")} maxLength={200} />
              )}
            </FormField>
            <FormField
              id={`${idPrefix}-phone`}
              label={t("phone")}
              error={fieldError("contact.phone")}
            >
              {(props) => (
                <Input
                  {...props}
                  {...field("phone")}
                  type="tel"
                  inputMode="tel"
                  maxLength={32}
                />
              )}
            </FormField>
            <FormField
              id={`${idPrefix}-email`}
              label={t("email")}
              error={fieldError("contact.email")}
            >
              {(props) => (
                <Input
                  {...props}
                  {...field("email")}
                  type="email"
                  inputMode="email"
                  maxLength={254}
                />
              )}
            </FormField>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          label={t("sectionNotes")}
          badge={sectionBadge("notes")}
          open={openSections.has("notes")}
          onToggle={toggle("notes")}
          testId="customer-section-notes"
        >
          <FormField
            id={`${idPrefix}-notes`}
            label={t("notes")}
            srOnlyLabel
            error={fieldError("notes")}
          >
            {(props) => (
              <textarea
                {...props}
                {...field("notes")}
                rows={4}
                maxLength={2000}
                className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-text focus-visible:outline-2 focus-visible:outline-ring"
              />
            )}
          </FormField>
        </CollapsibleSection>

        {stale ? (
          <Notice
            tone="warning"
            role="alert"
            title={t("errors.VERSION_CONFLICT")}
            body={t("versionConflictBody")}
            testId="customer-version-conflict"
          >
            {onReloadLatest ? (
              <Button
                type="button"
                variant="outline"
                className="mt-2"
                onClick={onReloadLatest}
              >
                {t("reloadLatest")}
              </Button>
            ) : null}
          </Notice>
        ) : failureMessage ? (
          <Notice
            tone="danger"
            role="alert"
            title={failureMessage}
            testId="customer-save-error"
          />
        ) : operation.error ? (
          <Notice
            tone="danger"
            role="alert"
            title={t("errors.UNKNOWN")}
            testId="customer-save-error"
          />
        ) : null}
      </div>
      <StickyActionBar className="border-t border-border px-3 py-3 md:px-4">
        <div className="flex max-w-3xl justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={operation.busy}
            onClick={cancel}
          >
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={operation.busy}>
            {operation.busy
              ? t("saving")
              : mode === "create"
                ? t("save")
                : t("saveChanges")}
          </Button>
        </div>
      </StickyActionBar>
    </form>
  );
}

function EstablishmentField({
  idPrefix,
  draft,
  error,
  onChange,
}: {
  readonly idPrefix: string;
  readonly draft: CustomerDraft;
  readonly error: string | undefined;
  readonly onChange: (change: Partial<CustomerDraft>) => void;
}) {
  const t = useTranslations("Customers");
  const options = [
    ["", t("unspecified")],
    ["HEAD_OFFICE", t("headOffice")],
    ["BRANCH", t("branchOption")],
  ] as const;
  const branchId = `${idPrefix}-branchCode`;
  return (
    <fieldset className="grid min-w-0 content-start gap-2">
      <legend className="mb-label text-xs leading-[1.125rem] font-medium text-text">
        {t("establishment")}
      </legend>
      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-raised p-1">
        {options.map(([value, label]) => (
          <label
            key={value || "none"}
            className="flex min-h-touch flex-1 cursor-pointer items-center justify-center rounded-md px-3 text-sm text-text has-[:checked]:bg-surface has-[:checked]:font-medium has-[:checked]:shadow-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring dense:min-h-control"
          >
            <input
              type="radio"
              name={`${idPrefix}-establishment`}
              value={value}
              checked={draft.establishment === value}
              onChange={() => onChange({ establishment: value })}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </div>
      {draft.establishment === "BRANCH" ? (
        <FormField
          id={branchId}
          label={t("branchCode")}
          hint={t("branchCodeHint")}
          error={error}
        >
          {(props) => (
            <Input
              {...props}
              value={draft.branchCode}
              onChange={(event) => onChange({ branchCode: event.target.value })}
              inputMode="numeric"
              maxLength={5}
              className="w-32 font-mono"
            />
          )}
        </FormField>
      ) : error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : null}
    </fieldset>
  );
}
