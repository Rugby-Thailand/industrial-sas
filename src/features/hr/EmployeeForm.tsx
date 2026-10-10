"use client";

import { useMutation, useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import {
  useHrAccess,
  type HrSite,
} from "@/components/providers/HrAccessProvider";
import { Button } from "@/components/ui/button";
import { CheckboxControl } from "@/components/ui/CheckboxControl";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectControl } from "@/components/ui/SelectControl";
import { useDraftGuard } from "@/components/providers/draftGuard";
import { hrRefs } from "@/lib/convex/hrApi";
import { FOCUS_TARGET_IDS } from "@/lib/navigation";

import { formatBusinessDate, formatDateTime, weekdayName } from "./format";
import { SectionTitle, WriteFeedback, useHrError } from "./HrShared";
import { useHrWrite, type HrWriteState } from "./useHrWrite";

export interface EmployeeRecord {
  readonly id: string;
  readonly code: string;
  readonly displayName: string;
  readonly status: "ACTIVE" | "INACTIVE";
  readonly siteId: string;
  readonly linkedUserId?: string | undefined;
  readonly supervisorUserId?: string | undefined;
  readonly employmentStartDate: string;
  readonly employmentEndDate?: string | undefined;
  readonly schedule?:
    | {
        readonly workDays: readonly number[];
        readonly startTime: string;
        readonly endTime: string;
        readonly endsNextDay: boolean;
        readonly breakMinutes: number;
      }
    | undefined;
  readonly version: number;
}

interface Draft {
  code: string;
  displayName: string;
  siteId: string;
  userId: string;
  supervisorUserId: string;
  employmentStartDate: string;
  employmentEndDate: string;
  status: "ACTIVE" | "INACTIVE";
  hasSchedule: boolean;
  workDays: number[];
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  breakMinutes: string;
}

const draftOf = (
  employee: EmployeeRecord | undefined,
  sites: readonly HrSite[],
  today: string,
): Draft => ({
  code: employee?.code ?? "",
  displayName: employee?.displayName ?? "",
  siteId: employee?.siteId ?? (sites.length === 1 ? sites[0]!.id : ""),
  userId: employee?.linkedUserId ?? "",
  supervisorUserId: employee?.supervisorUserId ?? "",
  employmentStartDate: employee?.employmentStartDate ?? today,
  employmentEndDate: employee?.employmentEndDate ?? "",
  status: employee?.status ?? "ACTIVE",
  hasSchedule: employee === undefined || employee.schedule !== undefined,
  workDays: [...(employee?.schedule?.workDays ?? [1, 2, 3, 4, 5])],
  startTime: employee?.schedule?.startTime ?? "08:30",
  endTime: employee?.schedule?.endTime ?? "17:30",
  endsNextDay: employee?.schedule?.endsNextDay ?? false,
  breakMinutes: String(employee?.schedule?.breakMinutes ?? 60),
});

type FieldErrors = Partial<Record<keyof Draft | "schedule", string>>;

/** Client checks for fast feedback; the server re-validates every field. */
function validate(draft: Draft, t: (key: string) => string): FieldErrors {
  const errors: FieldErrors = {};
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(draft.code.trim()))
    errors.code = t("codeInvalid");
  if (draft.displayName.trim() === "") errors.displayName = t("nameRequired");
  if (draft.siteId === "") errors.siteId = t("siteRequired");
  if (draft.employmentStartDate === "")
    errors.employmentStartDate = t("dateRequired");
  if (
    draft.employmentEndDate !== "" &&
    draft.employmentEndDate < draft.employmentStartDate
  )
    errors.employmentEndDate = t("endBeforeStart");
  if (draft.userId !== "" && draft.userId === draft.supervisorUserId)
    errors.supervisorUserId = t("selfSupervisor");
  if (draft.hasSchedule) {
    const breakMinutes = Number(draft.breakMinutes);
    if (draft.workDays.length === 0) errors.schedule = t("daysRequired");
    if (!Number.isInteger(breakMinutes) || breakMinutes < 0)
      errors.breakMinutes = t("breakInvalid");
  }
  return errors;
}

