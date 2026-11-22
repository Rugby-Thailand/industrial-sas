"use client";

import { useAuth } from "@clerk/nextjs";

import { useMutation, useQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api } from "../../../convex/_generated/api";
import { useNavigationDraft } from "@/components/navigation/navigationDraft";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import { useAsyncOperation } from "@/hooks/useAsyncOperation";
import { useRouter } from "@/i18n/navigation";
import { customerPath, ROUTES } from "@/lib/navigation";
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
import { readCustomerWrite, type CustomerWriteFailure } from "./customerWrites";
import {
  CustomerGate,
  useCustomerAccess,
  useSubmissionIdentity,
} from "./customerAccess";
import type { CustomerDetailRow } from "./customerTypes";
import {
  reviewPrefillScope,
  clearReviewPrefillName,
  readReviewPrefillName,
} from "./reviewPrefill";
import { useDuplicateCheck } from "./useDuplicateCheck";

export function NewCustomerForm({
  initialName,
  prefillToken,
}: {
  readonly initialName?: string;
  readonly prefillToken?: string;
} = {}) {
  const t = useTranslations("Customers");
  return (
    <>
      <PageHeader
        title={t("newTitle")}
        summary={t("newSummary")}
        breadcrumbs={[{ label: t("title"), href: ROUTES.customers }]}
      />
      <CustomerGate loadingLabel={t("loading")}>
        <NewCustomerContent
          {...(initialName === undefined ? {} : { initialName })}
          {...(prefillToken === undefined ? {} : { prefillToken })}
        />
      </CustomerGate>
    </>
  );
}

