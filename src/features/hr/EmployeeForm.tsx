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
import {
  HrInterrupted,
  HrPagedState,
  HrPager,
  HrSearchField,
  useHrPagedQuery,
  type HrPageRow,
} from "./HrPagedList";
import { orgItems, RadioFieldset, type MasterRow } from "./HrOrgShared";
import { SectionTitle, WriteFeedback, useHrError } from "./HrShared";
import { HrSiteSelect } from "./HrSiteSelect";
import { useHrWrite, type HrWriteState } from "./useHrWrite";

export interface EmployeeRecord {
  readonly id: string;
  readonly code: string;
  readonly displayName: string;
  readonly status: "ACTIVE" | "INACTIVE";
  readonly siteId: string;
  readonly linkedUserId?: string | undefined;
  /** Current names, so a selection outside the shown options keeps its label. */
  readonly linkedName?: string | undefined;
  readonly supervisorUserId?: string | undefined;
  readonly supervisorName?: string | null | undefined;
  /** `false` when the active linked account lacks HR self-service. */
  readonly linkedSelfAccess?: boolean | undefined;
  /** `false` when the active supervisor lacks HR team review. */
  readonly supervisorReviewAccess?: boolean | undefined;
  readonly employmentStartDate: string;
  readonly employmentEndDate?: string | undefined;
  readonly branchId?: string | undefined;
  readonly branchName?: string | undefined;
  readonly departmentId?: string | undefined;
  readonly departmentName?: string | undefined;
  readonly positionId?: string | undefined;
  readonly positionName?: string | undefined;
  readonly levelId?: string | undefined;
  readonly levelName?: string | undefined;
  readonly employmentType?: "PERMANENT" | "FIXED_TERM" | undefined;
  readonly probationEndDate?: string | undefined;
  readonly probationConfirmedDate?: string | undefined;
  /** Offboarded: the record stays INACTIVE with this last day until reinstated. */
  readonly separation?:
    | {
        readonly type: "RESIGNATION" | "TERMINATION";
        readonly lastWorkingDate: string;
      }
    | undefined;
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
  branchId: string;
  departmentId: string;
  positionId: string;
  levelId: string;
  employmentType: "" | "PERMANENT" | "FIXED_TERM";
  onProbation: boolean;
  probationEndDate: string;
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
  branchId: employee?.branchId ?? "",
  departmentId: employee?.departmentId ?? "",
  positionId: employee?.positionId ?? "",
  levelId: employee?.levelId ?? "",
  // New employees start permanent; an existing record without a type keeps none.
  employmentType:
    employee === undefined ? "PERMANENT" : (employee.employmentType ?? ""),
  onProbation: employee?.probationEndDate !== undefined,
  probationEndDate: employee?.probationEndDate ?? "",
  hasSchedule: employee === undefined || employee.schedule !== undefined,
  workDays: [...(employee?.schedule?.workDays ?? [1, 2, 3, 4, 5])],
  startTime: employee?.schedule?.startTime ?? "08:30",
  endTime: employee?.schedule?.endTime ?? "17:30",
  endsNextDay: employee?.schedule?.endsNextDay ?? false,
  breakMinutes: String(employee?.schedule?.breakMinutes ?? 60),
});

type FieldErrors = Partial<Record<keyof Draft | "schedule", string>>;

/**
 * Org masters an ACTIVE employee needs because the organization has active
 * entries; an inactive employee may keep none.
 */
interface Required {
  readonly departmentId: boolean;
  readonly positionId: boolean;
}

