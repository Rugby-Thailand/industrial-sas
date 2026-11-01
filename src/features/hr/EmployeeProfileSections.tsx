"use client";

import { useMutation, useQuery } from "convex/react";
import { Pencil } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { useDraftGuard } from "@/components/providers/draftGuard";
import { Button } from "@/components/ui/button";
import { DescriptionList } from "@/components/ui/DescriptionList";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogCompletionHandle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/Notice";
import { SelectControl } from "@/components/ui/SelectControl";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { hrRefs } from "@/lib/convex/hrApi";

import { formatBusinessDate, formatDateTime } from "./format";
import {
  RadioFieldset,
  useDialogCompletion,
  useRefusalFields,
  type FieldErrors,
} from "./HrOrgShared";
import { SectionTitle, WriteFeedback } from "./HrShared";
import { useHrWrite, type HrWriteState } from "./useHrWrite";

export type EmploymentState =
  "PROBATION" | "ACTIVE" | "INACTIVE" | "RESIGNED" | "TERMINATED";

const STATE_TONE: Readonly<Record<EmploymentState, BadgeTone>> = {
  PROBATION: "warning",
  ACTIVE: "success",
  INACTIVE: "muted",
  RESIGNED: "muted",
  TERMINATED: "danger",
};

/** The truthful employment state, shared by the registry and the profile. */
export function EmploymentStateBadge({
  state,
}: {
  readonly state: EmploymentState;
}) {
  const t = useTranslations("Hr.employeeProfile");
  return <StatusBadge tone={STATE_TONE[state]} label={t(`state.${state}`)} />;
}

const PERSONAL = [
  "title",
  "firstName",
  "lastName",
  "firstNameEn",
  "lastNameEn",
  "nickname",
  "gender",
  "birthDate",
  "nationalId",
  "nationality",
  "religion",
  "maritalStatus",
] as const;
const CONTACT = [
  "email",
  "phone",
  "lineId",
  "address",
  "province",
  "postalCode",
] as const;
const EMERGENCY = [
  "emergencyName",
  "emergencyRelationship",
  "emergencyPhone",
] as const;
type ProfileKey =
  | (typeof PERSONAL)[number]
  | (typeof CONTACT)[number]
  | (typeof EMERGENCY)[number];
type ProfileValues = Partial<Record<ProfileKey, string>>;

interface PaymentValues {
  readonly method: "BANK" | "CASH";
  readonly bankName?: string;
  readonly accountNumber?: string;
  readonly accountMasked?: string;
  readonly accountName?: string;
  readonly bankBranchCode?: string;
}

interface LifecycleEvent {
  readonly id: string;
  readonly type:
    "PROBATION_CONFIRMED" | "RESIGNED" | "TERMINATED" | "REINSTATED";
  readonly effectiveDate: string;
  readonly reason?: string;
  readonly recordedAt: number;
  readonly recordedByName: string | null;
}
interface Lifecycle {
  readonly today: string | null;
  readonly state: EmploymentState;
  readonly version: number;
  readonly employmentStartDate: string;
  readonly latestEffectiveDate?: string;
  readonly firstEffectiveDate?: string;
  readonly probationEndDate?: string;
  readonly probationConfirmedDate?: string;
  readonly separation?: {
    readonly type: "RESIGNATION" | "TERMINATION";
    readonly lastWorkingDate: string;
    readonly reason: string;
  };
  readonly complete: boolean;
  readonly events: readonly LifecycleEvent[];
}

type LifecycleKind = "CONFIRM_PROBATION" | "OFFBOARD" | "REINSTATE";
/** The foreground editor; one shared Back-aware Dialog hosts each of them. */
type Target = "personal" | "contact" | "payment" | LifecycleKind;