export function EmployeeForm({
  employee,
  sites,
  today,
  onDone,
}: {
  readonly employee?: EmployeeRecord;
  readonly sites: readonly HrSite[];
  readonly today: string;
  readonly onDone: () => void;
}) {
  const t = useTranslations("Hr.employees");
  const form = useTranslations("Hr.form");
  const locale = useLocale();
  const message = useHrError();
  const id = useId();
  const save = useMutation(hrRefs.saveEmployee);
  const members = useQuery(hrRefs.memberOptions, {});
  const [initial] = useState<Draft>(() => draftOf(employee, sites, today));
  const [draft, setDraft] = useState<Draft>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const write = useHrWrite(
    `employee:${employee?.id ?? "new"}:${employee?.version ?? 0}`,
  );
  // Unsaved edits survive search and navigation unless the user discards.
  useDraftGuard(
    write.state.kind !== "SAVED" &&
      JSON.stringify(draft) !== JSON.stringify(initial),
    () => {
      setDraft(initial);
      setErrors({});
    },
    write.pending,
  );
  const set = <Key extends keyof Draft>(key: Key, value: Draft[Key]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const memberList = members?.ok && members.value.ok ? members.value.items : [];
  const membersFailed =
    members?.ok === false || (members?.ok && !members.value.ok);

  const send = async () => {
    const next = validate(draft, t);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const result = await write.submit((requestId) =>
      save({
        requestId,
        ...(employee === undefined
          ? {}
          : { employeeId: employee.id, expectedVersion: employee.version }),
        warehouseId: draft.siteId,
        code: draft.code.trim(),
        displayName: draft.displayName.trim(),
        ...(draft.userId === "" ? {} : { userId: draft.userId }),
        ...(draft.supervisorUserId === ""
          ? {}
          : { supervisorUserId: draft.supervisorUserId }),
        employmentStartDate: draft.employmentStartDate,
        ...(draft.employmentEndDate === ""
          ? {}
          : { employmentEndDate: draft.employmentEndDate }),
        status: draft.status,
        ...(draft.hasSchedule
          ? {
              schedule: {
                workDays: [...draft.workDays].sort(),
                startTime: draft.startTime,
                endTime: draft.endTime,
                endsNextDay: draft.endsNextDay,
                breakMinutes: Number(draft.breakMinutes),
              },
            }
          : {}),
      }),
    );
    finish(result);
  };
  const finish = (result: HrWriteState<unknown>) => {
    if (result.kind === "SAVED") onDone();
    if (result.kind === "REFUSED" && result.field !== undefined) {
      const field = result.field === "warehouseId" ? "siteId" : result.field;
      setErrors({ [field]: message(result.code) } as FieldErrors);
    }
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  // An account is selectable when it is unlinked or linked to this employee.
  // A link outside the administrator's site scope arrives only as
  // `linked: true`, without an employee ID or code, and stays unavailable
  // under a generic label. The server still enforces one employee per account.
  const memberOptions = memberList.map((member) => {
    const own =
      employee !== undefined &&
      (member.linkedEmployeeId === employee.id ||
        member.userId === employee.linkedUserId);
    const taken =
      !own && (member.linked === true || member.linkedEmployeeId !== undefined);
    return {
      value: member.userId,
      label: !taken
        ? member.displayName
        : member.linkedEmployeeCode
          ? t("memberLinked", {
              name: member.displayName,
              code: member.linkedEmployeeCode,
            })
          : t("memberLinkedElsewhere", { name: member.displayName }),
      disabled: taken,
    };
  });
  const supervisorOptions = memberList
    .filter((member) => member.userId !== draft.userId)
    .map((member) => ({ value: member.userId, label: member.displayName }));

  return (
    <form
      id={FOCUS_TARGET_IDS.details}
      onSubmit={onSubmit}
      noValidate
      aria-labelledby={`${id}-title`}
      className="space-y-5 rounded-xl border border-border bg-surface p-4"
      data-testid="hr-employee-form"
    >
      <SectionTitle>
        <span id={`${id}-title`}>
          {employee === undefined
            ? t("addTitle")
            : t("editTitle", { code: employee.code })}
        </span>
      </SectionTitle>
      {/* Fixed while pending or uncertain, so a retry is the same command. */}
      <fieldset disabled={write.locked} className="contents">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id={`${id}-code`}
            label={t("code")}
            required
            hint={t("codeHint")}
            error={errors.code}
          >
            {(field) => (
              <Input
                {...field}
                value={draft.code}
                autoComplete="off"
                onChange={(e) => set("code", e.target.value)}
              />
            )}
          </FormField>
          <FormField
            id={`${id}-name`}
            label={t("name")}
            required
            error={errors.displayName}
          >
            {(field) => (
              <Input
                {...field}
                value={draft.displayName}
                autoComplete="off"
                onChange={(e) => set("displayName", e.target.value)}
              />
            )}
          </FormField>
          <SelectField
            id={`${id}-site`}
            label={t("site")}
            value={draft.siteId}
            onChange={(value) => set("siteId", value)}
            error={errors.siteId}
            options={sites.map((site) => ({
              value: site.id,
              label: `${site.code} · ${site.name}`,
            }))}
            placeholder={t("chooseSite")}
            empty={t("noSites")}
          />
          <SelectField
            id={`${id}-status`}
            label={t("status")}
            value={draft.status}
            onChange={(value) => set("status", value as Draft["status"])}
            options={[
              { value: "ACTIVE", label: t("active") },
              { value: "INACTIVE", label: t("inactive") },
            ]}
            placeholder={t("status")}
            empty={t("status")}
          />
          <SelectField
            id={`${id}-member`}
            label={t("account")}
            hint={t("accountHint")}
            value={draft.userId}
            onChange={(value) => set("userId", value)}
            error={
              errors.userId ??
              (membersFailed ? message("LIMIT_EXCEEDED") : undefined)
            }
            options={[{ value: "", label: t("noAccount") }, ...memberOptions]}
            placeholder={t("noAccount")}
            empty={t("noMembers")}
            pending={members === undefined}
          />
          <SelectField
            id={`${id}-supervisor`}
            label={t("supervisor")}
            value={draft.supervisorUserId}
            onChange={(value) => set("supervisorUserId", value)}
            error={errors.supervisorUserId}
            options={[
              { value: "", label: t("noSupervisor") },
              ...supervisorOptions,
            ]}
            placeholder={t("noSupervisor")}
            empty={t("noMembers")}
            pending={members === undefined}
          />
          <FormField
            id={`${id}-start`}
            label={t("employmentStart")}
            required
            error={errors.employmentStartDate}
          >
            {(field) => (
              <Input
                {...field}
                type="date"
                value={draft.employmentStartDate}
                onChange={(e) => set("employmentStartDate", e.target.value)}
              />
            )}
          </FormField>
          <FormField
            id={`${id}-end`}
            label={t("employmentEnd")}
            hint={t("employmentEndHint")}
            error={errors.employmentEndDate}
          >
            {(field) => (
              <Input
                {...field}
                type="date"
                value={draft.employmentEndDate}
                onChange={(e) => set("employmentEndDate", e.target.value)}
              />
            )}
          </FormField>
        </div>

        <fieldset
          id={FOCUS_TARGET_IDS.schedule}
          className="space-y-4 rounded-lg border border-border p-4"
        >
          <legend className="px-1 text-sm font-semibold text-text">
            {t("schedule")}
          </legend>
          <label className="flex min-h-touch items-center gap-2 text-sm text-text">
            <CheckboxControl
              checked={draft.hasSchedule}
              onChange={(e) => set("hasSchedule", e.target.checked)}
            />
            {t("hasSchedule")}
          </label>
          {draft.hasSchedule ? (
            <>
              <fieldset
                aria-describedby={
                  errors.schedule ? `${id}-days-error` : undefined
                }
              >
                <legend className="mb-2 text-sm font-medium text-text">
                  {t("workDays")}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                    <label
                      key={day}
                      className="flex min-h-touch min-w-touch items-center gap-2 rounded-md border border-border px-3 text-sm text-text"
                    >
                      <CheckboxControl
                        checked={draft.workDays.includes(day)}
                        onChange={(e) =>
                          set(
                            "workDays",
                            e.target.checked
                              ? [...draft.workDays, day]
                              : draft.workDays.filter((value) => value !== day),
                          )
                        }
                      />
                      {weekdayName(day, locale)}
                    </label>
                  ))}
                </div>
                {errors.schedule ? (
                  <p
                    id={`${id}-days-error`}
                    role="alert"
                    className="mt-2 text-xs text-danger"
                  >
                    {errors.schedule}
                  </p>
                ) : null}
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  id={`${id}-shift-start`}
                  label={t("shiftStart")}
                  required
                >
                  {(field) => (
                    <Input
                      {...field}
                      type="time"
                      value={draft.startTime}
                      onChange={(e) => set("startTime", e.target.value)}
                    />
                  )}
                </FormField>
                <FormField
                  id={`${id}-shift-end`}
                  label={t("shiftEnd")}
                  required
                >
                  {(field) => (
                    <Input
                      {...field}
                      type="time"
                      value={draft.endTime}
                      onChange={(e) => set("endTime", e.target.value)}
                    />
                  )}
                </FormField>
                <FormField
                  id={`${id}-break`}
                  label={t("breakMinutes")}
                  hint={t("breakHint")}
                  error={errors.breakMinutes}
                >
                  {(field) => (
                    <Input
                      {...field}
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={draft.breakMinutes}
                      onChange={(e) => set("breakMinutes", e.target.value)}
                    />
                  )}
                </FormField>
              </div>
              <label className="flex min-h-touch items-center gap-2 text-sm text-text">
                <CheckboxControl
                  checked={draft.endsNextDay}
                  onChange={(e) => set("endsNextDay", e.target.checked)}
                />
                {t("endsNextDay")}
              </label>
            </>
          ) : (
            <p className="text-sm text-muted">{t("noScheduleHint")}</p>
          )}
        </fieldset>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          disabled={write.locked}
          data-testid="hr-employee-save"
        >
          {write.pending ? form("submitting") : t("save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          disabled={write.locked}
        >
          {form("cancel")}
        </Button>
      </div>
      <WriteFeedback
        state={write.state}
        onRetry={() => void write.retry().then(finish)}
      />
      {employee === undefined ? null : (
        <EmployeeHistory employeeId={employee.id} />
      )}
    </form>
  );
}

function SelectField({
  id,
  label,
  hint,
  value,
  onChange,
  options,
  error,
  placeholder,
  empty,
  pending,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly {
    value: string;
    label: string;
    disabled?: boolean;
  }[];
  readonly error?: string | undefined;
  readonly placeholder: string;
  readonly empty: string;
  readonly pending?: boolean;
}) {
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{label}</Label>
      <SelectControl
        id={id}
        value={value}
        onValueChange={onChange}
        options={options}
        placeholder={placeholder}
        emptyLabel={empty}
        invalid={error !== undefined}
        describedBy={describedBy}
        pending={pending ?? false}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-xs leading-relaxed text-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

const SAFE_VALUE_FIELDS = new Set([
  "code",
  "displayName",
  "employmentStartDate",
  "employmentEndDate",
  "status",
]);
const LABELLED_FIELDS = new Set([
  "code",
  "displayName",
  "warehouseId",
  "userId",
  "supervisorUserId",
  "employmentStartDate",
  "employmentEndDate",
  "status",
  "schedule",
]);

/** A stored audit value (JSON text) as the person reading it would expect. */
function auditValue(
  field: string,
  raw: string | undefined,
  locale: string,
  t: (key: string) => string,
): string {
  if (raw === undefined) return t("auditEmpty");
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    /* plain text */
  }
  if (typeof value !== "string") return t("auditEmpty");
  if (field === "status") return t(value === "ACTIVE" ? "active" : "inactive");
  if (field.startsWith("employment")) return formatBusinessDate(value, locale);
  return value;
}

/**
 * Employee change history with human labels. Internal identifiers (site,
 * account, supervisor) are named as changed rather than printed as IDs.
 */
function EmployeeHistory({ employeeId }: { readonly employeeId: string }) {
  const t = useTranslations("Hr.employees");
  const locale = useLocale();
  const timezone = useHrAccess().timezone ?? "Asia/Bangkok";
  const outcome = useQuery(hrRefs.employeeHistory, { employeeId });
  if (outcome === undefined || !outcome.ok || !outcome.value.ok) return null;
  const { items, complete } = outcome.value;
  return (
    <section
      aria-labelledby={`${employeeId}-history`}
      className="border-t border-border pt-4"
      data-testid="hr-employee-history"
    >
      <h3
        id={`${employeeId}-history`}
        className="mb-2 text-sm font-semibold text-text"
      >
        {t("history")}
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t("noHistory")}</p>
      ) : (
        <ol className="space-y-3 text-sm">
          {items.map((item) => {
            const created = item.changes.every(
              (change) => change.from === undefined,
            );
            const changes = item.changes.filter((change) =>
              LABELLED_FIELDS.has(change.field),
            );
            return (
              <li key={`${item.at}-${item.action}`} className="text-muted">
                <span className="tabular-nums">
                  {formatDateTime(item.at, locale, timezone)}
                </span>
                {" · "}
                <span className="text-text">{item.actorName ?? "—"}</span>
                {" · "}
                {t(created ? "auditCreated" : "auditUpdated")}
                {created ? null : (
                  <ul className="mt-1 list-disc pl-5">
                    {changes.map((change) => (
                      <li key={change.field}>
                        <span className="text-text">
                          {t(`auditField.${change.field}`)}
                        </span>
                        {SAFE_VALUE_FIELDS.has(change.field)
                          ? `: ${auditValue(change.field, change.from, locale, t)} → ${auditValue(change.field, change.to, locale, t)}`
                          : ` ${t("auditChanged")}`}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {complete ? null : (
        <p className="mt-2 text-xs text-muted" role="status">
          {t("historyIncomplete", { count: items.length })}
        </p>
      )}
    </section>
  );
}
