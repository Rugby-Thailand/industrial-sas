"use client";

import { useMutation, useQuery } from "convex/react";
import { Building2, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import {
  useDraftGuard,
  usePendingGuard,
} from "@/components/providers/draftGuard";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { hrRefs } from "@/lib/convex/hrApi";
import { FOCUS_TARGET_IDS } from "@/lib/navigation";

import {
  AddressFields,
  addressDraft,
  addressPayload,
  missingFields,
  REQUIRED_ADDRESS,
  optionalText,
  useRefusalFields,
  type AddressDraft,
  type AddressRow,
  type FieldErrors,
} from "./HrOrgShared";
import { HrQueryState, useHrError, WriteFeedback } from "./HrShared";
import { SettingsHeading } from "./HrSettingsHeading";
import { useHrWrite, type HrWriteState } from "./useHrWrite";

interface BankAccount {
  readonly bankName: string;
  readonly accountNo: string;
  readonly accountName?: string | undefined;
}
interface CompanyRow extends AddressRow {
  readonly id: string;
  readonly name: string;
  readonly nameEn?: string | undefined;
  readonly taxId: string;
  readonly phone?: string | undefined;
  readonly fax?: string | undefined;
  readonly hasLogo?: boolean | undefined;
  readonly bankAccounts: readonly BankAccount[];
  readonly version: number;
}
interface AccountDraft {
  readonly key: number;
  readonly bankName: string;
  readonly accountNo: string;
  readonly accountName: string;
}
interface Draft {
  name: string;
  nameEn: string;
  taxId: string;
  address: AddressDraft;
  phone: string;
  fax: string;
  accounts: AccountDraft[];
}
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
/** The server's decoded-size limit; checked here first for fast feedback. */
const LOGO_MAX_BYTES = 256 * 1024;

const draftOf = (row: CompanyRow | null): Draft => ({
  name: row?.name ?? "",
  nameEn: row?.nameEn ?? "",
  taxId: row?.taxId ?? "",
  address: addressDraft(row),
  phone: row?.phone ?? "",
  fax: row?.fax ?? "",
  accounts: (row?.bankAccounts ?? []).map((account, key) => ({
    key,
    bankName: account.bankName,
    accountNo: account.accountNo,
    accountName: account.accountName ?? "",
  })),
});

export function CompanyProfilePanel() {
  const t = useTranslations("Hr.settings");
  const id = useId();
  const outcome = useQuery(hrRefs.companyProfile, {});
  return (
    <Panel
      id={FOCUS_TARGET_IDS.company}
      aria-labelledby={`${id}-title`}
      className="space-y-4 xl:col-span-2"
    >
      <SettingsHeading
        id={`${id}-title`}
        icon={<Building2 aria-hidden="true" className="size-5" />}
        title={t("company")}
        description={t("companyIntro")}
      />
      <HrQueryState outcome={outcome}>
        {() => {
          const value = (outcome as { value?: { profile?: unknown } }).value;
          const profile = (value?.profile ?? null) as CompanyRow | null;
          return <CompanyForm titleId={`${id}-title`} profile={profile} />;
        }}
      </HrQueryState>
    </Panel>
  );
}

function CompanyForm({
  titleId,
  profile,
}: {
  readonly titleId: string;
  readonly profile: CompanyRow | null;
}) {
  const t = useTranslations("Hr.org");
  const form = useTranslations("Hr.form");
  const refusal = useRefusalFields();
  const id = useId();
  const save = useMutation(hrRefs.saveCompanyProfile);
  const [baseline, setBaseline] = useState(profile);
  const [initial, setInitial] = useState(() => draftOf(profile));
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  // One profile per organization: the "Saved" receipt outlives the live
  // refresh that follows its own save; the next edit starts a new command.
  const write = useHrWrite("org-company");
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const busy = write.locked;
  const reset = (row: CompanyRow | null) => {
    const next = draftOf(row);
    setBaseline(row);
    setInitial(next);
    setDraft(next);
    setErrors({});
  };
  // Another administrator's save replaces an untouched form; typed edits stay.
  if (
    !dirty &&
    !busy &&
    profile !== null &&
    profile.version > (baseline?.version ?? 0)
  )
    reset(profile);
  useDraftGuard(
    write.state.kind !== "SAVED" && dirty,
    () => reset(baseline),
    busy,
  );

  const set = <Key extends keyof Draft>(key: Key, value: Draft[Key]) => {
    if (write.state.kind === "SAVED") write.reset();
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const setAccount = (
    index: number,
    key: "bankName" | "accountNo" | "accountName",
    value: string,
  ) =>
    set(
      "accounts",
      draft.accounts.map((account, at) =>
        at === index ? { ...account, [key]: value } : account,
      ),
    );

  const validate = (): FieldErrors => {
    const next: Record<string, string> = missingFields(
      { name: draft.name, taxId: draft.taxId, ...draft.address },
      ["name", "taxId", ...REQUIRED_ADDRESS],
      t("required"),
    );
    if (next.taxId === undefined && !/^\d{13}$/.test(draft.taxId.trim()))
      next.taxId = t("taxIdInvalid");
    draft.accounts.forEach((account, index) => {
      if (account.bankName.trim() === "")
        next[`bankAccounts.${index}.bankName`] = t("required");
      if (account.accountNo.trim() === "")
        next[`bankAccounts.${index}.accountNo`] = t("required");
    });
    return next;
  };

  const send = async () => {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const nameEn = optionalText(draft.nameEn);
    const phone = optionalText(draft.phone);
    const fax = optionalText(draft.fax);
    finish(
      await write.submit((requestId) =>
        save({
          requestId,
          ...(baseline === null ? {} : { expectedVersion: baseline.version }),
          name: draft.name.trim(),
          ...(nameEn === undefined ? {} : { nameEn }),
          taxId: draft.taxId.trim(),
          ...addressPayload(draft.address),
          ...(phone === undefined ? {} : { phone }),
          ...(fax === undefined ? {} : { fax }),
          bankAccounts: draft.accounts.map((account) => {
            const accountName = optionalText(account.accountName);
            return {
              bankName: account.bankName.trim(),
              accountNo: account.accountNo.trim(),
              ...(accountName === undefined ? {} : { accountName }),
            };
          }),
        }),
      ),
    );
  };
  const finish = (result: HrWriteState<unknown>) => {
    if (result.kind === "SAVED") {
      // The saved values are the new baseline until the live row arrives.
      setInitial(draft);
    }
    setErrors(refusal(result));
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  const stale =
    write.state.kind === "REFUSED" &&
    write.state.code === "COMPANY_PROFILE_STALE";
  const accountsId = `${id}-accounts`;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby={titleId}
      className="space-y-5"
      data-testid="hr-company-form"
    >
      {baseline === null ? (
        <Notice
          tone="accent"
          title={t("companyMissing")}
          body={t("companyMissingHint")}
        />
      ) : null}
      <fieldset disabled={busy} className="space-y-5">
        <fieldset className="space-y-4">
          <legend className="mb-3 text-sm font-semibold text-text">
            {t("general")}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id={`${id}-name`}
              label={t("companyName")}
              required
              error={errors.name}
            >
              {(field) => (
                <Input
                  {...field}
                  value={draft.name}
                  maxLength={120}
                  autoComplete="organization"
                  onChange={(e) => set("name", e.target.value)}
                />
              )}
            </FormField>
            <FormField
              id={`${id}-name-en`}
              label={t("companyNameEn")}
              error={errors.nameEn}
            >
              {(field) => (
                <Input
                  {...field}
                  value={draft.nameEn}
                  maxLength={120}
                  autoComplete="off"
                  onChange={(e) => set("nameEn", e.target.value)}
                />
              )}
            </FormField>
            <FormField
              id={`${id}-tax`}
              label={t("taxId")}
              required
              hint={t("taxIdHint")}
              error={errors.taxId}
            >
              {(field) => (
                <Input
                  {...field}
                  value={draft.taxId}
                  inputMode="numeric"
                  maxLength={13}
                  autoComplete="off"
                  onChange={(e) => set("taxId", e.target.value)}
                />
              )}
            </FormField>
          </div>
        </fieldset>

        <fieldset className="space-y-4 border-t border-border pt-4">
          <legend className="float-left mb-3 w-full text-sm font-semibold text-text">
            {t("addressDetails")}
          </legend>
          <AddressFields
            id={`${id}-address`}
            value={draft.address}
            errors={errors}
            onChange={(key, value) =>
              set("address", { ...draft.address, [key]: value })
            }
          />
        </fieldset>

        <fieldset
          className="space-y-3 border-t border-border pt-4"
          aria-describedby={`${accountsId}-hint`}
        >
          <legend className="float-left w-full text-sm font-semibold text-text">
            {t("bankAccounts")}
          </legend>
          <p id={`${accountsId}-hint`} className="text-xs text-muted">
            {t("bankAccountsHint")}
          </p>
          {draft.accounts.length === 0 ? (
            <p className="text-sm text-muted">{t("noAccounts")}</p>
          ) : (
            <ol className="space-y-3">
              {draft.accounts.map((account, index) => (
                <li
                  key={account.key}
                  className="space-y-3 rounded-lg border border-border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-text">
                      {t("account", { number: index + 1 })}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("removeAccount", { number: index + 1 })}
                      onClick={() => {
                        // Account errors are keyed by position; a removed
                        // row would shift them onto its neighbours.
                        setErrors((current) =>
                          Object.fromEntries(
                            Object.entries(current).filter(
                              ([key]) => !key.startsWith("bankAccounts."),
                            ),
                          ),
                        );
                        set(
                          "accounts",
                          draft.accounts.filter((_, at) => at !== index),
                        );
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <FormField
                      id={`${accountsId}-${account.key}-bank`}
                      label={t("bankName")}
                      required
                      error={errors[`bankAccounts.${index}.bankName`]}
                    >
                      {(field) => (
                        <Input
                          {...field}
                          value={account.bankName}
                          maxLength={120}
                          onChange={(e) =>
                            setAccount(index, "bankName", e.target.value)
                          }
                        />
                      )}
                    </FormField>
                    <FormField
                      id={`${accountsId}-${account.key}-number`}
                      label={t("accountNo")}
                      required
                      error={errors[`bankAccounts.${index}.accountNo`]}
                    >
                      {(field) => (
                        <Input
                          {...field}
                          value={account.accountNo}
                          inputMode="numeric"
                          maxLength={120}
                          onChange={(e) =>
                            setAccount(index, "accountNo", e.target.value)
                          }
                        />
                      )}
                    </FormField>
                    <FormField
                      id={`${accountsId}-${account.key}-name`}
                      label={t("accountName")}
                      error={errors[`bankAccounts.${index}.accountName`]}
                    >
                      {(field) => (
                        <Input
                          {...field}
                          value={account.accountName}
                          maxLength={120}
                          onChange={(e) =>
                            setAccount(index, "accountName", e.target.value)
                          }
                        />
                      )}
                    </FormField>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              set("accounts", [
                ...draft.accounts,
                {
                  key:
                    Math.max(-1, ...draft.accounts.map((row) => row.key)) + 1,
                  bankName: "",
                  accountNo: "",
                  accountName: "",
                },
              ])
            }
          >
            <Plus aria-hidden="true" />
            {t("addAccount")}
          </Button>
        </fieldset>

        <fieldset className="space-y-4 border-t border-border pt-4">
          <legend className="float-left mb-3 w-full text-sm font-semibold text-text">
            {t("contact")}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id={`${id}-phone`}
              label={t("phone")}
              error={errors.phone}
            >
              {(field) => (
                <Input
                  {...field}
                  type="tel"
                  value={draft.phone}
                  maxLength={120}
                  autoComplete="tel"
                  onChange={(e) => set("phone", e.target.value)}
                />
              )}
            </FormField>
            <FormField id={`${id}-fax`} label={t("fax")} error={errors.fax}>
              {(field) => (
                <Input
                  {...field}
                  type="tel"
                  value={draft.fax}
                  maxLength={120}
                  autoComplete="off"
                  onChange={(e) => set("fax", e.target.value)}
                />
              )}
            </FormField>
            <CompanyLogoField id={`${id}-logo`} />
          </div>
        </fieldset>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy} data-testid="hr-company-save">
          {write.pending ? form("submitting") : t("saveCompany")}
        </Button>
        {stale && profile !== null ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              write.reset();
              reset(profile);
            }}
          >
            {t("reload")}
          </Button>
        ) : null}
      </div>
      <WriteFeedback
        state={write.state}
        onRetry={() => void write.retry().then(finish)}
      />
    </form>
  );
}

function base64Of(bytes: ArrayBuffer): string {
  let text = "";
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
  return btoa(text);
}

/**
 * The logo is its own command: choosing a file saves it at once and Remove
 * clears it, independent of unsaved profile text. The preview reads the
 * stored image only when the profile reports one.
 */
function CompanyLogoField({ id }: { readonly id: string }) {
  const t = useTranslations("Hr.org");
  const message = useHrError();
  const save = useMutation(hrRefs.saveCompanyLogo);
  const write = useHrWrite("org-logo");
  usePendingGuard(write.pending);
  // Read directly (it is small): a logo saved before the first profile
  // exists has no `hasLogo` flag to announce it.
  const outcome = useQuery(hrRefs.companyLogo, {}) as
    | { ok?: boolean; value?: { mimeType?: unknown; base64?: unknown } | null }
    | undefined;
  const stored = outcome?.ok === true ? outcome.value : undefined;
  const preview =
    typeof stored?.mimeType === "string" && typeof stored.base64 === "string"
      ? `data:${stored.mimeType};base64,${stored.base64}`
      : null;
  const [error, setError] = useState<string>();
  // Remounting the file input clears its chosen file.
  const [fileKey, setFileKey] = useState(0);
  const finish = (result: HrWriteState<unknown>) => {
    setError(
      result.kind === "REFUSED" && result.code.startsWith("LOGO_")
        ? message(result.code)
        : undefined,
    );
    if (result.kind !== "UNCERTAIN") setFileKey((key) => key + 1);
  };
  const choose = async (file: File | undefined) => {
    if (file === undefined) return;
    if (!LOGO_TYPES.includes(file.type) || file.size === 0) {
      setError(message("LOGO_FILE_INVALID"));
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setError(message("LOGO_TOO_LARGE"));
      return;
    }
    setError(undefined);
    const base64 = base64Of(await file.arrayBuffer());
    finish(
      await write.submit((requestId) =>
        save({ requestId, mimeType: file.type, base64 }),
      ),
    );
  };
  const remove = async () => {
    setError(undefined);
    finish(
      await write.submit((requestId) => save({ requestId, remove: true })),
    );
  };
  return (
    <FormField
      id={id}
      label={t("logo")}
      hint={t("logoHint")}
      error={error}
      className="sm:col-span-2"
    >
      {(field) => (
        <div className="grid gap-3">
          {preview === null ? null : (
            <div className="flex flex-wrap items-center gap-3">
              {/* A data URL from the stored bytes; no image optimisation applies. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt={t("logoCurrent")}
                className="h-16 w-auto max-w-48 rounded-md border border-border bg-surface object-contain p-1"
              />
              <Button
                type="button"
                variant="ghost"
                disabled={write.locked}
                onClick={() => void remove()}
              >
                {t("removeLogo")}
              </Button>
            </div>
          )}
          <Input
            {...field}
            key={fileKey}
            type="file"
            accept={LOGO_TYPES.join(",")}
            disabled={write.locked}
            onChange={(e) => void choose(e.target.files?.[0])}
          />
          <WriteFeedback
            // A refused file is explained once, beside the field.
            state={
              write.state.kind === "REFUSED" &&
              write.state.code.startsWith("LOGO_")
                ? { kind: "IDLE" }
                : write.state
            }
            onRetry={() => void write.retry().then(finish)}
          />
        </div>
      )}
    </FormField>
  );
}