/** Client checks for fast feedback; the server re-validates every field. */
function validate(
  draft: Draft,
  required: Required,
  t: (key: string) => string,
): FieldErrors {
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
  if (required.departmentId && draft.departmentId === "")
    errors.departmentId = t("departmentRequired");
  if (required.positionId && draft.positionId === "")
    errors.positionId = t("positionRequired");
  if (draft.onProbation && draft.probationEndDate === "")
    errors.probationEndDate = t("probationEndRequired");
  else if (
    draft.onProbation &&
    draft.employmentStartDate !== "" &&
    draft.probationEndDate < draft.employmentStartDate
  )
    errors.probationEndDate = t("probationBeforeStart");
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
  /** Called on Cancel, or with the saved employee after a successful save. */
  readonly onDone: (saved?: { readonly employeeId: string }) => void;
}) {
  const t = useTranslations("Hr.employees");
  const form = useTranslations("Hr.form");
  const locale = useLocale();
  const message = useHrError();
  const id = useId();
  const save = useMutation(hrRefs.saveEmployee);
  const [baseline, setBaseline] = useState(employee);
  const [initial, setInitial] = useState<Draft>(() =>
    draftOf(employee, sites, today),
  );
  const [draft, setDraft] = useState<Draft>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const write = useHrWrite(
    `employee:${baseline?.id ?? "new"}:${baseline?.version ?? 0}`,
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  if (
    !dirty &&
    !write.locked &&
    employee &&
    employee.version > (baseline?.version ?? 0)
  ) {
    const next = draftOf(employee, sites, today);
    setBaseline(employee);
    setInitial(next);
    setDraft(next);
    setErrors({});
  }
  const options = useOrgOptions(employee);
  // Mirrors the server: a legacy ACTIVE employee saved without an assignment
  // is not forced to pick one; new, reactivated or assigned employees are.
  const enforced = (field: "departmentId" | "positionId") =>
    employee === undefined ||
    employee.status !== "ACTIVE" ||
    employee[field] !== undefined;
  const required: Required = {
    departmentId:
      draft.status === "ACTIVE" &&
      enforced("departmentId") &&
      (options.department?.some((row) => row.status === "ACTIVE") ?? false),
    positionId:
      draft.status === "ACTIVE" &&
      enforced("positionId") &&
      (options.position?.some((row) => row.status === "ACTIVE") ?? false),
  };
  // A new employee starts from the suggested running code; it stays editable.
  const suggestion = useQuery(
    hrRefs.suggestEmployeeCode,
    employee === undefined ? {} : "skip",
  ) as { ok?: boolean; value?: { ok?: boolean; code?: unknown } } | undefined;
  // No suggestion left this year: say so beside the code instead of guessing.
  const suggestionRefused =
    suggestion?.ok === true && suggestion.value?.ok === false
      ? message("EMPLOYEE_CODE_EXHAUSTED")
      : undefined;
  const suggestedCode =
    suggestion?.ok === true &&
    suggestion.value?.ok === true &&
    typeof suggestion.value.code === "string"
      ? suggestion.value.code
      : undefined;
  if (
    suggestedCode !== undefined &&
    employee === undefined &&
    initial.code === "" &&
    draft.code === ""
  ) {
    setInitial({ ...initial, code: suggestedCode });
    setDraft((current) => ({ ...current, code: suggestedCode }));
  }
  // Unsaved edits survive search and navigation unless the user discards.
  useDraftGuard(
    write.state.kind !== "SAVED" && dirty,
    () => {
      setDraft(initial);
      setErrors({});
    },
    write.pending,
  );
  const set = <Key extends keyof Draft>(key: Key, value: Draft[Key]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const send = async () => {
    const next = validate(draft, required, t);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const result = await write.submit((requestId) =>
      save({
        requestId,
        replaceOrgFields: true,
        ...(baseline === undefined
          ? {}
          : { employeeId: baseline.id, expectedVersion: baseline.version }),
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
        ...(draft.branchId === "" ? {} : { branchId: draft.branchId }),
        ...(draft.departmentId === ""
          ? {}
          : { departmentId: draft.departmentId }),
        ...(draft.positionId === "" ? {} : { positionId: draft.positionId }),
        ...(draft.levelId === "" ? {} : { levelId: draft.levelId }),
        ...(draft.employmentType === ""
          ? {}
          : { employmentType: draft.employmentType }),
        ...(draft.onProbation
          ? { probationEndDate: draft.probationEndDate }
          : {}),
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
    if (result.kind === "SAVED") {
      const value = result.value as { readonly documentId?: unknown } | null;
      const employeeId =
        baseline?.id ??
        (typeof value?.documentId === "string" ? value.documentId : undefined);
      onDone(employeeId === undefined ? undefined : { employeeId });
    }
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
  const accountOption = (member: MemberOption) => {
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
  };
  const supervisorOption = (member: MemberOption) =>
    member.userId === draft.userId
      ? null
      : { value: member.userId, label: member.displayName };

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
            hint={
              suggestedCode !== undefined && draft.code === suggestedCode
                ? t("codeSuggested")
                : (suggestionRefused ?? t("codeHint"))
            }
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
          <MemberPickerField
            id={`${id}-member`}
            surface={`employee-form:${employee?.id ?? "new"}:account`}
            label={t("account")}
            hint={t("accountHint")}
            value={draft.userId}
            known={
              employee?.linkedUserId === undefined
                ? undefined
                : {
                    userId: employee.linkedUserId,
                    label: employee.linkedName ?? t("unknownMember"),
                  }
            }
            onChange={(value) => set("userId", value)}
            error={errors.userId}
            none={t("noAccount")}
            option={accountOption}
          />
        </div>

        <fieldset className="space-y-4 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-semibold text-text">
            {t("employment")}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id={`${id}-department`}
              label={t("department")}
              required={required.departmentId}
              value={draft.departmentId}
              onChange={(value) => set("departmentId", value)}
              options={orgOptions(
                options.department,
                draft.departmentId,
                employee?.departmentName,
                required.departmentId ? null : t("noDepartment"),
                t,
              )}
              error={errors.departmentId}
              placeholder={t("chooseDepartment")}
              empty={t("noOptions")}
              pending={options.department === undefined}
            />
            <SelectField
              id={`${id}-position`}
              label={t("position")}
              required={required.positionId}
              value={draft.positionId}
              onChange={(value) => set("positionId", value)}
              options={orgOptions(
                options.position,
                draft.positionId,
                employee?.positionName,
                required.positionId ? null : t("noPosition"),
                t,
              )}
              error={errors.positionId}
              placeholder={t("choosePosition")}
              empty={t("noOptions")}
              pending={options.position === undefined}
            />
            <SelectField
              id={`${id}-level`}
              label={t("level")}
              value={draft.levelId}
              onChange={(value) => set("levelId", value)}
              options={orgOptions(
                options.level,
                draft.levelId,
                employee?.levelName,
                t("noLevel"),
                t,
              )}
              error={errors.levelId}
              placeholder={t("noLevel")}
              empty={t("noOptions")}
              pending={options.level === undefined}
            />
            <MemberPickerField
              id={`${id}-supervisor`}
              surface={`employee-form:${employee?.id ?? "new"}:supervisor`}
              label={t("supervisor")}
              value={draft.supervisorUserId}
              known={
                employee?.supervisorUserId === undefined
                  ? undefined
                  : {
                      userId: employee.supervisorUserId,
                      label: employee.supervisorName ?? t("unknownMember"),
                    }
              }
              onChange={(value) => set("supervisorUserId", value)}
              error={errors.supervisorUserId}
              none={t("noSupervisor")}
              option={supervisorOption}
            />
            <SelectField
              id={`${id}-branch`}
              label={t("branch")}
              value={draft.branchId}
              onChange={(value) => set("branchId", value)}
              options={orgOptions(
                options.branch,
                draft.branchId,
                employee?.branchName,
                t("noBranch"),
                t,
              )}
              error={errors.branchId}
              placeholder={t("noBranch")}
              empty={t("noOptions")}
              pending={options.branch === undefined}
            />
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor={`${id}-site`}>{t("workplace")}</Label>
              <HrSiteSelect
                id={`${id}-site`}
                surface={`employee-form:${employee?.id ?? "new"}:site`}
                sites={sites}
                value={draft.siteId}
                onChange={(value) => set("siteId", value)}
                placeholder={t("chooseSite")}
                emptyLabel={t("noSites")}
                invalid={errors.siteId !== undefined}
                {...(errors.siteId === undefined
                  ? {}
                  : { describedBy: `${id}-site-error` })}
              />
              {errors.siteId ? (
                <p
                  id={`${id}-site-error`}
                  role="alert"
                  className="text-xs leading-relaxed text-danger"
                >
                  {errors.siteId}
                </p>
              ) : null}
            </div>
            <SelectField
              id={`${id}-status`}
              label={t("employmentStatus")}
              {...(employee?.separation === undefined
                ? {}
                : {
                    hint: t("separatedHint", {
                      date: formatBusinessDate(
                        employee.separation.lastWorkingDate,
                        locale,
                      ),
                    }),
                  })}
              value={draft.status}
              onChange={(value) => set("status", value as Draft["status"])}
              options={[
                {
                  value: "ACTIVE",
                  label: t("active"),
                  // Reinstatement is a dated lifecycle event, not a toggle.
                  disabled: employee?.separation !== undefined,
                },
                { value: "INACTIVE", label: t("inactive") },
              ]}
              placeholder={t("employmentStatus")}
              empty={t("employmentStatus")}
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
          <RadioFieldset
            id={`${id}-type`}
            legend={t("employmentType")}
            value={draft.employmentType}
            options={(["PERMANENT", "FIXED_TERM"] as const).map((type) => ({
              value: type,
              label: t(`employmentTypeValue.${type}`),
            }))}
            onChange={(type) => set("employmentType", type)}
            error={errors.employmentType}
          />
          <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
            <label className="flex min-h-touch items-center gap-2 text-sm text-text">
              <CheckboxControl
                checked={draft.onProbation}
                onChange={(e) => set("onProbation", e.target.checked)}
              />
              {t("onProbation")}
            </label>
            {draft.onProbation ? (
              <FormField
                id={`${id}-probation`}
                label={t("probationEnd")}
                required
                error={errors.probationEndDate}
              >
                {(field) => (
                  <Input
                    {...field}
                    type="date"
                    value={draft.probationEndDate}
                    onChange={(e) => set("probationEndDate", e.target.value)}
                  />
                )}
              </FormField>
            ) : null}
          </div>
        </fieldset>

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
          onClick={() => onDone()}
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

type MemberOption = HrPageRow<typeof hrRefs.memberOptionsPage>;

type OrgOption = Pick<MasterRow, "id" | "name" | "status">;

/**
 * Active branch/department/position/level choices, plus the employee's
 * current (possibly inactive) reference so it stays selected unchanged.
 */
function useOrgOptions(employee: EmployeeRecord | undefined) {
  const current = (id: string | undefined) =>
    id === undefined ? {} : { currentId: id };
  return {
    branch: orgItems<OrgOption>(
      useQuery(hrRefs.branchOptions, current(employee?.branchId)),
    ),
    department: orgItems<OrgOption>(
      useQuery(hrRefs.departmentOptions, current(employee?.departmentId)),
    ),
    position: orgItems<OrgOption>(
      useQuery(hrRefs.positionOptions, current(employee?.positionId)),
    ),
    level: orgItems<OrgOption>(
      useQuery(hrRefs.levelOptions, current(employee?.levelId)),
    ),
  };
}

function orgOptions(
  rows: readonly OrgOption[] | undefined,
  value: string,
  currentName: string | undefined,
  none: string | null,
  t: ReturnType<typeof useTranslations<"Hr.employees">>,
) {
  const shown = (rows ?? []).map((row) => ({
    value: row.id,
    label:
      row.status === "ACTIVE"
        ? row.name
        : t("inactiveOption", { name: row.name }),
  }));
  return [
    ...(none === null ? [] : [{ value: "", label: none }]),
    ...(value !== "" && !shown.some((option) => option.value === value)
      ? [{ value, label: currentName ?? t("selectedOption") }]
      : []),
    ...shown,
  ];
}

/**
 * A member selector over every active member: a search narrows the
 * options across the whole organization and further pages stay reachable.
 * The current choice keeps its name even when it is not among the shown
 * options; the server re-validates the member on save.
 */
function MemberPickerField({
  id,
  surface,
  label,
  hint,
  value,
  known,
  onChange,
  error,
  none,
  option,
}: {
  readonly id: string;
  readonly surface: string;
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly known:
    { readonly userId: string; readonly label: string } | undefined;
  readonly onChange: (value: string) => void;
  readonly error: string | undefined;
  readonly none: string;
  readonly option: (
    member: MemberOption,
  ) => { value: string; label: string; disabled?: boolean } | null;
}) {
  const t = useTranslations("Hr.employees");
  const message = useHrError();
  const [search, setSearch] = useState("");
  const { view, paging } = useHrPagedQuery(
    hrRefs.memberOptionsPage,
    search === "" ? {} : { search },
    surface,
  );
  // Names of choices made from earlier pages or searches.
  const [chosen, setChosen] = useState<Readonly<Record<string, string>>>(
    known === undefined ? {} : { [known.userId]: known.label },
  );
  // Options of a previous page (or search) while the next loads are not
  // choosable: the select stays pending until the current page is ready.
  const busy =
    view.kind === "loading" || (view.kind === "ready" && view.updating);
  const shown =
    view.kind === "ready" && !view.updating
      ? view.rows.flatMap((member) => {
          const entry = option(member);
          return entry === null ? [] : [entry];
        })
      : [];
  const selectedLabel = chosen[value];
  const options = [
    { value: "", label: none },
    ...(value !== "" && !shown.some((entry) => entry.value === value)
      ? [{ value, label: selectedLabel ?? t("selectedMember") }]
      : []),
    ...shown,
  ];
  const failure =
    view.kind === "refused"
      ? message(view.code)
      : view.kind === "denied"
        ? message("NOT_FOUND")
        : undefined;
  return (
    <div className="grid min-w-0 content-start gap-2">
      <SelectField
        id={id}
        label={label}
        {...(hint === undefined ? {} : { hint })}
        value={value}
        onChange={(next) => {
          const entry = shown.find((candidate) => candidate.value === next);
          if (entry !== undefined)
            setChosen((current) => ({ ...current, [next]: entry.label }));
          onChange(next);
        }}
        error={error ?? failure}
        options={options}
        placeholder={none}
        empty={t("noMembers")}
        pending={busy}
      />
      {view.kind === "interrupted" ? (
        <HrInterrupted view={view} compact />
      ) : null}
      <HrSearchField
        id={`${id}-search`}
        label={t("memberSearch", { field: label })}
        placeholder={t("memberSearchHint")}
        value={search}
        onSettled={setSearch}
        className="grid w-full gap-1"
      />
      {view.kind === "ready" &&
      !view.updating &&
      shown.length === 0 &&
      search !== "" ? (
        <p className="text-xs text-muted" role="status">
          {t("memberNoMatches")}
        </p>
      ) : null}
      <HrPager
        paging={paging}
        label={t("memberPagination", { field: label })}
      />
    </div>
  );
}

function SelectField({
  id,
  label,
  hint,
  required = false,
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
  readonly required?: boolean;
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
    <div className="grid min-w-0 content-start gap-2">
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </Label>
      <SelectControl
        id={id}
        value={value}
        onValueChange={onChange}
        options={options}
        required={required}
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
  "employmentType",
  "probationEndDate",
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
  "branchId",
  "departmentId",
  "positionId",
  "levelId",
  "employmentType",
  "probationEndDate",
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
  if (field === "employmentType")
    return value === "PERMANENT" || value === "FIXED_TERM"
      ? t(`employmentTypeValue.${value}`)
      : value;
  if (field.startsWith("employment") || field === "probationEndDate")
    return formatBusinessDate(value, locale);
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
  const { view, paging } = useHrPagedQuery(
    hrRefs.employeeHistoryPage,
    { employeeId },
    "employee-history",
  );
  // History never blocks the editor: a refusal or denial simply hides it.
  if (view.kind === "refused" || view.kind === "denied") return null;
  return (
    <section
      aria-labelledby={`${employeeId}-history`}
      className="space-y-2 border-t border-border pt-4"
      data-testid="hr-employee-history"
    >
      <h3
        id={`${employeeId}-history`}
        className="text-sm font-semibold text-text"
      >
        {t("history")}
      </h3>
      <HrPagedState<typeof hrRefs.employeeHistoryPage>
        view={view}
        refused={() => null}
      >
        {(_value, items) =>
          items.length === 0 ? (
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
                  <li key={item.id} className="text-muted">
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
          )
        }
      </HrPagedState>
      <HrPager paging={paging} label={t("historyPagination")} />
    </section>
  );
}