/** A loaded `{ ok: true, ... }` answer, or undefined while loading/refused. */
function answer<Value>(outcome: unknown): Value | undefined {
  const result = outcome as
    | { readonly ok?: boolean; readonly value?: { readonly ok?: boolean } }
    | undefined;
  return result?.ok === true && result.value?.ok === true
    ? (result.value as Value)
    : undefined;
}

/**
 * The employee's lifecycle, personal, contact and payment details below the
 * employment editor. Each section is read-only until its Edit action opens
 * the shared Dialog, which owns its history entry and its draft: Back or
 * Cancel asks before discarding typed changes, a pending save blocks
 * dismissal, and a save consumes the entry before the Dialog closes.
 */
export function EmployeeProfileSections({
  employeeId,
}: {
  readonly employeeId: string;
}) {
  const identity = useHrAccess().identityKey ?? "anonymous";
  return (
    <EmployeeProfileSession
      key={`${identity}:${employeeId}`}
      employeeId={employeeId}
    />
  );
}

/** Actor/tenant/employee changes invalidate private editor state and callbacks. */
function EmployeeProfileSession({
  employeeId,
}: {
  readonly employeeId: string;
}) {
  const t = useTranslations("Hr.employeeProfile");
  const profileOutcome = useQuery(hrRefs.employeeProfile, { employeeId });
  const paymentOutcome = useQuery(hrRefs.employeePayment, { employeeId });
  const lifecycleOutcome = useQuery(hrRefs.employeeLifecycle, { employeeId });
  const profile = answer<{ profile: ProfileValues; version: number }>(
    profileOutcome,
  );
  const payment = answer<{ payment: PaymentValues | null; version: number }>(
    paymentOutcome,
  );
  const lifecycle = answer<Lifecycle>(lifecycleOutcome);
  const [target, setTarget] = useState<{
    kind: Target;
    profile: typeof profile;
    payment: typeof payment;
    lifecycle: typeof lifecycle;
  } | null>(null);
  // Forward reopens the editor this entry belonged to.
  const last = useRef<Target>("personal");
  // A section owns the exact snapshot/version it opened with. Live query
  // refreshes update summaries and stale feedback, never this session owner.
  const open = (next: Target) => {
    last.current = next;
    setTarget({ kind: next, profile, payment, lifecycle });
  };
  const busy = target !== null;
  return (
    <div className="space-y-4" data-testid="hr-employee-profile">
      {lifecycle === undefined ? null : (
        <LifecycleSection
          lifecycle={lifecycle}
          disabled={busy}
          onAction={open}
        />
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileCard
          title={t("personal")}
          editLabel={t("editPersonal")}
          disabled={busy || profile === undefined}
          onEdit={() => open("personal")}
          testId="hr-employee-personal"
        >
          <ProfileSummary
            keys={PERSONAL}
            values={profile?.profile}
            empty={t("noPersonal")}
          />
        </ProfileCard>
        <ProfileCard
          title={t("contact")}
          editLabel={t("editContact")}
          disabled={busy || profile === undefined}
          onEdit={() => open("contact")}
          testId="hr-employee-contact"
        >
          <ProfileSummary
            keys={CONTACT}
            values={profile?.profile}
            empty={t("noContact")}
          />
          <h4 className="pt-2 text-sm font-semibold text-text">
            {t("emergency")}
          </h4>
          <ProfileSummary
            keys={EMERGENCY}
            values={profile?.profile}
            empty={t("noEmergency")}
          />
        </ProfileCard>
        <ProfileCard
          title={t("payment")}
          editLabel={t("editPayment")}
          disabled={busy || payment === undefined}
          onEdit={() => open("payment")}
          testId="hr-employee-payment"
        >
          <PaymentSummary payment={payment?.payment} />
        </ProfileCard>
      </div>
      <SectionDialog
        target={target?.kind ?? null}
        employeeId={employeeId}
        profile={target?.profile}
        payment={target?.payment}
        lifecycle={target?.lifecycle}
        currentVersion={
          target?.kind === "personal" || target?.kind === "contact"
            ? profile?.version
            : target?.kind === "payment"
              ? payment?.version
              : lifecycle?.version
        }
        onOpenChange={(next) => (next ? open(last.current) : setTarget(null))}
      />
    </div>
  );
}

function ProfileCard({
  title,
  editLabel,
  disabled,
  onEdit,
  testId,
  children,
}: {
  readonly title: string;
  readonly editLabel: string;
  readonly disabled: boolean;
  readonly onEdit: () => void;
  readonly testId: string;
  readonly children: ReactNode;
}) {
  const t = useTranslations("Hr.employeeProfile");
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-3">
        <SectionTitle>
          <span id={id}>{title}</span>
        </SectionTitle>
        <Button
          type="button"
          variant="outline"
          onClick={onEdit}
          disabled={disabled}
          aria-label={editLabel}
        >
          <Pencil aria-hidden="true" />
          {t("edit")}
        </Button>
      </div>
      {children}
    </section>
  );
}

function ProfileSummary({
  keys,
  values,
  empty,
}: {
  readonly keys: readonly ProfileKey[];
  readonly values: ProfileValues | undefined;
  readonly empty: string;
}) {
  const t = useTranslations("Hr.employeeProfile");
  const locale = useLocale();
  const shown = keys.filter((key) => values?.[key] !== undefined);
  if (shown.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <DescriptionList
      layout="rows"
      items={shown.map((key) => {
        const raw = values![key]!;
        const value =
          key === "birthDate"
            ? formatBusinessDate(raw, locale)
            : key === "gender" || key === "maritalStatus"
              ? t(`${key}Value.${raw}`)
              : raw;
        return { id: key, label: t(`field.${key}`), value };
      })}
    />
  );
}

function PaymentSummary({
  payment,
}: {
  readonly payment: PaymentValues | null | undefined;
}) {
  const t = useTranslations("Hr.employeeProfile");
  if (payment === undefined) return null;
  if (payment === null)
    return <p className="text-sm text-muted">{t("noPayment")}</p>;
  const items = [
    {
      id: "method",
      label: t("field.method"),
      value: t(`method.${payment.method}`),
    },
  ];
  if (payment.method === "BANK")
    items.push(
      {
        id: "bank",
        label: t("field.bankName"),
        value: payment.bankName ?? "—",
      },
      {
        id: "account",
        label: t("field.accountNumber"),
        // Only the last four digits are shown outside the editor.
        value: payment.accountMasked ?? "—",
      },
      ...(payment.accountName
        ? [
            {
              id: "name",
              label: t("field.accountName"),
              value: payment.accountName,
            },
          ]
        : []),
    );
  return <DescriptionList layout="rows" items={items} />;
}

function LifecycleSection({
  lifecycle,
  disabled,
  onAction,
}: {
  readonly lifecycle: Lifecycle;
  readonly disabled: boolean;
  readonly onAction: (kind: LifecycleKind) => void;
}) {
  const t = useTranslations("Hr.employeeProfile");
  const locale = useLocale();
  const timezone = useHrAccess().timezone ?? "Asia/Bangkok";
  const id = useId();
  const date = (value: string) => formatBusinessDate(value, locale);
  const separated = lifecycle.separation !== undefined;
  const facts = [
    {
      id: "start",
      label: t("employmentStart"),
      value: date(lifecycle.employmentStartDate),
    },
    ...(lifecycle.probationEndDate === undefined
      ? []
      : [
          {
            id: "probation",
            label: t("probationEnd"),
            value: date(lifecycle.probationEndDate),
          },
        ]),
    ...(lifecycle.probationConfirmedDate === undefined
      ? []
      : [
          {
            id: "confirmed",
            label: t("confirmedOn"),
            value: date(lifecycle.probationConfirmedDate),
          },
        ]),
    ...(lifecycle.separation === undefined
      ? []
      : [
          {
            id: "last",
            label: t("lastWorkingDay"),
            value: date(lifecycle.separation.lastWorkingDate),
          },
          {
            id: "reason",
            label: t("exitReason"),
            value: lifecycle.separation.reason,
          },
        ]),
  ];
  return (
    <section
      aria-labelledby={id}
      className="space-y-4 rounded-xl border border-border bg-surface p-4"
      data-testid="hr-employee-lifecycle"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <SectionTitle>
            <span id={id}>{t("lifecycle")}</span>
          </SectionTitle>
          <EmploymentStateBadge state={lifecycle.state} />
        </div>
        <div className="flex flex-wrap gap-2">
          {lifecycle.state === "PROBATION" ? (
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => onAction("CONFIRM_PROBATION")}
            >
              {t("action.CONFIRM_PROBATION")}
            </Button>
          ) : null}
          {separated ? (
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => onAction("REINSTATE")}
            >
              {t("action.REINSTATE")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => onAction("OFFBOARD")}
            >
              {t("action.OFFBOARD")}
            </Button>
          )}
        </div>
      </div>
      <DescriptionList layout="rows" items={facts} />
      <div className="space-y-2 border-t border-border pt-3">
        <h4 className="text-sm font-semibold text-text">{t("history")}</h4>
        {lifecycle.events.length === 0 ? (
          <p className="text-sm text-muted">{t("noHistory")}</p>
        ) : (
          <ol className="space-y-2 text-sm" data-testid="hr-lifecycle-history">
            {lifecycle.events.map((event) => (
              <li key={event.id} className="text-muted">
                <span className="font-medium text-text">
                  {t(`event.${event.type}`)}
                </span>
                {" · "}
                {t("effective", { date: date(event.effectiveDate) })}
                {event.reason ? (
                  <span className="block break-words text-text">
                    {event.reason}
                  </span>
                ) : null}
                <span className="block text-xs">
                  {t("recorded", {
                    at: formatDateTime(event.recordedAt, locale, timezone),
                    name: event.recordedByName ?? "—",
                  })}
                </span>
              </li>
            ))}
          </ol>
        )}
        {lifecycle.complete ? null : (
          <p className="text-xs text-muted">{t("historyTruncated")}</p>
        )}
      </div>
    </section>
  );
}

