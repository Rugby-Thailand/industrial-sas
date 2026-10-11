"use client";

import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import {
  useDraftGuard,
  usePendingGuard,
} from "@/components/providers/draftGuard";
import { Button } from "@/components/ui/button";
import { CheckboxControl } from "@/components/ui/CheckboxControl";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { SelectControl } from "@/components/ui/SelectControl";
import type { RefValue } from "@/lib/convex/clientRef";
import { hrRefs } from "@/lib/convex/hrApi";
import { guardedNavigate } from "@/lib/navigationGuard";
import type {
  AccountType,
  PolicyCapability,
  PolicyConfig,
} from "../../../convex/model/hr/policy";
import { validatePolicy } from "../../../convex/model/hr/policy";

import {
  HrInlineError,
  HrQueryState,
  SectionTitle,
  WriteFeedback,
} from "./HrShared";
import { useHrWrite } from "./useHrWrite";

type Policy = RefValue<typeof hrRefs.policyCurrent>;
type ReadyPolicy = Extract<Policy, { ok: true }>;
const LEAVE_FIELDS = [
  "annualDays",
  "firstYearAnnualDays",
  "sickPaidDays",
  "personalDays",
  "maternityDays",
  "maternityPaidDays",
  "spouseDays",
  "newbornCareDays",
  "newbornCarePayPercent",
  "militaryPaidDays",
] as const;

/** Company settings are drafts until HR explicitly activates the saved version. */
export function HrPolicySettings() {
  const t = useTranslations("Hr.policy");
  const [capability, setCapability] = useState<PolicyCapability>("LEAVE");
  const id = useId();
  const outcome = useQuery(hrRefs.policyCurrent, { capability });
  return (
    <Panel className="space-y-4 xl:col-span-2">
      <SectionTitle>{t("title")}</SectionTitle>
      <p className="text-sm text-muted">{t("summary")}</p>
      <FormField id={id} label={t("capability")}>
        {(field) => (
          <SelectControl
            id={field.id}
            value={capability}
            options={["LEAVE", "ANNOUNCEMENTS", "PAYSLIPS"].map((value) => ({
              value,
              label: t(value),
            }))}
            placeholder={t("capability")}
            emptyLabel={t("capability")}
            onValueChange={(value) =>
              guardedNavigate(() => setCapability(value as PolicyCapability))
            }
            className="sm:max-w-sm"
          />
        )}
      </FormField>
      <HrQueryState outcome={outcome}>
        {() =>
          outcome?.ok ? (
            outcome.value.ok ? (
              <PolicyEditor
                key={capability}
                policy={outcome.value}
                capability={capability}
              />
            ) : (
              <HrInlineError code={outcome.value.code} />
            )
          ) : null
        }
      </HrQueryState>
    </Panel>
  );
}

