"use client";

import { useQuery } from "convex/react";
import { Pencil, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { flushSync } from "react-dom";

import { useHrAccess, useHrCan } from "@/components/providers/HrAccessProvider";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableScroller } from "@/components/ui/TableScroller";
import { usePageSearchContext } from "@/components/shell/search/pageContext";
import { hrRefs } from "@/lib/convex/hrApi";
import {
  useDeepLinkFocus,
  useGuardedUrl,
  useQueryParams,
  useUrlBackedState,
} from "@/lib/deepLink";
import {
  FOCUS_TARGET_IDS,
  HR_CODES,
  ROUTES,
  destinationHref,
  readEmployeesUrl,
  type EmployeesUrlState,
} from "@/lib/navigation";

import { EmployeeForm, type EmployeeRecord } from "./EmployeeForm";
import { workDaysLabel } from "./format";
import { HrGate, HrInlineError, HrQueryState, PlanText } from "./HrShared";
import { HrInitials } from "./HrUi";

type EmployeeRow = {
  readonly id: string;
  readonly code: string;
  readonly displayName: string;
  readonly status: "ACTIVE" | "INACTIVE";
  readonly siteCode: string;
  readonly linkedUserId?: string | undefined;
  readonly linkedName?: string | undefined;
  readonly linkedActive: boolean;
  readonly supervisorName?: string | null | undefined;
  readonly schedule?: EmployeeRecord["schedule"];
};

type Editing = Exclude<EmployeesUrlState, { mode: "LIST" }>;

export function HrEmployeesScreen() {
  const t = useTranslations("Hr.employees");
  const canManage = useHrCan(HR_CODES.admin);
  const params = useQueryParams();
  const url = readEmployeesUrl(params);
  const navigate = useGuardedUrl();
  // The open editor follows the URL (`?employee=<id>&mode=edit`), so a link
  // opens any employee by ID, beyond the bounded registry list.
  const [editing, setEditing] = useUrlBackedState<Editing | undefined>(
    params.toString(),
    url.mode === "LIST" ? undefined : url,
  );
  const open = (next: Editing) =>
    navigate(
      next.mode === "NEW"
        ? `${ROUTES.hrEmployees}?mode=new`
        : (destinationHref({
            key: "hr.employeeEdit",
            employeeId: next.employeeId,
          }) ?? ROUTES.hrEmployees),
      () => setEditing(next),
    );
  // Closing unmounts the form first (Cancel deliberately discards its draft;
  // a save has already persisted it), so leaving the editor URL afterwards
  // passes the unsaved-work guard without a prompt.
  const close = () => {
    flushSync(() => setEditing(undefined));
    navigate(ROUTES.hrEmployees, undefined, "replace");
  };
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} showBack={false}>
        {canManage ? (
          <Button
            type="button"
            onClick={() => open({ mode: "NEW" })}
            disabled={editing !== undefined}
            data-testid="hr-employee-add"
          >
            <Plus aria-hidden="true" />
            {t("add")}
          </Button>
        ) : null}
      </PageHeader>
      <HrGate code={HR_CODES.admin}>
        <EmployeesContent
          editing={editing}
          invalidLink={url.mode === "LIST" && url.invalid}
          linkFocus={
            url.mode === "EDIT" && url.focus !== undefined ? url.focus : null
          }
          linkToken={params.toString()}
          onEdit={(employeeId) => open({ mode: "EDIT", employeeId })}
          onClose={close}
        />
      </HrGate>
    </>
  );
}