function SectionDialog({
  target,
  employeeId,
  profile,
  payment,
  lifecycle,
  currentVersion,
  onOpenChange,
}: {
  readonly target: Target | null;
  readonly employeeId: string;
  readonly profile: { profile: ProfileValues; version: number } | undefined;
  readonly payment:
    { payment: PaymentValues | null; version: number } | undefined;
  readonly lifecycle: Lifecycle | undefined;
  readonly currentVersion: number | undefined;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Hr.employeeProfile");
  const dialog = useRef<DialogCompletionHandle>(null);
  const [pending, setPending] = useState(false);
  const completed = useDialogCompletion(pending, dialog, () =>
    onOpenChange(false),
  );
  const title =
    target === null
      ? ""
      : target === "personal" || target === "contact" || target === "payment"
        ? t(`editTitle.${target}`)
        : t(`action.${target}`);
  return (
    <Dialog
      open={target !== null}
      onOpenChange={onOpenChange}
      backPending={pending}
      completionRef={dialog}
    >
      <DialogContent closeLabel={t("close")} size="lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {target === null ? "" : t(`dialogHint.${target}`)}
          </DialogDescription>
        </DialogHeader>
        {currentVersion !== undefined &&
        currentVersion !==
          (target === "personal" || target === "contact"
            ? profile?.version
            : target === "payment"
              ? payment?.version
              : lifecycle?.version) ? (
          <Notice tone="warning" title={t("sessionStale")} />
        ) : null}
        {(target === "personal" || target === "contact") &&
        profile !== undefined ? (
          <ProfileForm
            key={target}
            section={target}
            employeeId={employeeId}
            opened={profile}
            onPending={setPending}
            onSaved={completed}
          />
        ) : null}
        {target === "payment" && payment !== undefined ? (
          <PaymentForm
            key="payment"
            employeeId={employeeId}
            opened={payment}
            onPending={setPending}
            onSaved={completed}
          />
        ) : null}
        {(target === "CONFIRM_PROBATION" ||
          target === "OFFBOARD" ||
          target === "REINSTATE") &&
        lifecycle !== undefined ? (
          <LifecycleForm
            key={target}
            kind={target}
            employeeId={employeeId}
            opened={lifecycle}
            onPending={setPending}
            onSaved={completed}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Shared write plumbing for the Dialog forms. */
function useDialogForm<Draft>(
  intent: string,
  initial: Draft,
  onPending: (pending: boolean) => void,
) {
  const write = useHrWrite(intent);
  useLayoutEffect(() => {
    onPending(write.pending);
    return () => onPending(false);
  }, [onPending, write.pending]);
  const [baseline] = useState(initial);
  const [draft, setDraft] = useState(baseline);
  const [errors, setErrors] = useState<FieldErrors>({});
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const guard = useDraftGuard(
    write.state.kind !== "SAVED" && dirty,
    () => {
      setDraft(baseline);
      setErrors({});
    },
    write.pending,
  );
  return { write, draft, setDraft, errors, setErrors, guard };
}

/**
 * Cancel is the Dialog's own close: it asks before discarding typed changes
 * and is blocked while a save is pending.
 */
function FormActions({
  locked,
  pending,
  state,
  onRetry,
}: {
  readonly locked: boolean;
  readonly pending: boolean;
  readonly state: HrWriteState<unknown>;
  readonly onRetry: () => void;
}) {
  const t = useTranslations("Hr.employeeProfile");
  const form = useTranslations("Hr.form");
  return (
    <>
      <WriteFeedback state={state} onRetry={onRetry} />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={pending}>
            {form("cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={locked}>
          {pending ? form("submitting") : t("save")}
        </Button>
      </DialogFooter>
    </>
  );
}

function TextField({
  id,
  name,
  label,
  value,
  error,
  hint,
  onChange,
  type = "text",
  min,
  max,
  inputMode,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly error?: string | undefined;
  readonly hint?: string;
  readonly onChange: (value: string) => void;
  readonly type?: "text" | "date" | "email" | "tel";
  readonly min?: string;
  readonly max?: string;
  readonly inputMode?: "numeric" | "tel" | "email";
}) {
  return (
    <FormField
      id={`${id}-${name}`}
      label={label}
      error={error}
      {...(hint === undefined ? {} : { hint })}
    >
      {(field) => (
        <Input
          {...field}
          type={type}
          value={value}
          autoComplete="off"
          {...(min === undefined ? {} : { min })}
          {...(max === undefined ? {} : { max })}
          {...(inputMode === undefined ? {} : { inputMode })}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FormField>
  );
}

function ProfileForm({
  section,
  employeeId,
  opened,
  onPending,
  onSaved,
}: {
  readonly section: "personal" | "contact";
  readonly employeeId: string;
  readonly opened: { profile: ProfileValues; version: number };
  readonly onPending: (pending: boolean) => void;
  readonly onSaved: () => void;
}) {
  const t = useTranslations("Hr.employeeProfile");
  const id = useId();
  const refusal = useRefusalFields();
  const save = useMutation(hrRefs.saveEmployeeProfile);
  const access = useHrAccess();
  const keys: readonly ProfileKey[] =
    section === "personal" ? PERSONAL : [...CONTACT, ...EMERGENCY];
  const [version] = useState(opened.version);
  const initial = Object.fromEntries(
    keys.map((key) => [key, opened.profile[key] ?? ""]),
  ) as Record<ProfileKey, string>;
  const { write, draft, setDraft, errors, setErrors, guard } = useDialogForm(
    `employee-profile:${employeeId}:${section}:${version}`,
    initial,
    onPending,
  );
  const set = (key: ProfileKey, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const send = async () => {
    // Only this section's fields are sent; an empty value clears a field and
    // the other section's fields are kept by the server.
    const result = await write.submit((requestId) =>
      save({
        requestId,
        employeeId: employeeId as never,
        expectedVersion: version,
        ...(Object.fromEntries(
          keys.map((key) => [key, draft[key].trim()]),
        ) as Record<string, never>),
      }),
    );
    finish(result);
  };
  const finish = (result: HrWriteState<unknown>) => {
    setErrors(refusal(result));
    if (result.kind === "SAVED") guard.settle(onSaved);
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };
  const field = (
    key: ProfileKey,
    extra: Partial<Parameters<typeof TextField>[0]> = {},
  ) => (
    <TextField
      key={key}
      id={id}
      name={key}
      label={t(`field.${key}`)}
      value={draft[key]}
      error={errors[key]}
      onChange={(value) => set(key, value)}
      {...extra}
    />
  );
  const choice = (
    key: "gender" | "maritalStatus",
    values: readonly string[],
  ) => (
    <div key={key} className="grid gap-2">
      <label htmlFor={`${id}-${key}`} className="text-sm font-medium text-text">
        {t(`field.${key}`)}
      </label>
      <SelectControl
        id={`${id}-${key}`}
        value={draft[key]}
        onValueChange={(value) => set(key, value)}
        placeholder={t("notSet")}
        emptyLabel={t("notSet")}
        options={[
          { value: "", label: t("notSet") },
          ...values.map((value) => ({
            value,
            label: t(`${key}Value.${value}`),
          })),
        ]}
      />
    </div>
  );
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <fieldset disabled={write.locked} className="grid gap-5">
        {section === "personal" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {field("title")}
            {field("nickname")}
            {field("firstName")}
            {field("lastName")}
            {field("firstNameEn")}
            {field("lastNameEn")}
            {choice("gender", ["MALE", "FEMALE", "OTHER"])}
            {field("birthDate", { type: "date", max: access.today ?? "" })}
            {field("nationalId", {
              inputMode: "numeric",
              hint: t("nationalIdHint"),
            })}
            {field("nationality")}
            {field("religion")}
            {choice("maritalStatus", [
              "SINGLE",
              "MARRIED",
              "DIVORCED",
              "WIDOWED",
            ])}
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {field("email", { type: "email", inputMode: "email" })}
              {field("phone", { type: "tel", inputMode: "tel" })}
              {field("lineId")}
              {field("province")}
              <div className="sm:col-span-2">{field("address")}</div>
              {field("postalCode", { inputMode: "numeric" })}
            </div>
            <fieldset className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
              <legend className="px-1 text-sm font-semibold text-text">
                {t("emergency")}
              </legend>
              {field("emergencyName")}
              {field("emergencyRelationship")}
              {field("emergencyPhone", {
                type: "tel",
                inputMode: "tel",
                hint: t("emergencyHint"),
              })}
            </fieldset>
          </>
        )}
      </fieldset>
      <FormActions
        locked={write.locked}
        pending={write.pending}
        state={write.state}
        onRetry={() => void write.retry().then(finish)}
      />
    </form>
  );
}

function PaymentForm({
  employeeId,
  opened,
  onPending,
  onSaved,
}: {
  readonly employeeId: string;
  readonly opened: { payment: PaymentValues | null; version: number };
  readonly onPending: (pending: boolean) => void;
  readonly onSaved: () => void;
}) {
  const t = useTranslations("Hr.employeeProfile");
  const id = useId();
  const refusal = useRefusalFields();
  const save = useMutation(hrRefs.saveEmployeePayment);
  const [version] = useState(opened.version);
  const stored = opened.payment;
  const { write, draft, setDraft, errors, setErrors, guard } = useDialogForm(
    `employee-payment:${employeeId}:${version}`,
    {
      method: stored?.method ?? "BANK",
      bankName: stored?.bankName ?? "",
      accountNumber: stored?.accountNumber ?? "",
      accountName: stored?.accountName ?? "",
      bankBranchCode: stored?.bankBranchCode ?? "",
    },
    onPending,
  );
  const set = <Key extends keyof typeof draft>(
    key: Key,
    value: (typeof draft)[Key],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const finish = (result: HrWriteState<unknown>) => {
    setErrors(refusal(result));
    if (result.kind === "SAVED") guard.settle(onSaved);
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (draft.method === "BANK") {
      if (draft.bankName.trim() === "") next.bankName = t("required");
      if (!/^\d{6,20}$/.test(draft.accountNumber.replace(/[\s-]/g, "")))
        next.accountNumber = t("accountInvalid");
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    void write
      .submit((requestId) =>
        save({
          requestId,
          employeeId: employeeId as never,
          expectedVersion: version,
          method: draft.method,
          ...(draft.method === "BANK"
            ? {
                bankName: draft.bankName.trim(),
                accountNumber: draft.accountNumber.trim(),
                accountName: draft.accountName.trim(),
                bankBranchCode: draft.bankBranchCode.trim(),
              }
            : {}),
        }),
      )
      .then(finish);
  };
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <Notice tone="neutral" title={t("paymentPrivate")} />
      <fieldset disabled={write.locked} className="grid gap-5">
        <RadioFieldset
          id={`${id}-method`}
          legend={t("field.method")}
          value={draft.method}
          options={(["BANK", "CASH"] as const).map((value) => ({
            value,
            label: t(`method.${value}`),
          }))}
          onChange={(value) => set("method", value)}
        />
        <p className="text-sm text-muted">{t("cashHint")}</p>
        {/* Bank fields stay in place; cash disables them and clears them on save. */}
        <fieldset
          disabled={draft.method === "CASH"}
          className="grid gap-4 sm:grid-cols-2"
        >
          <TextField
            id={id}
            name="bankName"
            label={t("field.bankName")}
            value={draft.bankName}
            error={errors.bankName}
            onChange={(value) => set("bankName", value)}
          />
          <TextField
            id={id}
            name="accountNumber"
            label={t("field.accountNumber")}
            value={draft.accountNumber}
            error={errors.accountNumber}
            hint={t("accountHint")}
            inputMode="numeric"
            onChange={(value) => set("accountNumber", value)}
          />
          <TextField
            id={id}
            name="accountName"
            label={t("field.accountName")}
            value={draft.accountName}
            error={errors.accountName}
            onChange={(value) => set("accountName", value)}
          />
          <TextField
            id={id}
            name="bankBranchCode"
            label={t("field.bankBranchCode")}
            value={draft.bankBranchCode}
            error={errors.bankBranchCode}
            onChange={(value) => set("bankBranchCode", value)}
          />
        </fieldset>
      </fieldset>
      <FormActions
        locked={write.locked}
        pending={write.pending}
        state={write.state}
        onRetry={() => void write.retry().then(finish)}
      />
    </form>
  );
}

const nextDay = (date: string): string => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
};
const previousDay = (date: string): string => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
};

function LifecycleForm({
  kind,
  employeeId,
  opened,
  onPending,
  onSaved,
}: {
  readonly kind: LifecycleKind;
  readonly employeeId: string;
  readonly opened: Lifecycle;
  readonly onPending: (pending: boolean) => void;
  readonly onSaved: () => void;
}) {
  const t = useTranslations("Hr.employeeProfile");
  const locale = useLocale();
  const id = useId();
  const refusal = useRefusalFields();
  const record = useMutation(hrRefs.recordEmploymentEvent);
  const [subject] = useState(opened);
  const today = subject.today ?? "";
  // Scheduled changes are not supported: dates are bounded by today, and a
  // last working day must already have passed.
  const max = kind === "OFFBOARD" ? previousDay(today) : today;
  const min = [
    kind === "REINSTATE" && subject.separation
      ? nextDay(subject.separation.lastWorkingDate)
      : subject.employmentStartDate,
    subject.latestEffectiveDate ?? subject.employmentStartDate,
  ]
    .sort()
    .at(-1)!;
  const { write, draft, setDraft, errors, setErrors, guard } = useDialogForm(
    `employee-lifecycle:${employeeId}:${kind}:${subject.version}`,
    {
      date: kind === "OFFBOARD" ? "" : today,
      separationType: "RESIGNATION" as "RESIGNATION" | "TERMINATION",
      reason: "",
    },
    onPending,
  );
  const finish = (result: HrWriteState<unknown>) => {
    const refused = refusal(result);
    // The server reports the date as `effectiveDate`.
    setErrors(
      refused.effectiveDate === undefined
        ? refused
        : { ...refused, date: refused.effectiveDate },
    );
    if (result.kind === "SAVED") guard.settle(onSaved);
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (draft.date === "") next.date = t("required");
    else if (draft.date > max)
      next.date = t(kind === "OFFBOARD" ? "lastDayNotPast" : "dateFuture");
    else if (draft.date < min)
      next.date = t("dateTooEarly", { date: formatBusinessDate(min, locale) });
    if (kind !== "CONFIRM_PROBATION" && draft.reason.trim().length < 3)
      next.reason = t("reasonRequired");
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    void write
      .submit((requestId) =>
        record({
          requestId,
          employeeId: employeeId as never,
          expectedVersion: subject.version,
          kind,
          effectiveDate: draft.date,
          ...(kind === "OFFBOARD"
            ? { separationType: draft.separationType }
            : {}),
          ...(kind === "CONFIRM_PROBATION"
            ? {}
            : { reason: draft.reason.trim() }),
        }),
      )
      .then(finish);
  };
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {kind === "OFFBOARD" ? (
        <Notice tone="warning" title={t("offboardNotice")} />
      ) : null}
      {kind === "REINSTATE" ? (
        <Notice tone="neutral" title={t("reinstateAssignments")} />
      ) : null}
      <fieldset disabled={write.locked} className="grid gap-5">
        {kind === "OFFBOARD" ? (
          <RadioFieldset
            id={`${id}-type`}
            legend={t("separationType")}
            value={draft.separationType}
            options={(["RESIGNATION", "TERMINATION"] as const).map((value) => ({
              value,
              label: t(`separation.${value}`),
            }))}
            onChange={(value) =>
              setDraft((current) => ({ ...current, separationType: value }))
            }
            error={errors.separationType}
          />
        ) : null}
        <TextField
          id={id}
          name="date"
          type="date"
          label={t(`dateLabel.${kind}`)}
          value={draft.date}
          error={errors.date}
          hint={t(`dateHint.${kind}`)}
          min={min}
          max={max}
          onChange={(value) =>
            setDraft((current) => ({ ...current, date: value }))
          }
        />
        {kind === "CONFIRM_PROBATION" ? null : (
          <FormField
            id={`${id}-reason`}
            label={t("reason")}
            required
            error={errors.reason}
          >
            {(field) => (
              <textarea
                {...field}
                value={draft.reason}
                maxLength={500}
                rows={3}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
                className="min-h-24 w-full rounded-md border border-input bg-surface px-3 py-2 text-base text-text outline-none placeholder:text-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:bg-disabled-surface aria-invalid:border-destructive md:text-sm"
              />
            )}
          </FormField>
        )}
      </fieldset>
      <FormActions
        locked={write.locked}
        pending={write.pending}
        state={write.state}
        onRetry={() => void write.retry().then(finish)}
      />
    </form>
  );
}
