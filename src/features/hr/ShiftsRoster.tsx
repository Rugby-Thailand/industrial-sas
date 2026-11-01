"use client";

import { useMutation, useQuery } from "convex/react";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Pencil,
  Plus,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { useDraftGuard } from "@/components/providers/draftGuard";
import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { Button } from "@/components/ui/button";
import { CheckboxControl } from "@/components/ui/CheckboxControl";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogCompletionHandle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SelectControl } from "@/components/ui/SelectControl";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TableScroller } from "@/components/ui/TableScroller";
import { useWorkflowStep } from "@/hooks/useWorkflowStep";
import { useAsyncOperation } from "@/hooks/useAsyncOperation";
import { Link } from "@/i18n/navigation";
import { hrRefs } from "@/lib/convex/hrApi";
import { HR_CODES, ROUTES } from "@/lib/navigation";

import { useDialogCompletion, useRefusalFields } from "./HrOrgShared";
import { SettingsHeading } from "./HrSettingsHeading";
import {
  HrGate,
  HrInlineError,
  HrQueryState,
  useHrBack,
  WriteFeedback,
} from "./HrShared";
import { HrSiteSelect } from "./HrSiteSelect";
import { HrToolbar } from "./HrUi";
import { useHrWrite, type HrWriteState } from "./useHrWrite";

const COLORS = [
  "sky",
  "teal",
  "green",
  "amber",
  "rose",
  "violet",
  "slate",
] as const;
type ShiftColor = (typeof COLORS)[number];
const SWATCH: Readonly<Record<ShiftColor, string>> = {
  sky: "bg-sky-600",
  teal: "bg-teal-600",
  green: "bg-green-600",
  amber: "bg-amber-500",
  rose: "bg-rose-600",
  violet: "bg-violet-600",
  slate: "bg-slate-600",
};

interface ShiftRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly color: ShiftColor;
  readonly status: "ACTIVE" | "INACTIVE";
  readonly startTime: string;
  readonly endTime: string;
  readonly endsNextDay: boolean;
  readonly breakMinutes: number;
  readonly version: number;
}

type Outcome<T> =
  | undefined
  | { readonly ok: false; readonly requestId: string }
  | { readonly ok: true; readonly value: T };

