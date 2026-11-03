"use client";

import { useMutation, useQuery } from "convex/react";
import { MapPinned, Pencil, Plus } from "lucide-react";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogCompletionHandle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/ui/Panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableScroller } from "@/components/ui/TableScroller";
import { hrRefs } from "@/lib/convex/hrApi";
import { FOCUS_TARGET_IDS } from "@/lib/navigation";

import {
  AddressFields,
  addressDraft,
  addressPayload,
  missingFields,
  RadioFieldset,
  REQUIRED_ADDRESS,
  optionalText,
  orgItems,
  OrgStatusBadge,
  useDialogCompletion,
  useRefusalFields,
  type AddressDraft,
  type BranchRow,
  type FieldErrors,
} from "./HrOrgShared";
import { HrQueryState, WriteFeedback } from "./HrShared";
import { SettingsHeading } from "./HrSettingsHeading";
import { useHrWrite, type HrWriteState } from "./useHrWrite";

/** The branch an editor is open for; `null` id is a new branch. */
type Target = { readonly id: string | null };

export function BranchesPanel() {
  const t = useTranslations("Hr.settings");
  const org = useTranslations("Hr.org");
  const id = useId();
  const outcome = useQuery(hrRefs.listBranches, {});
  const rows = orgItems<BranchRow>(outcome) ?? [];
  const [target, setTarget] = useState<Target | null>(null);
  // Forward reopens the editor this entry belonged to.
  const last = useRef<Target>({ id: null });
  const open = (next: Target) => {
    last.current = next;
    setTarget(next);
  };
  const editing =
    target === null || target.id === null
      ? undefined
      : rows.find((row) => row.id === target.id);
  return (
    <Panel
      id={FOCUS_TARGET_IDS.branches}
      aria-labelledby={`${id}-title`}
      className="space-y-4 xl:col-span-2"
    >
      <SettingsHeading
        id={`${id}-title`}
        icon={<MapPinned aria-hidden="true" className="size-5" />}
        title={t("branches")}
        description={t("branchesIntro")}
        action={
          <Button
            type="button"
            onClick={() => open({ id: null })}
            disabled={target !== null}
          >
            <Plus aria-hidden="true" />
            {org("addBranch")}
          </Button>
        }
      />
      <HrQueryState outcome={outcome}>
        {() =>
          rows.length === 0 ? (
            <EmptyState
              title={org("noBranches")}
              body={org("noBranchesHint")}
            />
          ) : (
            <BranchTable
              rows={rows}
              disabled={target !== null}
              onEdit={(row) => open({ id: row.id })}
            />
          )
        }
      </HrQueryState>
      <BranchEditor
        target={target}
        branch={editing}
        onOpenChange={(next) => setTarget(next ? last.current : null)}
      />
    </Panel>
  );
}

