"use client";

import { useMutation, useQuery } from "convex/react";
import {
  Archive,
  ArchiveRestore,
  Mail,
  MapPin,
  PencilLine,
  Phone,
  User,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DescriptionList } from "@/components/ui/DescriptionList";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAsyncOperation } from "@/hooks/useAsyncOperation";
import { Link } from "@/i18n/navigation";
import { customerEditPath, customerPath, ROUTES } from "@/lib/navigation";
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
            <p className="text-sm wrap-anywhere whitespace-pre-line text-text">
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