function Swatch({ color }: { readonly color: ShiftColor }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2.5 shrink-0 rounded-full ${SWATCH[color] ?? SWATCH.slate}`}
    />
  );
}

/** The first in-scope site, kept in this view; it is a filter, not a step. */
function useSite() {
  const access = useHrAccess();
  return useState(access.sites?.[0]?.id ?? "");
}

/** Settings entry points to the shift catalogue and the monthly roster. */
export function ShiftsRosterLinks() {
  const t = useTranslations("Hr.shifts");
  const id = useId();
  return (
    <Panel aria-labelledby={`${id}-title`} className="space-y-4">
      <SettingsHeading
        id={`${id}-title`}
        icon={<CalendarRange aria-hidden="true" className="size-5" />}
        title={t("settingsTitle")}
        description={t("settingsIntro")}
      />
      <div className="flex flex-wrap gap-3">
        <Link
          href={ROUTES.hrShifts}
          className="inline-flex min-h-touch items-center font-medium text-link underline-offset-4 focus-ring hover:underline"
        >
          {t("title")}
        </Link>
        <Link
          href={ROUTES.hrRoster}
          className="inline-flex min-h-touch items-center font-medium text-link underline-offset-4 focus-ring hover:underline"
        >
          {t("rosterTitle")}
        </Link>
      </div>
    </Panel>
  );
}

/* Catalogue ---------------------------------------------------------------- */

export function HrShiftsScreen() {
  const t = useTranslations("Hr.shifts");
  const back = useHrBack();
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} {...back} />
      <HrGate code={HR_CODES.admin}>
        <ShiftCatalogue />
      </HrGate>
    </>
  );
}

type Target = { readonly id: string | null };

function ShiftCatalogue() {
  const t = useTranslations("Hr.shifts");
  const id = useId();
  const [site, setSite] = useSite();
  const outcome = useQuery(
    hrRefs.shifts,
    site === "" ? "skip" : { warehouseId: site },
  ) as Outcome<
    | { ok: true; items: ShiftRow[]; complete: boolean }
    | { ok: false; code: string }
  >;
  const [target, setTarget] = useState<Target | null>(null);
  // Forward reopens the editor this entry belonged to.
  const last = useRef<Target>({ id: null });
  const open = (next: Target) => {
    last.current = next;
    setTarget(next);
  };
  const value = outcome?.ok ? outcome.value : undefined;
  const items = value?.ok ? value.items : [];
  const editing =
    target?.id == null ? undefined : items.find((row) => row.id === target.id);
  return (
    <div className="space-y-5">
      <HrToolbar label={t("filters")}>
        <div className="grid w-full gap-2 sm:w-64">
          <Label htmlFor={`${id}-site`}>{t("site")}</Label>
          <HrSiteSelect
            id={`${id}-site`}
            surface="shifts-site"
            value={site}
            onChange={setSite}
            placeholder={t("chooseSite")}
            emptyLabel={t("noSites")}
            disabled={target !== null}
          />
        </div>
        <Button
          type="button"
          onClick={() => open({ id: null })}
          disabled={site === "" || target !== null}
        >
          <Plus aria-hidden="true" />
          {t("add")}
        </Button>
      </HrToolbar>
      {site === "" ? (
        <EmptyState title={t("chooseSite")} body={t("chooseSiteHint")} />
      ) : (
        <HrQueryState outcome={outcome}>
          {() =>
            value && !value.ok ? (
              <HrInlineError code={value.code} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<Clock3 />}
                title={t("empty")}
                body={t("emptyHint")}
              />
            ) : (
              <TableScroller label={t("tableLabel")}>
                <table className="w-full min-w-[40rem] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted">
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t("code")}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t("name")}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t("time")}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t("status")}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        <span className="sr-only">{t("manage")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((row) => (
                      <tr key={row.id}>
                        <th
                          scope="row"
                          className="px-3 py-2 text-left font-semibold text-text"
                        >
                          <span className="inline-flex items-center gap-2">
                            <Swatch color={row.color} />
                            {row.code}
                          </span>
                        </th>
                        <td className="px-3 py-2">
                          <span className="block text-text">{row.name}</span>
                          {row.description ? (
                            <span className="block text-xs text-muted">
                              {row.description}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {t("timeValue", {
                            start: row.startTime,
                            end: row.endTime,
                            breakMinutes: row.breakMinutes,
                          })}
                          {row.endsNextDay ? (
                            <span className="block text-xs text-muted">
                              {t("nextDay")}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge
                            tone={row.status === "ACTIVE" ? "success" : "muted"}
                            label={t(
                              row.status === "ACTIVE" ? "active" : "inactive",
                            )}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={target !== null}
                            aria-label={t("editLabel", { code: row.code })}
                            onClick={() => open({ id: row.id })}
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroller>
            )
          }
        </HrQueryState>
      )}
      <ShiftEditor
        target={target}
        row={editing}
        siteId={site}
        onOpenChange={(next) => setTarget(next ? last.current : null)}
      />
    </div>
  );
}

/** One shared Back-aware Dialog for adding and editing a shift. */
function ShiftEditor({
  target,
  row,
  siteId,
  onOpenChange,
}: {
  readonly target: Target | null;
  readonly row: ShiftRow | undefined;
  readonly siteId: string;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Hr.shifts");
  const dialog = useRef<DialogCompletionHandle>(null);
  const [pending, setPending] = useState(false);
  const completed = useDialogCompletion(pending, dialog, () =>
    onOpenChange(false),
  );
  const isNew = target?.id === null;
  const ready = target !== null && (isNew || row !== undefined);
  return (
    <Dialog
      open={target !== null}
      onOpenChange={onOpenChange}
      backPending={pending}
      completionRef={dialog}
    >
      <DialogContent closeLabel={t("closeDialog")} size="sm">
        <DialogHeader>
          <DialogTitle>{isNew ? t("add") : t("editTitle")}</DialogTitle>
        </DialogHeader>
        {ready ? (
          <ShiftForm
            key={row?.id ?? "new"}
            row={row}
            siteId={siteId}
            onPending={setPending}
            onSaved={completed}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface ShiftDraft {
  code: string;
  name: string;
  description: string;
  color: ShiftColor;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  breakMinutes: string;
  active: boolean;
}

function ShiftForm({
  row: opened,
  siteId,
  onPending,
  onSaved,
}: {
  readonly row: ShiftRow | undefined;
  readonly siteId: string;
  readonly onPending: (pending: boolean) => void;
  readonly onSaved: () => void;
}) {
  const t = useTranslations("Hr.shifts");
  const form = useTranslations("Hr.form");
  const refusal = useRefusalFields();
  const id = useId();
  const save = useMutation(hrRefs.saveShift);
  // The version this editor opened; a concurrent edit is refused as stale.
  const [row] = useState(opened);
  const op = useAsyncOperation({
    scope: `shift:${siteId}:${row?.id ?? "new"}`,
    describeError: () => "",
    navigation: "owned",
  });
  const write = useHrWrite(
    `shift:${siteId}:${row?.id ?? "new"}:${row?.version ?? 0}`,
  );
  useLayoutEffect(() => {
    onPending(write.pending);
    return () => onPending(false);
  }, [onPending, write.pending]);
  const [initial] = useState<ShiftDraft>(() => ({
    code: row?.code ?? "",
    name: row?.name ?? "",
    description: row?.description ?? "",
    color: row?.color ?? "sky",
    startTime: row?.startTime ?? "08:00",
    endTime: row?.endTime ?? "17:00",
    endsNextDay: row?.endsNextDay ?? false,
    breakMinutes: String(row?.breakMinutes ?? 60),
    active: (row?.status ?? "ACTIVE") === "ACTIVE",
  }));
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const guard = useDraftGuard(
    write.state.kind !== "SAVED" && dirty,
    () => {
      setDraft(initial);
      setErrors({});
    },
    write.pending,
  );
  const set = <Key extends keyof ShiftDraft>(
    key: Key,
    value: ShiftDraft[Key],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const finish = (result: HrWriteState<unknown>) => {
    setErrors(refusal(result));
    // The guard's history buffer leaves first; then the Dialog completes.
    if (result.kind === "SAVED") guard.settle(() => op.complete(onSaved));
  };
  const send = async () => {
    const next: Record<string, string> = {};
    if (draft.code.trim() === "") next.code = t("required");
    if (draft.name.trim() === "") next.name = t("required");
    const breakMinutes = Number(draft.breakMinutes);
    if (!Number.isSafeInteger(breakMinutes) || breakMinutes < 0)
      next.breakMinutes = t("breakInvalid");
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const description = draft.description.trim();
    await op.run(
      () =>
        write.submit((requestId) =>
          save({
            requestId,
            warehouseId: siteId,
            ...(row === undefined
              ? {}
              : { shiftId: row.id, expectedVersion: row.version }),
            code: draft.code.trim(),
            name: draft.name.trim(),
            ...(description === "" ? {} : { description }),
            color: draft.color,
            status: draft.active ? "ACTIVE" : "INACTIVE",
            startTime: draft.startTime,
            endTime: draft.endTime,
            endsNextDay: draft.endsNextDay,
            breakMinutes,
          }),
        ),
      finish,
    );
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <fieldset disabled={write.locked} className="grid gap-4">
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
                maxLength={20}
                autoComplete="off"
                onChange={(e) => set("code", e.target.value)}
              />
            )}
          </FormField>
          <div className="grid content-start gap-2">
            <Label htmlFor={`${id}-color`}>{t("color")}</Label>
            <SelectControl
              id={`${id}-color`}
              value={draft.color}
              onValueChange={(value) => set("color", value as ShiftColor)}
              placeholder={t("color")}
              emptyLabel={t("color")}
              options={COLORS.map((color) => ({
                value: color,
                label: t(`colors.${color}`),
              }))}
            />
          </div>
        </div>
        <FormField
          id={`${id}-name`}
          label={t("name")}
          required
          error={errors.name}
        >
          {(field) => (
            <Input
              {...field}
              value={draft.name}
              maxLength={120}
              autoComplete="off"
              onChange={(e) => set("name", e.target.value)}
            />
          )}
        </FormField>
        <FormField
          id={`${id}-description`}
          label={t("description")}
          error={errors.description}
        >
          {(field) => (
            <Input
              {...field}
              value={draft.description}
              maxLength={500}
              autoComplete="off"
              onChange={(e) => set("description", e.target.value)}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            id={`${id}-start`}
            label={t("start")}
            required
            error={errors.startTime}
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
            id={`${id}-end`}
            label={t("end")}
            required
            error={errors.endTime}
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
            required
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
        <label className="flex min-h-touch items-center gap-2 text-sm text-text">
          <CheckboxControl
            checked={draft.active}
            onChange={(e) => set("active", e.target.checked)}
          />
          {t("activeLabel")}
        </label>
      </fieldset>
      <WriteFeedback
        state={write.state}
        onRetry={() => void op.run(() => write.retry(), finish)}
      />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={write.pending}>
            {form("cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={write.locked}>
          {write.pending ? form("submitting") : t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/* Roster ------------------------------------------------------------------- */

interface RosterCell {
  readonly date: string;
  readonly revision: number;
  readonly assignment:
    | null
    | { readonly kind: "OFF" }
    | {
        readonly kind: "SHIFT";
        readonly code: string;
        readonly name: string;
        readonly color: ShiftColor;
        readonly startTime: string;
        readonly endTime: string;
      };
  readonly plan: {
    readonly kind: "SCHEDULED" | "NONWORKING";
    readonly startTime?: string;
    readonly endTime?: string;
    readonly reason?: string;
    readonly holidayName?: string;
  };
  readonly recorded: boolean;
  readonly lock: string | null;
}
interface RosterEmployee {
  readonly id: string;
  readonly code: string;
  readonly displayName: string;
  readonly departmentName: string | null;
  readonly cells: readonly RosterCell[];
}
interface RosterValue {
  readonly ok: true;
  readonly today: string;
  readonly dates: readonly {
    readonly date: string;
    readonly weekday: number;
    readonly holidayName?: string;
  }[];
  readonly shifts: readonly ShiftRow[];
  readonly totalEmployees: number;
  readonly employees: readonly RosterEmployee[];
}

export function HrRosterScreen() {
  const t = useTranslations("Hr.shifts");
  const back = useHrBack();
  return (
    <>
      <PageHeader
        title={t("rosterTitle")}
        summary={t("rosterSummary")}
        {...back}
      />
      <HrGate code={HR_CODES.admin}>
        <RosterView />
      </HrGate>
    </>
  );
}

function shiftMonth(month: string, delta: number): string {
  const [year, value] = month.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, value - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function RosterView() {
  const t = useTranslations("Hr.shifts");
  const id = useId();
  const access = useHrAccess();
  const [site, setSite] = useSite();
  const [month, setMonth] = useState((access.today ?? "").slice(0, 7));
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);
  const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const outcome = useQuery(
    hrRefs.roster,
    site === "" || !validMonth
      ? "skip"
      : {
          warehouseId: site,
          month,
          ...(search.trim() === "" ? {} : { search: search.trim() }),
        },
  ) as Outcome<RosterValue | { ok: false; code: string }>;
  const value = outcome?.ok && outcome.value.ok ? outcome.value : undefined;
  const assignment = useWorkflowStep(
    "rosterAssign",
    `hr-roster-assign:${site}:${month}`,
    value !== undefined,
    undefined,
    { blocked: pending },
  );
  const assigning = assignment.active;
  return (
    <div className="space-y-5">
      <HrToolbar label={t("filters")}>
        <div className="grid w-full gap-2 sm:w-56">
          <Label htmlFor={`${id}-site`}>{t("site")}</Label>
          <HrSiteSelect
            id={`${id}-site`}
            surface="roster-site"
            value={site}
            onChange={setSite}
            placeholder={t("chooseSite")}
            emptyLabel={t("noSites")}
            disabled={assigning}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-month`}>{t("month")}</Label>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("previousMonth")}
              disabled={assigning || !validMonth}
              onClick={() => setMonth(shiftMonth(month, -1))}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Input
              id={`${id}-month`}
              type="month"
              value={month}
              disabled={assigning}
              onChange={(event) => setMonth(event.target.value)}
              className="w-40"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("nextMonth")}
              disabled={assigning || !validMonth}
              onClick={() => setMonth(shiftMonth(month, 1))}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div className="grid w-full gap-2 sm:w-56">
          <Label htmlFor={`${id}-search`}>{t("searchEmployee")}</Label>
          <Input
            id={`${id}-search`}
            type="search"
            value={search}
            disabled={assigning}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Button
          type="button"
          onClick={assignment.enter}
          disabled={assigning || value === undefined}
        >
          {t("assign")}
        </Button>
      </HrToolbar>
      {site === "" ? (
        <EmptyState title={t("chooseSite")} body={t("chooseSiteHint")} />
      ) : !validMonth ? (
        <p role="alert" className="text-sm text-danger">
          {t("monthInvalid")}
        </p>
      ) : (
        <HrQueryState outcome={outcome}>
          {() =>
            outcome?.ok && !outcome.value.ok ? (
              <HrInlineError code={outcome.value.code} />
            ) : value ? (
              <RosterAssignment
                key={`${site}:${month}`}
                value={value}
                siteId={site}
                assigning={assigning}
                onDone={assignment.back}
                onSaved={() => assignment.complete(() => {})}
                onPending={setPending}
              />
            ) : null
          }
        </HrQueryState>
      )}
    </div>
  );
}