function BranchTable({
  rows,
  disabled,
  onEdit,
}: {
  readonly rows: readonly BranchRow[];
  readonly disabled: boolean;
  readonly onEdit: (row: BranchRow) => void;
}) {
  const t = useTranslations("Hr.org");
  return (
    <TableScroller label={t("branchesTable")}>
      <Table scroll={false} aria-label={t("branchesTable")}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("branchName")}</TableHead>
            <TableHead>{t("revenueBranchNoShort")}</TableHead>
            <TableHead>{t("ssoEmployerAccountShort")}</TableHead>
            <TableHead>{t("branchType")}</TableHead>
            <TableHead>{t("status")}</TableHead>
            <TableHead>
              <span className="sr-only">{t("actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="whitespace-normal">
                <span className="block font-semibold text-text">
                  {row.name}
                </span>
                {row.nameEn ? (
                  <span className="block text-xs text-muted">{row.nameEn}</span>
                ) : null}
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {row.revenueBranchNo}
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {row.ssoEmployerAccount}
              </TableCell>
              <TableCell>{t(`type.${row.type}`)}</TableCell>
              <TableCell>
                <OrgStatusBadge status={row.status} />
              </TableCell>
              <TableCell className="px-2 text-right">
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  aria-label={t("editBranchLabel", { name: row.name })}
                  onClick={() => onEdit(row)}
                >
                  <Pencil aria-hidden="true" />
                  {t("edit")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableScroller>
  );
}

/**
 * The shared Back-aware Dialog owns the editor's history entry: Back or
 * Cancel asks before discarding typed changes, a pending save blocks
 * dismissal, and a save consumes the entry before the editor closes.
 */
function BranchEditor({
  target,
  branch,
  onOpenChange,
}: {
  readonly target: Target | null;
  readonly branch: BranchRow | undefined;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Hr.org");
  const dialog = useRef<DialogCompletionHandle>(null);
  // The form owns its write; a pending save keeps the Dialog from closing.
  const [pending, setPending] = useState(false);
  const completed = useDialogCompletion(pending, dialog, () =>
    onOpenChange(false),
  );
  const isNew = target?.id === null;
  // An edited branch that no longer exists (or has not loaded) shows nothing.
  const ready = target !== null && (isNew || branch !== undefined);
  return (
    <Dialog
      open={target !== null}
      onOpenChange={onOpenChange}
      backPending={pending}
      completionRef={dialog}
    >
      <DialogContent closeLabel={t("closeDialog")}>
        <DialogHeader>
          <DialogTitle>{t(isNew ? "addBranch" : "editBranch")}</DialogTitle>
          <DialogDescription>{t("branchDescription")}</DialogDescription>
        </DialogHeader>
        {ready ? (
          <BranchForm
            key={branch?.id ?? "new"}
            branch={branch}
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
  revenueBranchNo: string;
  ssoEmployerAccount: string;
  type: "HEAD_OFFICE" | "BRANCH";
  address: AddressDraft;
  active: boolean;
}
const draftOf = (row: BranchRow | undefined): Draft => ({
  name: row?.name ?? "",
  nameEn: row?.nameEn ?? "",
  revenueBranchNo: row?.revenueBranchNo ?? "",
  ssoEmployerAccount: row?.ssoEmployerAccount ?? "",
  type: row?.type ?? "BRANCH",
  address: addressDraft(row),
  active: (row?.status ?? "ACTIVE") === "ACTIVE",
});

function BranchForm({
  branch: opened,
  onPending,
  onSaved,
}: {
  readonly branch: BranchRow | undefined;
  readonly onPending: (pending: boolean) => void;
  readonly onSaved: () => void;
}) {
  const t = useTranslations("Hr.org");
  const form = useTranslations("Hr.form");
  const refusal = useRefusalFields();
  const id = useId();
  const save = useMutation(hrRefs.saveBranch);
  // The version this editor opened; a concurrent edit is refused as stale
  // instead of being overwritten by a save built on the live row.
  const [branch] = useState(opened);
  const write = useHrWrite(
    `org-branch:${branch?.id ?? "new"}:${branch?.version ?? 0}`,
  );
  useLayoutEffect(() => {
    onPending(write.pending);
    return () => onPending(false);
  }, [onPending, write.pending]);
  const [initial] = useState(() => draftOf(branch));
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

  // A head office uses branch number 00000: fill it in when the number is
  // still empty, but never replace one the user typed.
  const chooseType = (type: Draft["type"]) =>
    setDraft((current) => ({
      ...current,
      type,
      ...(type === "HEAD_OFFICE" && current.revenueBranchNo.trim() === ""
        ? { revenueBranchNo: "00000" }
        : {}),
    }));
  const validate = (): FieldErrors => {
    const next = missingFields(
      {
        name: draft.name,
        revenueBranchNo: draft.revenueBranchNo,
        ssoEmployerAccount: draft.ssoEmployerAccount,
        ...draft.address,
      },
      ["name", "revenueBranchNo", "ssoEmployerAccount", ...REQUIRED_ADDRESS],
      t("required"),
    );
    if (
      next.revenueBranchNo === undefined &&
      !/^\d{5}$/.test(draft.revenueBranchNo.trim())
    )
      next.revenueBranchNo = t("revenueBranchNoInvalid");
    if (
      next.ssoEmployerAccount === undefined &&
      !/^[0-9-]{1,20}$/.test(draft.ssoEmployerAccount.trim())
    )
      next.ssoEmployerAccount = t("ssoInvalid");
    if (
      next.revenueBranchNo === undefined &&
      (draft.type === "HEAD_OFFICE") !==
        (draft.revenueBranchNo.trim() === "00000")
    )
      next.type = t("typeMismatch");
    return next;
  };
  const send = async () => {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const nameEn = optionalText(draft.nameEn);
    finish(
      await write.submit((requestId) =>
        save({
          requestId,
          ...(branch === undefined
            ? {}
            : { branchId: branch.id, expectedVersion: branch.version }),
          name: draft.name.trim(),
          ...(nameEn === undefined ? {} : { nameEn }),
          revenueBranchNo: draft.revenueBranchNo.trim(),
          ssoEmployerAccount: draft.ssoEmployerAccount.trim(),
          type: draft.type,
          ...addressPayload(draft.address),
          status: draft.active ? "ACTIVE" : "INACTIVE",
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
      <fieldset disabled={write.locked} className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id={`${id}-name`}
            label={t("branchName")}
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
            id={`${id}-name-en`}
            label={t("branchNameEn")}
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
            id={`${id}-revenue`}
            label={t("revenueBranchNo")}
            required
            hint={t("revenueBranchNoHint")}
            error={errors.revenueBranchNo}
          >
            {(field) => (
              <Input
                {...field}
                value={draft.revenueBranchNo}
                inputMode="numeric"
                maxLength={5}
                autoComplete="off"
                onChange={(e) => set("revenueBranchNo", e.target.value)}
              />
            )}
          </FormField>
          <FormField
            id={`${id}-sso`}
            label={t("ssoEmployerAccount")}
            required
            hint={t("ssoHint")}
            error={errors.ssoEmployerAccount}
          >
            {(field) => (
              <Input
                {...field}
                value={draft.ssoEmployerAccount}
                inputMode="numeric"
                maxLength={20}
                autoComplete="off"
                onChange={(e) => set("ssoEmployerAccount", e.target.value)}
              />
            )}
          </FormField>
        </div>
        <RadioFieldset
          id={`${id}-type`}
          legend={t("branchType")}
          value={draft.type}
          options={(["HEAD_OFFICE", "BRANCH"] as const).map((type) => ({
            value: type,
            label: t(`type.${type}`),
          }))}
          onChange={chooseType}
          error={errors.type}
        />
        <AddressFields
          id={`${id}-address`}
          value={draft.address}
          errors={errors}
          onChange={(key, value) =>
            set("address", { ...draft.address, [key]: value })
          }
        />
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
          {write.pending ? form("submitting") : t("saveBranch")}
        </Button>
      </DialogFooter>
    </form>
  );
}