function EmployeesContent({
  editing,
  invalidLink,
  linkFocus,
  linkToken,
  onEdit,
  onClose,
}: {
  readonly editing: Editing | undefined;
  readonly invalidLink: boolean;
  readonly linkFocus: "schedule" | "details" | null;
  readonly linkToken: string;
  readonly onEdit: (employeeId: string) => void;
  readonly onClose: () => void;
}) {
  const t = useTranslations("Hr.employees");
  const access = useHrAccess();
  const outcome = useQuery(hrRefs.listEmployees, {});

  return (
    <div className="space-y-6">
      {invalidLink ? <HrInlineError code="NOT_FOUND" /> : null}
      {editing === undefined ? null : editing.mode === "NEW" ? (
        <EmployeeForm
          key="new"
          sites={access.sites}
          today={access.today ?? ""}
          onDone={onClose}
        />
      ) : (
        <EmployeeEditor
          employeeId={editing.employeeId}
          focus={linkFocus}
          token={linkToken}
          onDone={onClose}
        />
      )}
      <HrQueryState outcome={outcome}>
        {() => {
          if (!outcome?.ok) return null;
          const { items, complete } = outcome.value;
          if (access.sites.length === 0)
            return (
              <Notice
                tone="warning"
                title={t("noSites")}
                body={t("noSitesHint")}
              />
            );
          if (items.length === 0)
            return <EmptyState title={t("empty")} body={t("emptyHint")} />;
          const edit = (employee: EmployeeRow) => onEdit(employee.id);
          return (
            <div className="space-y-3">
              {complete ? null : (
                <Notice tone="warning" role="alert" title={t("incomplete")} />
              )}
              <p className="text-sm text-muted" role="status">
                {t("count", { count: items.length })}
              </p>
              <div className="hidden lg:block">
                <EmployeeTable
                  items={items}
                  onEdit={edit}
                  disabled={editing !== undefined}
                />
              </div>
              <ul className="space-y-3 lg:hidden" aria-label={t("tableLabel")}>
                {items.map((employee) => (
                  <li
                    key={employee.id}
                    className="space-y-3 rounded-xl border border-border bg-surface p-4"
                  >
                    <div className="flex items-start gap-3">
                      <HrInitials name={employee.displayName} />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold break-words text-text">
                          {employee.displayName}
                        </p>
                        <p className="text-xs text-muted">
                          {employee.code} · {employee.siteCode}
                        </p>
                      </div>
                      <EmployeeStatus status={employee.status} />
                    </div>
                    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-muted">{t("account")}</dt>
                        <dd>
                          <AccountCell employee={employee} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">
                          {t("supervisor")}
                        </dt>
                        <dd className="text-text">
                          {employee.supervisorName ?? "—"}
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-muted">{t("schedule")}</dt>
                        <dd>
                          <ScheduleCell employee={employee} />
                        </dd>
                      </div>
                    </dl>
                    <EditButton
                      employee={employee}
                      onEdit={edit}
                      disabled={editing !== undefined}
                      className="w-full sm:w-auto"
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        }}
      </HrQueryState>
    </div>
  );
}

/** The editor for one employee, loaded by ID rather than from the list. */
function EmployeeEditor({
  employeeId,
  focus,
  token,
  onDone,
}: {
  readonly employeeId: string;
  readonly focus: "schedule" | "details" | null;
  readonly token: string;
  readonly onDone: () => void;
}) {
  const t = useTranslations("Hr.employees");
  const access = useHrAccess();
  const outcome = useQuery(hrRefs.employee, { employeeId });
  const loaded =
    outcome?.ok === true && outcome.value.ok ? outcome.value.employee : null;
  useDeepLinkFocus(
    focus === null ? null : FOCUS_TARGET_IDS[focus],
    loaded !== null,
    token,
  );
  usePageSearchContext(
    loaded === null
      ? null
      : {
          page: "hr.employees",
          employee: {
            id: loaded.id,
            code: loaded.code,
            name: loaded.displayName,
          },
        },
  );
  return (
    <HrQueryState outcome={outcome}>
      {() => {
        if (!outcome?.ok) return null;
        const result = outcome.value;
        if (!result.ok)
          return (
            <div className="space-y-3">
              <HrInlineError code={result.code} />
              <Button type="button" variant="outline" onClick={onDone}>
                {t("backToList")}
              </Button>
            </div>
          );
        const employee = result.employee as EmployeeRecord;
        return (
          <EmployeeForm
            key={`${employee.id}:${employee.version}`}
            employee={employee}
            sites={access.sites}
            today={access.today ?? ""}
            onDone={onDone}
          />
        );
      }}
    </HrQueryState>
  );
}

function EmployeeTable({
  items,
  onEdit,
  disabled,
}: {
  readonly items: readonly EmployeeRow[];
  readonly onEdit: (employee: EmployeeRow) => void;
  readonly disabled: boolean;
}) {
  const t = useTranslations("Hr.employees");
  return (
    <TableScroller label={t("tableLabel")}>
      <Table scroll={false} className="table-fixed">
        <colgroup>
          <col className="w-[28%]" />
          <col className="w-[17%]" />
          <col className="w-[16%]" />
          <col className="w-[18%]" />
          <col className="w-[10%]" />
          <col className="w-[11%]" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>{t("employee")}</TableHead>
            <TableHead>{t("account")}</TableHead>
            <TableHead>{t("supervisor")}</TableHead>
            <TableHead>{t("schedule")}</TableHead>
            <TableHead>{t("status")}</TableHead>
            <TableHead>
              <span className="sr-only">{t("actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((employee) => (
            <TableRow key={employee.id}>
              <TableCell>
                <div className="flex min-w-0 items-center gap-3">
                  <HrInitials name={employee.displayName} size="sm" />
                  <div className="min-w-0">
                    <span className="block truncate font-semibold text-text">
                      {employee.displayName}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {employee.code} · {employee.siteCode}
                    </span>
                  </div>
                </div>
              </TableCell>
              <TableCell className="break-words whitespace-normal">
                <AccountCell employee={employee} />
              </TableCell>
              <TableCell className="break-words whitespace-normal">
                {employee.supervisorName ?? "—"}
              </TableCell>
              <TableCell className="whitespace-normal">
                <ScheduleCell employee={employee} />
              </TableCell>
              <TableCell>
                <EmployeeStatus status={employee.status} />
              </TableCell>
              <TableCell className="px-2 text-right">
                <EditButton
                  employee={employee}
                  onEdit={onEdit}
                  disabled={disabled}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableScroller>
  );
}

function EmployeeStatus({ status }: { readonly status: string }) {
  const t = useTranslations("Hr.employees");
  return (
    <StatusBadge
      tone={status === "ACTIVE" ? "success" : "muted"}
      label={t(status === "ACTIVE" ? "active" : "inactive")}
    />
  );
}

function AccountCell({ employee }: { readonly employee: EmployeeRow }) {
  const t = useTranslations("Hr.employees");
  if (!employee.linkedUserId)
    return <StatusBadge tone="muted" label={t("unlinked")} />;
  return (
    <span className="text-text">
      {employee.linkedName ?? t("unknownMember")}
      {employee.linkedActive ? null : (
        <span className="block text-xs text-warning">
          {t("memberInactive")}
        </span>
      )}
    </span>
  );
}

function ScheduleCell({ employee }: { readonly employee: EmployeeRow }) {
  const t = useTranslations("Hr.employees");
  const locale = useLocale();
  if (!employee.schedule)
    return <span className="text-muted">{t("noSchedule")}</span>;
  return (
    <span className="block text-sm">
      <span className="block font-medium text-text">
        {workDaysLabel(employee.schedule.workDays, locale, t("everyDay"))}
      </span>
      <span className="block text-xs text-muted">
        <PlanText plan={{ kind: "SCHEDULED", ...employee.schedule }} />
      </span>
    </span>
  );
}

function EditButton({
  employee,
  onEdit,
  disabled,
  className,
}: {
  readonly employee: EmployeeRow;
  readonly onEdit: (employee: EmployeeRow) => void;
  readonly disabled: boolean;
  readonly className?: string;
}) {
  const t = useTranslations("Hr.employees");
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => onEdit(employee)}
      disabled={disabled}
      aria-label={t("editLabel", { name: employee.displayName })}
      className={className}
    >
      <Pencil aria-hidden="true" />
      {t("edit")}
    </Button>
  );
}