type Selection = ReadonlyMap<
  string,
  { employeeId: string; date: string; expectedRevision: number }
>;

/**
 * The roster grid plus, while the assignment step is active, its local
 * selection draft and one action. Remote query updates refresh the cells
 * but keep the selection and the revisions it was made against.
 */
function RosterAssignment({
  value,
  siteId,
  assigning,
  onDone,
  onSaved,
  onPending,
}: {
  readonly value: RosterValue;
  readonly siteId: string;
  readonly assigning: boolean;
  readonly onDone: () => void;
  readonly onSaved: () => void;
  readonly onPending: (pending: boolean) => void;
}) {
  const t = useTranslations("Hr.shifts");
  const form = useTranslations("Hr.form");
  const id = useId();
  const save = useMutation(hrRefs.assignRoster);
  const [selected, setSelected] = useState<Selection>(new Map());
  const [action, setAction] = useState("");
  const [chosenShift, setChosenShift] = useState<ShiftRow | null>(null);
  const write = useHrWrite(`roster:${siteId}:${value.dates[0]?.date ?? ""}`);
  const op = useAsyncOperation({
    scope: `roster:${siteId}:${value.dates[0]?.date ?? ""}`,
    describeError: () => "",
    navigation: "owned",
  });
  useLayoutEffect(() => {
    onPending(write.pending);
    return () => onPending(false);
  }, [onPending, write.pending]);
  const dirty = assigning && (selected.size > 0 || action !== "");
  const reset = () => {
    setSelected(new Map());
    setAction("");
    setChosenShift(null);
  };
  // Completion settles this draft explicitly, then reset reports it clean.
  // A past receipt cannot make later selections in this mounted grid inert.
  const guard = useDraftGuard(dirty, reset, write.pending);
  const shifts = value.shifts.filter((shift) => shift.status === "ACTIVE");
  const choices =
    chosenShift !== null && !shifts.some((shift) => shift.id === chosenShift.id)
      ? [...shifts, chosenShift]
      : shifts;
  const chooseAction = (next: string) => {
    write.reset();
    setAction(next);
    setChosenShift(shifts.find((shift) => shift.id === next) ?? null);
  };
  const toggle = (employeeId: string, cell: RosterCell) => {
    write.reset();
    setSelected((current) => {
      const next = new Map(current);
      const key = `${employeeId}:${cell.date}`;
      if (next.has(key)) next.delete(key);
      else
        next.set(key, {
          employeeId,
          date: cell.date,
          expectedRevision: cell.revision,
        });
      return next;
    });
  };
  const finish = (result: HrWriteState<unknown>) => {
    if (
      result.kind === "REFUSED" &&
      (result.code === "SHIFT_STALE" || result.code === "SHIFT_INACTIVE")
    ) {
      // Keep the selected cells; choosing a definition again explicitly
      // accepts the current template version after reviewing the refusal.
      setAction("");
      setChosenShift(null);
    }
    if (result.kind === "SAVED")
      guard.settle(() => {
        reset();
        op.complete(onSaved);
      });
  };
  const submit = async () => {
    if (selected.size === 0 || action === "") return;
    const shift = chosenShift;
    const chosen =
      action === "OFF"
        ? ({ kind: "OFF" } as const)
        : action === "CLEAR"
          ? ({ kind: "CLEAR" } as const)
          : shift
            ? ({
                kind: "SHIFT",
                shiftId: shift.id,
                expectedShiftVersion: shift.version,
              } as const)
            : null;
    if (chosen === null) return;
    await op.run(
      () =>
        write.submit((requestId) =>
          save({
            requestId,
            warehouseId: siteId,
            action: chosen,
            cells: [...selected.values()],
          }),
        ),
      finish,
    );
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };
  return (
    <div className="space-y-4">
      {assigning ? (
        <form
          onSubmit={onSubmit}
          aria-label={t("assignLabel")}
          className="sticky bottom-0 z-10 grid gap-3 rounded-lg border border-border-strong bg-raised p-4 shadow-md sm:flex sm:flex-wrap sm:items-end"
        >
          <div className="grid gap-2 sm:w-72">
            <Label htmlFor={`${id}-action`}>{t("assignAction")}</Label>
            <SelectControl
              id={`${id}-action`}
              value={action}
              onValueChange={chooseAction}
              disabled={write.locked}
              placeholder={t("chooseAction")}
              emptyLabel={t("chooseAction")}
              options={[
                ...choices.map((shift) => ({
                  value: shift.id,
                  disabled: !shifts.some((current) => current.id === shift.id),
                  label: t("shiftOption", {
                    code:
                      chosenShift?.id === shift.id
                        ? chosenShift.code
                        : shift.code,
                    start:
                      chosenShift?.id === shift.id
                        ? chosenShift.startTime
                        : shift.startTime,
                    end:
                      chosenShift?.id === shift.id
                        ? chosenShift.endTime
                        : shift.endTime,
                  }),
                })),
                { value: "OFF", label: t("off") },
                { value: "CLEAR", label: t("clear") },
              ]}
            />
          </div>
          <p role="status" className="text-sm text-text sm:pb-2">
            {t("selectedCount", { count: selected.size })}
          </p>
          <div className="flex gap-2 sm:ml-auto">
            <Button
              type="button"
              variant="outline"
              disabled={write.pending}
              onClick={onDone}
            >
              {form("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={write.locked || selected.size === 0 || action === ""}
            >
              {write.pending ? form("submitting") : t("saveAssignment")}
            </Button>
          </div>
          <div className="w-full">
            <WriteFeedback
              state={write.state}
              onRetry={() => void op.run(() => write.retry(), finish)}
            />
          </div>
        </form>
      ) : null}
      {value.employees.length === 0 ? (
        <EmptyState title={t("noEmployees")} body={t("noEmployeesHint")} />
      ) : (
        <RosterGrid
          value={value}
          assigning={assigning && !write.locked}
          selected={selected}
          onToggle={toggle}
        />
      )}
    </div>
  );
}

function RosterGrid({
  value,
  assigning,
  selected,
  onToggle,
}: {
  readonly value: RosterValue;
  readonly assigning: boolean;
  readonly selected: Selection;
  readonly onToggle: (employeeId: string, cell: RosterCell) => void;
}) {
  const t = useTranslations("Hr.shifts");
  const plan = useTranslations("Hr.plan");
  const locale = useLocale();
  const weekday = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "UTC",
  });
  const label = (cell: RosterCell) =>
    cell.plan.reason === "HOLIDAY"
      ? (cell.plan.holidayName ?? plan("nonworking.HOLIDAY"))
      : cell.assignment?.kind === "SHIFT"
        ? cell.assignment.code
        : cell.assignment?.kind === "OFF"
          ? t("off")
          : cell.plan.kind === "SCHEDULED"
            ? `${cell.plan.startTime}–${cell.plan.endTime}`
            : "—";
  return (
    <TableScroller label={t("rosterTable")}>
      <table className="min-w-max border-separate border-spacing-0 text-xs">
        <caption className="sr-only">{t("rosterTable")}</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 min-w-48 border-b border-border bg-surface px-3 py-2 text-left font-medium text-muted"
            >
              {t("employee")}
            </th>
            {value.dates.map((day) => (
              <th
                key={day.date}
                scope="col"
                title={day.holidayName}
                className={`min-w-16 border-b border-border px-1 py-2 text-center font-medium ${day.holidayName ? "text-danger" : "text-muted"}`}
              >
                <time dateTime={day.date} className="block tabular-nums">
                  {Number(day.date.slice(8))}
                </time>
                <span className="block">
                  {weekday.format(new Date(`${day.date}T00:00:00Z`))}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {value.employees.map((employee) => (
            <tr key={employee.id}>
              <th
                scope="row"
                className="sticky left-0 z-10 border-b border-border bg-surface px-3 py-2 text-left"
              >
                <span className="block font-semibold text-text">
                  {employee.displayName}
                </span>
                <span className="block text-muted">
                  {employee.code}
                  {employee.departmentName
                    ? ` · ${employee.departmentName}`
                    : ""}
                </span>
              </th>
              {employee.cells.map((cell) => {
                const key = `${employee.id}:${cell.date}`;
                const isSelected = selected.has(key);
                const text = label(cell);
                const tone =
                  cell.assignment?.kind === "SHIFT"
                    ? "bg-accent-surface text-text"
                    : cell.assignment?.kind === "OFF"
                      ? "bg-raised text-muted"
                      : "text-muted";
                const content = (
                  <span className="inline-flex items-center gap-1 truncate">
                    {cell.assignment?.kind === "SHIFT" ? (
                      <Swatch color={cell.assignment.color} />
                    ) : null}
                    {text}
                  </span>
                );
                const name = t("cellLabel", {
                  employee: employee.displayName,
                  date: cell.date,
                  value: text,
                });
                return (
                  <td
                    key={cell.date}
                    className={`border-b border-border p-0.5 text-center ${tone}`}
                  >
                    {assigning ? (
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        aria-label={
                          cell.lock === null
                            ? name
                            : `${name}. ${t(`locks.${cell.lock}`)}`
                        }
                        disabled={cell.lock !== null}
                        title={
                          cell.lock === null
                            ? undefined
                            : t(`locks.${cell.lock}`)
                        }
                        onClick={() => onToggle(employee.id, cell)}
                        className={`flex min-h-touch w-full items-center justify-center rounded px-1 focus-ring disabled:cursor-not-allowed disabled:opacity-50 ${isSelected ? "bg-selected outline outline-2 outline-link" : "hover:bg-selected"}`}
                      >
                        {content}
                      </button>
                    ) : (
                      <span
                        className="flex min-h-touch items-center justify-center px-1"
                        title={name}
                      >
                        {content}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}
