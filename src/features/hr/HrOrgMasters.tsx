"use client";

import { useMutation, useQuery } from "convex/react";
import { Network, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { useDraftGuard } from "@/components/providers/draftGuard";
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
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/ui/Panel";
import { FormSelect } from "@/components/ui/FormSelect";
import { hrRefs } from "@/lib/convex/hrApi";
import { FOCUS_TARGET_IDS } from "@/lib/navigation";

import {
  optionalText,
  orgItems,
  OrgStatusBadge,
  useDialogCompletion,
  useRefusalFields,
  type FieldErrors,
  type MasterRow,
} from "./HrOrgShared";
import {
  HrInterrupted,
  HrPager,
  HrSearchField,
  useHrPagedQuery,
  type HrPageRow,
} from "./HrPagedList";
import { HrQueryState, WriteFeedback } from "./HrShared";
import { SettingsHeading } from "./HrSettingsHeading";
import { useHrWrite, type HrWriteState } from "./useHrWrite";

type Kind = "department" | "position" | "level";
const KINDS: readonly Kind[] = ["department", "position", "level"];
/** The master an editor is open for; a `null` id is a new entry. */
type Target = { readonly kind: Kind; readonly id: string | null };

const LIST_REFS = {
  department: hrRefs.listDepartments,
  position: hrRefs.listPositions,
  level: hrRefs.listLevels,
} as const;

/** Departments (with an optional manager), positions and levels. */
export function OrganizationPanel() {
  const t = useTranslations("Hr.settings");
  const id = useId();
  const outcomes = {
    department: useQuery(LIST_REFS.department, {}),
    position: useQuery(LIST_REFS.position, {}),
    level: useQuery(LIST_REFS.level, {}),
  };
  const [target, setTarget] = useState<Target | null>(null);
  // Forward reopens the editor this entry belonged to.
  const last = useRef<Target>({ kind: "department", id: null });
  const open = (next: Target) => {
    last.current = next;
    setTarget(next);
  };
  const editing =
    target === null || target.id === null
      ? undefined
      : orgItems<MasterRow>(outcomes[target.kind])?.find(
          (row) => row.id === target.id,
        );
  return (
    <Panel
      id={FOCUS_TARGET_IDS.organization}
      aria-labelledby={`${id}-title`}
      className="space-y-5 xl:col-span-2"
    >
      <SettingsHeading
        id={`${id}-title`}
        icon={<Network aria-hidden="true" className="size-5" />}
        title={t("organization")}
        description={t("organizationIntro")}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        {KINDS.map((kind) => (
          <MasterList
            key={kind}
            kind={kind}
            outcome={outcomes[kind]}
            disabled={target !== null}
            onAdd={() => open({ kind, id: null })}
            onEdit={(row) => open({ kind, id: row.id })}
          />
        ))}
      </div>
      <MasterEditor
        target={target}
        row={editing}
        onOpenChange={(next) => setTarget(next ? last.current : null)}
      />
    </Panel>
  );
}

function MasterList({
  kind,
  outcome,
  disabled,
  onAdd,
  onEdit,
}: {
  readonly kind: Kind;
  readonly outcome: unknown;
  readonly disabled: boolean;
  readonly onAdd: () => void;
  readonly onEdit: (row: MasterRow) => void;
}) {
  const t = useTranslations("Hr.org");
  const id = useId();
  const rows = orgItems<MasterRow>(outcome) ?? [];
  const title = t(
    kind === "department"
      ? "departments"
      : kind === "position"
        ? "positions"
        : "levels",
  );
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-title`} className="text-base font-semibold text-text">
          {title}
        </h3>
        <Button
          type="button"
          variant="outline"
          onClick={onAdd}
          disabled={disabled}
        >
          <Plus aria-hidden="true" />
          {t(`add.${kind}`)}
        </Button>
      </div>
      <HrQueryState
        outcome={
          outcome as Parameters<typeof HrQueryState>[0]["outcome"] | undefined
        }
      >
        {() =>
          rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted">
              {t(`empty.${kind}`)}
            </p>
          ) : (
            <ul
              aria-label={title}
              className="divide-y divide-border rounded-lg border border-border"
            >
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-start justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0 text-sm">
                    <span className="block font-semibold break-words text-text">
                      {row.name}
                    </span>
                    {row.nameEn ? (
                      <span className="block text-xs break-words text-muted">
                        {row.nameEn}
                      </span>
                    ) : null}
                    {kind === "level" ? (
                      <span className="block text-xs text-muted">
                        {t("sortOrderValue", { order: row.sortOrder ?? 0 })}
                      </span>
                    ) : null}
                    {row.managerEmployeeId === undefined ? null : (
                      <ManagerName employeeId={row.managerEmployeeId} />
                    )}
                    <span className="mt-1 block">
                      <OrgStatusBadge status={row.status} />
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    aria-label={t(`editLabel.${kind}`, { name: row.name })}
                    onClick={() => onEdit(row)}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )
        }
      </HrQueryState>
    </section>
  );
}

/** One shared Back-aware Dialog for department, position and level edits. */
function MasterEditor({
  target,
  row,
  onOpenChange,
}: {
  readonly target: Target | null;
  readonly row: MasterRow | undefined;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Hr.org");
  const dialog = useRef<DialogCompletionHandle>(null);
  const [pending, setPending] = useState(false);
  const completed = useDialogCompletion(pending, dialog, () =>
    onOpenChange(false),
  );
  const kind = target?.kind ?? "department";
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
          <DialogTitle>
            {isNew ? t(`add.${kind}`) : t(`editTitle.${kind}`)}
          </DialogTitle>
        </DialogHeader>
        {ready ? (
          <MasterForm
            key={`${kind}:${row?.id ?? "new"}`}
            kind={kind}
            row={row}
            onPending={setPending}
            onSaved={completed}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface Draft {
  name: string;
  nameEn: string;
  managerEmployeeId: string;
  sortOrder: string;
  active: boolean;
}

function MasterForm({
  kind,
  row: opened,
  onPending,
  onSaved,
}: {
  readonly kind: Kind;
  readonly row: MasterRow | undefined;
  readonly onPending: (pending: boolean) => void;
  readonly onSaved: () => void;
}) {
  const t = useTranslations("Hr.org");
  const form = useTranslations("Hr.form");
  const refusal = useRefusalFields();
  const id = useId();
  const saveDepartment = useMutation(hrRefs.saveDepartment);
  const savePosition = useMutation(hrRefs.savePosition);
  const saveLevel = useMutation(hrRefs.saveLevel);
  // The version this editor opened; a concurrent edit is refused as stale
  // instead of being overwritten by a save built on the live row.
  const [row] = useState(opened);
  const write = useHrWrite(
    `org-${kind}:${row?.id ?? "new"}:${row?.version ?? 0}`,
  );
  useLayoutEffect(() => {
    onPending(write.pending);
    return () => onPending(false);
  }, [onPending, write.pending]);
  const [initial] = useState<Draft>(() => ({
    name: row?.name ?? "",
    nameEn: row?.nameEn ?? "",
    managerEmployeeId: row?.managerEmployeeId ?? "",
    sortOrder: String(row?.sortOrder ?? ""),
    active: (row?.status ?? "ACTIVE") === "ACTIVE",
  }));
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const guard = useDraftGuard(
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
    const next: Record<string, string> = {};
    if (draft.name.trim() === "") next.name = t("required");
    const sortOrder = Number(draft.sortOrder);
    if (
      kind === "level" &&
      (draft.sortOrder.trim() === "" || !Number.isSafeInteger(sortOrder))
    )
      next.sortOrder = t("sortOrderInvalid");
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const status = draft.active ? ("ACTIVE" as const) : ("INACTIVE" as const);
    const name = draft.name.trim();
    const nameEn = optionalText(draft.nameEn);
    const version = row === undefined ? {} : { expectedVersion: row.version };
    finish(
      await write.submit((requestId) =>
        kind === "level"
          ? saveLevel({
              requestId,
              ...version,
              ...(row === undefined ? {} : { levelId: row.id }),
              name,
              sortOrder,
              status,
            })
          : kind === "position"
            ? savePosition({
                requestId,
                ...version,
                ...(row === undefined ? {} : { positionId: row.id }),
                name,
                ...(nameEn === undefined ? {} : { nameEn }),
                status,
              })
            : saveDepartment({
                requestId,
                ...version,
                ...(row === undefined ? {} : { departmentId: row.id }),
                name,
                ...(nameEn === undefined ? {} : { nameEn }),
                ...(draft.managerEmployeeId === ""
                  ? {}
                  : { managerEmployeeId: draft.managerEmployeeId }),
                status,
              }),
      ),
    );
  };
  const finish = (result: HrWriteState<unknown>) => {
    setErrors(refusal(result));
    // The guard's history buffer leaves first; then the Dialog completes.
    if (result.kind === "SAVED") guard.settle(onSaved);
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <fieldset disabled={write.locked} className="grid gap-4">
        <FormField
          id={`${id}-name`}
          label={t(`nameLabel.${kind}`)}
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
        {kind === "level" ? (
          <FormField
            id={`${id}-order`}
            label={t("sortOrder")}
            required
            hint={t("sortOrderHint")}
            error={errors.sortOrder}
          >
            {(field) => (
              <Input
                {...field}
                type="number"
                step={1}
                inputMode="numeric"
                value={draft.sortOrder}
                onChange={(e) => set("sortOrder", e.target.value)}
              />
            )}
          </FormField>
        ) : (
          <FormField
            id={`${id}-name-en`}
            label={t(`nameEnLabel.${kind}`)}
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
        )}
        {kind === "department" ? (
          <ManagerPickerField
            id={`${id}-manager`}
            value={draft.managerEmployeeId}
            onChange={(value) => set("managerEmployeeId", value)}
            error={errors.managerEmployeeId}
          />
        ) : null}
        <div className="grid gap-1">
          <label className="flex min-h-touch items-center gap-2 text-sm text-text">
            <CheckboxControl
              checked={draft.active}
              aria-describedby={`${id}-active-hint`}
              onChange={(e) => set("active", e.target.checked)}
            />
            {t("active")}
          </label>
          <p id={`${id}-active-hint`} className="text-xs text-muted">
            {t("activeHint")}
          </p>
        </div>
      </fieldset>
      <WriteFeedback
        state={write.state}
        onRetry={() => void write.retry().then(finish)}
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

type EmployeeRow = HrPageRow<typeof hrRefs.employeesPage>;

/** A manager's current name, read by ID so scope is the server's answer. */
function useEmployeeName(employeeId: string) {
  const outcome = useQuery(
    hrRefs.employee,
    employeeId === "" ? "skip" : { employeeId },
  ) as
    | {
        ok?: boolean;
        value?: {
          ok?: boolean;
          employee?: { displayName?: string; code?: string };
        };
      }
    | undefined;
  if (outcome === undefined) return { kind: "LOADING" } as const;
  const employee = outcome.ok ? outcome.value?.employee : undefined;
  return outcome.ok && outcome.value?.ok === true && employee?.displayName
    ? ({
        kind: "FOUND",
        label: `${employee.displayName} · ${employee.code ?? ""}`,
        name: employee.displayName,
      } as const)
    : ({ kind: "UNAVAILABLE" } as const);
}

function ManagerName({ employeeId }: { readonly employeeId: string }) {
  const t = useTranslations("Hr.org");
  const manager = useEmployeeName(employeeId);
  return (
    <span className="block text-xs text-muted">
      {t("managerOf", {
        name:
          manager.kind === "FOUND"
            ? manager.name
            : manager.kind === "LOADING"
              ? "…"
              : t("managerUnknown"),
      })}
    </span>
  );
}

/**
 * Active employees, searchable and paged across the whole registry like the
 * member picker. The current manager keeps its name while it is not among
 * the shown options; the server re-validates the choice on save.
 */
function ManagerPickerField({
  id,
  value,
  onChange,
  error,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string | undefined;
}) {
  const t = useTranslations("Hr.org");
  const [search, setSearch] = useState("");
  const { view, paging } = useHrPagedQuery(
    hrRefs.employeesPage,
    { status: "ACTIVE", ...(search === "" ? {} : { search }) },
    `department-manager:${id}`,
  );
  const current = useEmployeeName(value);
  const busy =
    view.kind === "loading" || (view.kind === "ready" && view.updating);
  const shown =
    view.kind === "ready" && !view.updating
      ? view.rows.map((employee: EmployeeRow) => ({
          value: employee.id,
          label: `${employee.displayName} · ${employee.code}`,
        }))
      : [];
  const options = [
    { value: "", label: t("noManager") },
    ...(value !== "" && !shown.some((option) => option.value === value)
      ? [
          {
            value,
            label:
              current.kind === "FOUND"
                ? current.label
                : current.kind === "LOADING"
                  ? t("currentManager")
                  : t("managerUnknown"),
          },
        ]
      : []),
    ...shown,
  ];
  return (
    <div className="grid min-w-0 content-start gap-2">
      <FormSelect
        id={id}
        label={t("manager")}
        hint={t("managerHint")}
        error={error}
        value={value}
        onValueChange={onChange}
        options={options}
        placeholder={t("noManager")}
        emptyLabel={t("noEmployees")}
        pending={busy}
      />
      {view.kind === "interrupted" ? (
        <HrInterrupted view={view} compact />
      ) : null}
      <HrSearchField
        id={`${id}-search`}
        label={t("managerSearch")}
        value={search}
        onSettled={setSearch}
        className="grid w-full gap-1"
      />
      {view.kind === "ready" &&
      !view.updating &&
      shown.length === 0 &&
      search !== "" ? (
        <p className="text-xs text-muted" role="status">
          {t("noManagerMatches")}
        </p>
      ) : null}
      <HrPager paging={paging} label={t("managerPagination")} />
    </div>
  );
}