function PolicyEditor({
  policy,
  capability,
}: {
  readonly policy: ReadyPolicy;
  readonly capability: PolicyCapability;
}) {
  const t = useTranslations("Hr.policy");
  const id = useId();
  const save = useMutation(hrRefs.savePolicyDraft);
  const activate = useMutation(hrRefs.activatePolicy);
  const write = useHrWrite(`policy-draft:${capability}`);
  const activating = useHrWrite(`policy-activate:${capability}`);
  const [baseline, setBaseline] = useState(policy.draft);
  const [config, setConfig] = useState<PolicyConfig>(policy.draft.config);
  const [effectiveDate, setDate] = useState(policy.draft.effectiveDate);
  const [coverageConfirmed, setCoverage] = useState(false);
  const [existingBenefitsReviewed, setBenefits] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const dirty =
    JSON.stringify(config) !== JSON.stringify(baseline.config) ||
    effectiveDate !== baseline.effectiveDate;
  const locked = write.locked || activating.locked;
  const reset = () => {
    setConfig(policy.draft.config);
    setDate(policy.draft.effectiveDate);
    setBaseline(policy.draft);
    setInvalid(false);
    write.reset();
  };
  useDraftGuard(dirty, reset, write.pending || activating.pending);
  usePendingGuard(activating.pending);
  const saveDraft = async () => {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) ||
      validatePolicy(config) !== null
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const snapshot = { config: { ...config }, effectiveDate };
    const result = await write.submit((requestId) =>
      save({
        requestId,
        capability,
        expectedVersion: baseline.version,
        ...snapshot,
      }),
    );
    if (result.kind === "SAVED") {
      activating.reset();
      setBaseline({
        ...baseline,
        ...snapshot,
        version:
          typeof result.value.version === "number"
            ? result.value.version
            : baseline.version + 1,
      });
    }
  };
  const fields =
    capability === "LEAVE"
      ? LEAVE_FIELDS
      : capability === "PAYSLIPS"
        ? (["verificationMinutes", "downloadSeconds"] as const)
        : [];
  return (
    <div className="space-y-5">
      <Notice
        tone={policy.active ? "success" : "warning"}
        title={
          policy.active
            ? t("active", { version: policy.active.version })
            : t("inactive")
        }
      />
      <p className="max-w-prose text-sm text-muted">
        {t(capability === "LEAVE" ? "legalHint" : "companyHint")}
      </p>
      {capability === "LEAVE" ? (
        <p className="max-w-prose text-xs text-muted">{t("countingHint")}</p>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void saveDraft();
        }}
        noValidate
        className="space-y-4"
      >
        <fieldset
          disabled={locked}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <FormField id={`${id}-effective`} label={t("effectiveDate")} required>
            {(field) => (
              <Input
                {...field}
                type="date"
                value={effectiveDate}
                onChange={(event) => setDate(event.target.value)}
              />
            )}
          </FormField>
          {fields.map((field) => (
            <FormField
              key={field}
              id={`${id}-${field}`}
              label={t(field)}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={
                    field === "verificationMinutes"
                      ? 2
                      : field === "downloadSeconds"
                        ? 1
                        : 0
                  }
                  max={
                    field === "newbornCarePayPercent"
                      ? 100
                      : field === "verificationMinutes"
                        ? 15
                        : field === "downloadSeconds"
                          ? 60
                          : 366
                  }
                  step={1}
                  value={config[field]}
                  onChange={(event) =>
                    setConfig((previous) => ({
                      ...previous,
                      [field]: Number(event.target.value),
                    }))
                  }
                />
              )}
            </FormField>
          ))}
          {capability === "ANNOUNCEMENTS" ? (
            <>
              <FormField
                id={`${id}-audience`}
                label={t("announcementAudience")}
              >
                {(field) => (
                  <SelectControl
                    id={field.id}
                    value={config.announcementAudience}
                    options={["ORGANIZATION", "SITE"].map((value) => ({
                      value,
                      label: t(value),
                    }))}
                    placeholder={t("announcementAudience")}
                    emptyLabel={t("announcementAudience")}
                    onValueChange={(value) =>
                      setConfig((previous) => ({
                        ...previous,
                        announcementAudience: value as "ORGANIZATION" | "SITE",
                      }))
                    }
                  />
                )}
              </FormField>
              <label className="flex min-h-touch items-center gap-3 text-sm">
                <CheckboxControl
                  checked={config.announcementAcknowledgment}
                  onChange={(event) =>
                    setConfig((previous) => ({
                      ...previous,
                      announcementAcknowledgment: event.target.checked,
                    }))
                  }
                />
                {t("announcementAcknowledgment")}
              </label>
            </>
          ) : null}
          {capability === "PAYSLIPS" ? (
            <label className="flex min-h-touch items-center gap-3 text-sm">
              <CheckboxControl
                checked={config.requireFileHash}
                onChange={(event) =>
                  setConfig((previous) => ({
                    ...previous,
                    requireFileHash: event.target.checked,
                  }))
                }
              />
              {t("requireFileHash")}
            </label>
          ) : null}
        </fieldset>
        {invalid ? (
          <Notice tone="danger" role="alert" title={t("invalid")} />
        ) : null}
        <WriteFeedback
          state={write.state}
          onRetry={() =>
            void write.retry().then((result) => {
              if (result.kind === "SAVED")
                setBaseline({
                  ...baseline,
                  config: { ...config },
                  effectiveDate,
                  version:
                    typeof result.value.version === "number"
                      ? result.value.version
                      : baseline.version + 1,
                });
            })
          }
        />
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            disabled={locked || (!dirty && baseline.version > 0)}
          >
            {write.pending ? t("saving") : t("save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={locked || !dirty}
            onClick={reset}
          >
            {t("cancel")}
          </Button>
        </div>
      </form>
      {capability === "LEAVE" ? <OpeningBalances policy={policy} /> : null}
      <section
        className="space-y-3 border-t border-border pt-4"
        aria-labelledby={`${id}-readiness`}
      >
        <h3 id={`${id}-readiness`} className="font-semibold text-text">
          {t("readiness")}
        </h3>
        {policy.blockers.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {policy.blockers.map((blocker) => (
              <li key={blocker}>
                {t.has(`blockers.${blocker.split(":")[0]}`)
                  ? t(`blockers.${blocker.split(":")[0]}`, {
                      detail: blocker.split(":").slice(1).join(" · "),
                    })
                  : blocker}
              </li>
            ))}
          </ul>
        ) : null}
        {dirty ? (
          <p className="text-sm text-muted">{t("dirtyActivate")}</p>
        ) : baseline.version === 0 ? (
          <p className="text-sm text-muted">{t("policyMissing")}</p>
        ) : null}
        <label className="flex min-h-touch items-start gap-3 text-sm">
          <CheckboxControl
            disabled={locked}
            checked={coverageConfirmed}
            onChange={(event) => setCoverage(event.target.checked)}
          />
          {t("coverageConfirmed")}
        </label>
        <label className="flex min-h-touch items-start gap-3 text-sm">
          <CheckboxControl
            disabled={locked}
            checked={existingBenefitsReviewed}
            onChange={(event) => setBenefits(event.target.checked)}
          />
          {t("benefitsReviewed")}
        </label>
        <Button
          disabled={
            locked ||
            activating.state.kind === "SAVED" ||
            dirty ||
            baseline.version === 0 ||
            !coverageConfirmed ||
            !existingBenefitsReviewed ||
            policy.blockers.length > 0
          }
          onClick={() =>
            void activating.submit((requestId) =>
              activate({
                requestId,
                capability,
                expectedVersion: baseline.version,
                coverageConfirmed,
                existingBenefitsReviewed,
              }),
            )
          }
        >
          {t("activate")}
        </Button>
        <WriteFeedback
          state={activating.state}
          onRetry={() => void activating.retry()}
        />
      </section>
      <details className="text-sm">
        <summary className="min-h-touch cursor-pointer text-link">
          {t("sources")}
        </summary>
        <ul className="space-y-2">
          {policy.sources.map((source) => (
            <li key={source.url}>
              <a
                className="text-link underline underline-offset-4"
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                {source.title}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function OpeningBalances({ policy }: { readonly policy: ReadyPolicy }) {
  const t = useTranslations("Hr.policy");
  const leave = useTranslations("Hr.leave");
  const id = useId();
  const [employeeId, setEmployee] = useState(policy.employees[0]?.id ?? "");
  const [type, setType] = useState<AccountType>("ANNUAL");
  const employee = policy.employees.find((item) => item.id === employeeId);
  const account = employee?.accounts.find((item) => item.type === type);
  return (
    <details className="rounded-lg border border-border p-4">
      <summary className="min-h-touch cursor-pointer font-semibold text-text">
        {t("opening")}
      </summary>
      {policy.employees.length === 0 ? (
        <p className="text-sm text-muted">{t("noEmployees")}</p>
      ) : (
        <div className="space-y-4 pt-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id={`${id}-employee`} label={t("employee")}>
              {(field) => (
                <SelectControl
                  id={field.id}
                  value={employeeId}
                  options={policy.employees.map((item) => ({
                    value: item.id,
                    label: `${item.code} · ${item.displayName}`,
                  }))}
                  placeholder={t("employee")}
                  emptyLabel={t("noEmployees")}
                  onValueChange={(value) =>
                    guardedNavigate(() => setEmployee(value))
                  }
                />
              )}
            </FormField>
            <FormField id={`${id}-type`} label={t("type")}>
              {(field) => (
                <SelectControl
                  id={field.id}
                  value={type}
                  options={["ANNUAL", "SICK", "PERSONAL", "MILITARY"].map(
                    (value) => ({ value, label: leave(`types.${value}`) }),
                  )}
                  placeholder={t("type")}
                  emptyLabel={t("type")}
                  onValueChange={(value) =>
                    guardedNavigate(() => setType(value as AccountType))
                  }
                />
              )}
            </FormField>
          </div>
          {employee ? (
            <OpeningEditor
              key={`${employeeId}-${type}`}
              employeeId={employeeId}
              type={type}
              account={account}
              effectiveDate={policy.draft.effectiveDate}
            />
          ) : null}
        </div>
      )}
    </details>
  );
}

type OpeningAccount = ReadyPolicy["employees"][number]["accounts"][number];
function OpeningEditor({
  employeeId,
  type,
  account,
  effectiveDate,
}: {
  readonly employeeId: string;
  readonly type: AccountType;
  readonly account: OpeningAccount | undefined;
  readonly effectiveDate: string;
}) {
  const t = useTranslations("Hr.policy");
  const id = useId();
  const save = useMutation(hrRefs.reconcileLeaveOpening);
  const write = useHrWrite(`opening:${employeeId}:${type}`);
  const initial = {
    asOf: account?.asOf ?? effectiveDate,
    granted: account ? String(account.granted) : "",
    used: account ? String(account.used) : "",
    reserved: account ? String(account.reserved) : "",
    paidUsed: account ? String(account.paidUsed) : "",
    paidReserved: account ? String(account.paidReserved) : "",
    sourceReference: account?.sourceReference ?? "",
    baseGrant:
      account?.baseGrant === undefined ? "" : String(account.baseGrant),
  };
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [version, setVersion] = useState(account?.version ?? 0);
  const [invalid, setInvalid] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useDraftGuard(dirty, () => setDraft(baseline), write.pending);
  const change = (field: keyof typeof draft, value: string) => {
    if (write.state.kind === "SAVED") write.reset();
    setDraft((previous) => ({ ...previous, [field]: value }));
  };
  const submit = async () => {
    const numbers = {
      granted: Number(draft.granted),
      used: Number(draft.used),
      reserved: Number(draft.reserved),
      paidUsed: Number(draft.paidUsed),
      paidReserved: Number(draft.paidReserved),
    };
    if (
      !draft.asOf ||
      (type === "ANNUAL" &&
        (draft.baseGrant === "" ||
          !Number.isInteger(Number(draft.baseGrant)) ||
          Number(draft.baseGrant) < 0)) ||
      draft.sourceReference.trim().length < 3 ||
      [
        draft.granted,
        draft.used,
        draft.reserved,
        draft.paidUsed,
        draft.paidReserved,
      ].some((value) => value === "") ||
      Object.values(numbers).some(
        (value) => !Number.isInteger(value) || value < 0,
      )
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const sent = { ...draft };
    const result = await write.submit((requestId) =>
      save({
        requestId,
        employeeId,
        type,
        expectedVersion: version,
        asOf: draft.asOf,
        sourceReference: draft.sourceReference.trim(),
        ...numbers,
        ...(type === "ANNUAL" ? { baseGrant: Number(draft.baseGrant) } : {}),
      }),
    );
    if (result.kind === "SAVED") {
      setBaseline(sent);
      setVersion(
        typeof result.value.version === "number"
          ? result.value.version
          : version + 1,
      );
    }
  };
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="space-y-3"
    >
      <fieldset disabled={write.locked} className="grid gap-3 sm:grid-cols-3">
        <FormField id={`${id}-asof`} label={t("asOf")} required>
          {(field) => (
            <Input
              {...field}
              type="date"
              value={draft.asOf}
              onChange={(event) => change("asOf", event.target.value)}
            />
          )}
        </FormField>
        {(
          ["granted", "used", "reserved", "paidUsed", "paidReserved"] as const
        ).map((key) => (
          <FormField key={key} id={`${id}-${key}`} label={t(key)} required>
            {(field) => (
              <Input
                {...field}
                type="number"
                min={0}
                step={1}
                value={draft[key]}
                onChange={(event) => change(key, event.target.value)}
              />
            )}
          </FormField>
        ))}
        {type === "ANNUAL" ? (
          <FormField
            id={`${id}-baseGrant`}
            label={t("baseGrant")}
            hint={t("baseGrantHint")}
            required
          >
            {(field) => (
              <Input
                {...field}
                type="number"
                min={0}
                step={1}
                value={draft.baseGrant}
                onChange={(event) => change("baseGrant", event.target.value)}
              />
            )}
          </FormField>
        ) : null}
        <FormField
          id={`${id}-source`}
          label={t("sourceReference")}
          required
          className="sm:col-span-3"
        >
          {(field) => (
            <Input
              {...field}
              value={draft.sourceReference}
              maxLength={300}
              onChange={(event) =>
                change("sourceReference", event.target.value)
              }
            />
          )}
        </FormField>
      </fieldset>
      {invalid ? (
        <Notice tone="danger" role="alert" title={t("invalid")} />
      ) : null}
      <Button
        type="submit"
        disabled={write.locked || write.state.kind === "SAVED"}
      >
        {t("reconcile")}
      </Button>
      <WriteFeedback
        state={write.state}
        onRetry={() =>
          void write.retry().then((result) => {
            if (result.kind === "SAVED") {
              setBaseline(draft);
              setVersion(
                typeof result.value.version === "number"
                  ? result.value.version
                  : version + 1,
              );
            }
          })
        }
      />
    </form>
  );
}
