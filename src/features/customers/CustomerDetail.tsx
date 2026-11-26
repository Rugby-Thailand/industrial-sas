"use client";

import { useMutation, useQuery } from "convex/react";
import { Archive, ArchiveRestore, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAsyncOperation } from "@/hooks/useAsyncOperation";
import { useNavigationDraft } from "@/components/navigation/navigationDraft";
import { customerPath, ROUTES } from "@/lib/navigation";
import { readCustomerWrite, type CustomerWriteFailure } from "./customerWrites";
import { CustomerGate, useSubmissionIdentity } from "./customerAccess";
import { CustomerEditor } from "./CustomerForm";
import { CustomerDetailCard } from "./CustomerDetailCard";
import type { CustomerDetailRow } from "./customerTypes";

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
      <CustomerQuery customerId={customerId} />
    </CustomerGate>
  );
}

function CustomerQuery({ customerId }: { readonly customerId: string }) {
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
        <PageHeader
          title={missing ? t("notFoundTitle") : t("editTitle")}
          breadcrumbs={[
            { label: t("title"), href: ROUTES.customers },
            { label: t("detailTitle"), href: customerPath(customerId) },
          ]}
        />
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
  return <CustomerEditor key={customerId} customer={customer} />;
}

export function CustomerAliasesCard({
  customerId,
  canEdit,
}: {
  readonly customerId: Id<"customers">;
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
  const [aliasCursors, setAliasCursors] = useState<string[]>([]);
  const activeAliasCursor = aliasCursors.at(-1);
  const aliasPageOutcome = useQuery(
    api.customers.linking.listCustomerAliasesPage,
    {
      customerId,
      ...(activeAliasCursor ? { cursor: activeAliasCursor } : {}),
    },
  );
  const loadingPage = aliasPageOutcome === undefined;
  const aliasPageDenied =
    aliasPageOutcome !== undefined && !aliasPageOutcome.ok;
  const pagedAliases = aliasPageOutcome?.ok ? aliasPageOutcome.value : null;
  const visibleAliases = pagedAliases?.items ?? [];
  const hasPrevious = aliasCursors.length > 0;
  const hasMore = Boolean(
    pagedAliases && !pagedAliases.isDone && pagedAliases.continueCursor,
  );

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
    <CustomerDetailCard title={t("sectionAliases")}>
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
      {hasPrevious || hasMore ? (
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
    </CustomerDetailCard>
  );
}

/** Archive or restore, confirmed in the shared dialog that owns its Back entry. */
export function LifecycleAction({
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