function NewCustomerContent({
  initialName,
  prefillToken,
}: {
  readonly initialName?: string;
  readonly prefillToken?: string;
}) {
  const { userId, orgId } = useAuth();
  const scope = reviewPrefillScope(userId, orgId);
  const create = useMutation(api.customers.writes.createCustomer);
  // An optional hint: a failure falls back to the generic code hint (the
  // server allocates a code for a blank field) and never unmounts the form.
  const suggestion = useQueries({
    code: { query: api.customers.catalogue.suggestCustomerCode, args: {} },
  }).code as
    | FunctionReturnType<typeof api.customers.catalogue.suggestCustomerCode>
    | Error
    | undefined;
  const [resolvedInitialName] = useState(
    () => initialName ?? readReviewPrefillName(prefillToken, scope),
  );
  const initialDraft = resolvedInitialName
    ? { ...EMPTY_CUSTOMER_DRAFT, name: resolvedInitialName }
    : EMPTY_CUSTOMER_DRAFT;
  return (
    <CustomerFormBody
      mode="create"
      initial={initialDraft}
      {...(prefillToken === undefined
        ? {}
        : {
            onDisposePrefill: () => clearReviewPrefillName(prefillToken, scope),
          })}
      codeSuggestion={
        suggestion instanceof Error || !suggestion?.ok
          ? undefined
          : suggestion.value
      }
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

export function CustomerEditor({
  customer,
}: {
  readonly customer: CustomerDetailRow;
}) {
  const t = useTranslations("Customers");
  const update = useMutation(api.customers.writes.updateCustomer);
  // The editor owns the version it was opened at. A newer saved version
  // that changed an editable field does not replace the draft; saving
  // reports the conflict. One that changed none (an archive and restore
  // elsewhere) only moves the expected version, keeping the draft savable.
  const [baseline, setBaseline] = useState(customer);
  const [formKey, setFormKey] = useState(0);
  if (
    customer.version !== baseline.version &&
    sameEditableFields(customer, baseline)
  )
    setBaseline(customer);
  // A live archive never unmounts the editor: an unsaved draft stays until
  // its owner saves after restoring, or discards it explicitly.
  const archived = customer.status === "ARCHIVED";
  return (
    <>
      <PageHeader
        title={t("editTitle")}
        breadcrumbs={[
          { label: t("title"), href: ROUTES.customers },
          { label: customer.name, href: customerPath(customer.customerId) },
        ]}
      />
      <CustomerFormBody
        key={formKey}
        mode="edit"
        initial={draftFromCustomer(baseline)}
        customerId={customer.customerId}
        latestVersion={customer.version}
        // Reload is offered once the newer saved version has arrived, so it
        // never "reloads" the version that just conflicted.
        {...(customer.version !== baseline.version
          ? {
              onReloadLatest: () => {
                setBaseline(customer);
                setFormKey((key) => key + 1);
              },
            }
          : {})}
        blockedReason={archived ? t("archivedCannotEdit") : undefined}
        expectedVersion={baseline.version}
        submit={(draft, requestId, expectedVersion) =>
          update({
            requestId,
            customerId: customer.customerId,
            expectedVersion: expectedVersion ?? baseline.version,
            ...customerInput(draft),
          })
        }
      />
    </>
  );
}

function sameEditableFields(
  left: CustomerDetailRow,
  right: CustomerDetailRow,
): boolean {
  return (
    JSON.stringify(draftFromCustomer(left)) ===
    JSON.stringify(draftFromCustomer(right))
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
  onDisposePrefill,
  codeSuggestion,
  customerId,
  latestVersion,
  onReloadLatest,
  blockedReason,
  expectedVersion,
  submit,
}: {
  readonly mode: "create" | "edit";
  readonly initial: CustomerDraft;
  readonly onDisposePrefill?: () => void;
  readonly codeSuggestion?: string | undefined;
  /** The customer being edited; a create form has none. */
  readonly customerId?: string;
  readonly latestVersion?: number;
  readonly onReloadLatest?: () => void;
  /** Why saving cannot succeed right now (an archived customer); the draft stays. */
  readonly blockedReason?: string | undefined;
  /** The version an edit expects; frozen per submission with its request ID. */
  readonly expectedVersion?: number;
  readonly submit: (
    draft: CustomerDraft,
    requestId: string,
    expectedVersion: number | undefined,
  ) => Promise<unknown>;
}) {
  const t = useTranslations("Customers");
  const router = useRouter();
  const access = useCustomerAccess();
  const identity = useSubmissionIdentity();
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
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
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
  const duplicates = useDuplicateCheck(mode === "create", draft.name);
  const currentName = draft.name.trim();
  const matches = duplicates.matches;
  const field = (name: CustomerDraftField) => ({
    id: `${idPrefix}-${name}`,
    value: draft[name],
    onChange: (event: { target: { value: string } }) => {
      setDraft((previous) => ({ ...previous, [name]: event.target.value }));
      setDirty(true);
      // A Save-time answer belongs to the name it checked; editing the name
      // retires it, so it can never come back for a later, equal name.
      if (name === "name") duplicates.forget();
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

  async function save(
    event?: FormEvent<HTMLFormElement>,
    options: { readonly skipDuplicateCheck?: boolean } = {},
  ) {
    event?.preventDefault();
    if (operation.busy || blockedReason !== undefined) return;
    if (currentName === "") {
      setFailure({ code: "FIELD_INVALID", field: "name", reason: "EMPTY" });
      nameRef.current?.focus();
      return;
    }
    setFailure(undefined);
    // Matches already on screen for this exact name count as reviewed; a
    // name the hint has not checked yet is checked before creating.
    // Skipping is honored only for the name whose check failed.
    const skip =
      options.skipDuplicateCheck === true &&
      failure?.code === "DUPLICATE_CHECK_FAILED" &&
      failure.name === currentName;
    const unchecked = mode === "create" && !skip && !duplicates.answered;
    const submitted = draft;
    await operation.run(
      async () => {
        if (unchecked) {
          // No answer is not "no duplicates": keep the draft and let the
          // person retry, or save without the check on purpose.
          const check = await duplicates.lookup(currentName);
          if (check.kind === "failed") return { lookupFailed: true } as const;
          if (check.kind === "found")
            return { duplicates: check.matches } as const;
        }
        // The form may have closed while the check ran; a closed form
        // never starts a write.
        if (!mounted.current) return { abandoned: true } as const;
        // A retry resends the first attempt's exact command, including the
        // version it expected, never a rebased one under the same ID.
        // The identity follows the command actually sent (trimmed values,
        // the create code), so drafts that send the same command share it.
        const command = identity.request(
          JSON.stringify([
            mode === "create" ? submitted.code.trim() : null,
            customerInput(submitted),
          ]),
          expectedVersion,
        );
        return {
          written: await submit(submitted, command.requestId, command.frozen),
        } as const;
      },
      (attempt) => {
        if ("abandoned" in attempt) return;
        if ("lookupFailed" in attempt) {
          // Bound to this exact name: changing it restores the normal check.
          setFailure({ code: "DUPLICATE_CHECK_FAILED", name: currentName });
          return;
        }
        if ("duplicates" in attempt) {
          duplicates.remember(currentName, attempt.duplicates);
          return;
        }
        // An answered attempt never reuses its identity.
        identity.clear();
        const result = readCustomerWrite(attempt.written);
        if (!result.ok) {
          setFailure(result.failure);
          const section = sectionForField(result.failure.field);
          if (section)
            setOpenSections((previous) => new Set([...previous, section]));
          return;
        }
        setDirty(false);
        onDisposePrefill?.();
        // Completion consumes the form's entry: Back from the customer
        // returns to wherever the form was opened from.
        operation.complete(() =>
          completeTask(customerPath(result.customerId), router.replace),
        );
      },
    );
  }

  // Choosing an existing customer ends this task like a save does: the
  // draft guard asks before discarding, then the customer replaces the form's
  // entry, so Back returns to wherever the form was opened from.
  function openExisting(existingId: string) {
    onDisposePrefill?.();
    void operation.run(
      async () => existingId,
      (chosen) =>
        operation.complete(() =>
          completeTask(customerPath(chosen), router.replace),
        ),
    );
  }

  // Cancel consumes the task and restores the real origin; a directly
  // opened form falls back to its parent: the list, or the customer.
  function cancel() {
    onDisposePrefill?.();
    if (customerId === undefined)
      returnFromTask(ROUTES.customers, router.replace);
    else returnFromTask(customerPath(customerId), router.replace);
  }

  // The form mounts only once the server has said who may manage customers.
  if (!access.ready)
    return (
      <LedgerPanelStatus state={{ kind: "LOADING" }} label={t("loading")} />
    );
  if (!access.canManage)
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
    failure === undefined ||
    failure.code === "DUPLICATE_KEY" ||
    (failure.code === "DUPLICATE_CHECK_FAILED" && failure.name !== currentName)
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
      {/* A pending save freezes the submitted values: an edit typed after
          Save could otherwise look saved when the form completes. */}
      <fieldset
        disabled={operation.busy}
        className="max-w-3xl min-w-0 space-y-4"
      >
        {blockedReason ? (
          <Notice
            tone="warning"
            role="status"
            title={t("archivedNotice")}
            body={blockedReason}
            testId="customer-archived-edit"
          />
        ) : null}
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
              className="min-w-0 sm:col-span-2"
              testId="customer-similar"
            >
              <ul className="divide-y divide-border">
                {matches.map((match) => (
                  <li
                    key={match.customerId}
                    // Phones stack the action under the identity; sm+ puts it
                    // beside, and long names or codes wrap rather than push it.
                    className="flex flex-col items-start gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <span className="min-w-0 sm:flex-1">
                      <span className="block text-sm font-medium wrap-anywhere text-text">
                        {match.name}
                      </span>
                      <span className="mt-1 block text-xs wrap-anywhere text-muted">
                        <span className="font-mono">{match.code}</span>
                        {match.status === "ARCHIVED"
                          ? ` · ${t("statusArchived")}`
                          : null}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="max-w-full"
                      onClick={() => openExisting(match.customerId)}
                    >
                      {t("useThisCustomer")}
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
          >
            {failure?.code === "DUPLICATE_CHECK_FAILED" ? (
              // The person, not a failed lookup, decides to create without
              // the duplicate check. Duplicate names are allowed.
              <Button
                type="button"
                variant="outline"
                className="mt-2"
                onClick={() =>
                  void save(undefined, { skipDuplicateCheck: true })
                }
              >
                {t("saveWithoutCheck")}
              </Button>
            ) : null}
          </Notice>
        ) : operation.error ? (
          <Notice
            tone="danger"
            role="alert"
            title={t("errors.UNKNOWN")}
            testId="customer-save-error"
          />
        ) : null}
      </fieldset>
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
          <Button
            type="submit"
            disabled={operation.busy || blockedReason !== undefined}
          >
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
