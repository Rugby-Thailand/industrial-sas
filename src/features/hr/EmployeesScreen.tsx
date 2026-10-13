"use client";

import { useQuery } from "convex/react";
import { Pencil, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useLayoutEffect, useRef } from "react";
import { appHistoryIndex } from "@/lib/browser/appHistory";
import { updateHistoryMetadata } from "@/lib/browser/history";
import { traverseBack } from "@/lib/navigationGuard";
import { flushSync } from "react-dom";

import { useHrAccess, useHrCan } from "@/components/providers/HrAccessProvider";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { SelectControl } from "@/components/ui/SelectControl";
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
import {
  HrGate,
  HrInlineError,
  HrQueryState,
  PlanText,
  useHrBack,
} from "./HrShared";
import {
  navigationKey,
  useCarriedListState,
  useHrListCriteria,
} from "./HrListCriteria";
import {
  HrPagedState,
  HrPager,
  HrSearchField,
  useHrPagedQuery,
} from "./HrPagedList";
import { HrSiteSelect } from "./HrSiteSelect";
import { HrInitials, HrToolbar } from "./HrUi";

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
  const back = useHrBack();
  const canManage = useHrCan(HR_CODES.admin);
  const params = useQueryParams();
  const url = readEmployeesUrl(params);
  const navigate = useGuardedUrl();
  const openedFrom = useRef<{ url: string; index: number } | null>(null);
  // The open editor follows the URL (`?employee=<id>&mode=edit`), so a link
  // opens any employee by ID, beyond the bounded registry list.
  const [editing, setEditing] = useUrlBackedState<Editing | undefined>(
    navigationKey(params, LIST_KEYS),
    url.mode === "LIST" ? undefined : url,
  );
  // The list criteria travel with the editor URL, so closing or Back
  // returns to the same filtered list.
  const listCriteria = {
    q: params.get("q") ?? "",
    site: params.get("site") ?? "",
    status: params.get("status") ?? "",
  };
  // The router starts each entry without the list's page metadata; carry
  // it into the editor entry and back into the list entry on Close, so a
  // reload of either keeps the list's page.
  const carry = useCarriedListState();
  const open = (next: Editing, criteria: ListCriteria = listCriteria) => {
    const href = withCriteria(
      next.mode === "NEW"
        ? `${ROUTES.hrEmployees}?mode=new`
        : (destinationHref({
            key: "hr.employeeEdit",
            employeeId: next.employeeId,
          }) ?? ROUTES.hrEmployees),
      criteria,
    );
    navigate(`${href}${window.location.hash}`, () => {
      const index = appHistoryIndex();
      openedFrom.current =
        index !== undefined &&
        readEmployeesUrl(new URLSearchParams(window.location.search)).mode ===
          "LIST"
          ? {
              url:
                window.location.pathname +
                window.location.search +
                window.location.hash,
              index: index + 1,
            }
          : null;
      carry(href);
      setEditing(next);
    });
  };
  useLayoutEffect(() => {
    const origin = openedFrom.current;
    if (
      origin &&
      appHistoryIndex() === origin.index &&
      new URLSearchParams(window.location.search).has("mode")
    ) {
      updateHistoryMetadata((state) => {
        state.hrEmployeeEditorOrigin = origin;
      });
      openedFrom.current = null;
    }
  });
  // Closing unmounts the form first (Cancel deliberately discards its draft;
  // a save has already persisted it), so leaving the editor URL afterwards
  // passes the unsaved-work guard without a prompt.
  const close = (criteria: ListCriteria = listCriteria) => {
    flushSync(() => setEditing(undefined));
    const origin: unknown = window.history.state?.hrEmployeeEditorOrigin;
    if (
      origin &&
      typeof origin === "object" &&
      "url" in origin &&
      typeof origin.url === "string" &&
      "index" in origin &&
      typeof origin.index === "number" &&
      Number.isSafeInteger(origin.index) &&
      origin.index > 0 &&
      origin.index === appHistoryIndex()
    ) {
      let source: URL | null = null;
      try {
        source = new URL(origin.url, window.location.href);
      } catch {
        /* Invalid provenance uses a direct list fallback. */
      }
      if (
        source &&
        source.origin === window.location.origin &&
        source.pathname.replace(/^\/(en|th)(?=\/|$)/, "") ===
          window.location.pathname.replace(/^\/(en|th)(?=\/|$)/, "") &&
        readEmployeesUrl(source.searchParams).mode === "LIST"
      ) {
        traverseBack();
        return;
      }
    }
    const href = `${listHref(criteria)}${window.location.hash}`;
    navigate(href, () => carry(href), "replace");
  };
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} {...back}>
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
          linkToken={navigationKey(params, LIST_KEYS)}
          onEdit={(employeeId, criteria) =>
            open({ mode: "EDIT", employeeId }, criteria)
          }
          onClose={close}
        />
      </HrGate>
    </>
  );
}

const LIST_DEFAULTS = { q: "", site: "", status: "" } as const;
const LIST_KEYS = Object.keys(LIST_DEFAULTS);
type ListCriteria = Readonly<Record<keyof typeof LIST_DEFAULTS, string>>;

/** The list URL with its criteria, without an open editor. */
function listHref(criteria: ListCriteria): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(criteria))
    if (value !== "") query.set(key, value);
  const text = query.toString();
  return text === "" ? ROUTES.hrEmployees : `${ROUTES.hrEmployees}?${text}`;
}

/** Another HR URL carrying the list criteria, so reload and Back keep them. */
function withCriteria(href: string, criteria: ListCriteria): string {
  const [path, search = ""] = href.split("?");
  const query = new URLSearchParams(search);
  for (const [key, value] of Object.entries(criteria))
    if (value !== "") query.set(key, value);
  const text = query.toString();
  return text === "" ? path! : `${path}?${text}`;
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
  readonly onEdit: (employeeId: string, criteria: ListCriteria) => void;
  readonly onClose: (criteria: ListCriteria) => void;
}) {
  const t = useTranslations("Hr.employees");
  const access = useHrAccess();
  const id = useId();
  const [criteria, setCriteria, entry] = useHrListCriteria(
    LIST_DEFAULTS,
    "employees",
  );
  const status =
    criteria.status === "ACTIVE" || criteria.status === "INACTIVE"
      ? criteria.status
      : undefined;
  const { view, paging } = useHrPagedQuery(
    hrRefs.employeesPage,
    {
      ...(criteria.q === "" ? {} : { search: criteria.q }),
      ...(criteria.site === "" ? {} : { warehouseId: criteria.site }),
      ...(status === undefined ? {} : { status }),
    },
    "employees",
    entry,
  );
  const filtered =
    criteria.q !== "" || criteria.site !== "" || status !== undefined;
  const clear = () => setCriteria(LIST_DEFAULTS);

  return (
    <div className="space-y-6">
      {invalidLink ? <HrInlineError code="NOT_FOUND" /> : null}
      {editing === undefined ? null : editing.mode === "NEW" ? (
        <EmployeeForm
          key="new"
          sites={access.sites}
          today={access.today ?? ""}
          onDone={() => onClose(criteria)}
        />
      ) : (
        <EmployeeEditor
          employeeId={editing.employeeId}
          focus={linkFocus}
          token={linkToken}
          onDone={() => onClose(criteria)}
        />
      )}
      {access.sites.length === 0 ? (
        <Notice tone="warning" title={t("noSites")} body={t("noSitesHint")} />
      ) : (
        <section aria-label={t("tableLabel")} className="space-y-3">
          <HrToolbar label={t("filters")}>
            <HrSearchField
              id={`${id}-search`}
              label={t("search")}
              placeholder={t("searchHint")}
              value={criteria.q}
              onSettled={(q) => setCriteria({ q }, true)}
            />
            {access.sites.length > 1 ? (
              <div className="grid w-full gap-2 sm:w-56">
                <Label htmlFor={`${id}-site`}>{t("site")}</Label>
                <HrSiteSelect
                  id={`${id}-site`}
                  surface="employees-filter"
                  value={criteria.site}
                  onChange={(site) => setCriteria({ site })}
                  placeholder={t("allSites")}
                  emptyLabel={t("allSites")}
                  allLabel={t("allSites")}
                />
              </div>
            ) : null}
            <div className="grid w-full gap-2 sm:w-44">
              <Label htmlFor={`${id}-status`}>{t("status")}</Label>
              <SelectControl
                id={`${id}-status`}
                value={criteria.status}
                onValueChange={(next) => setCriteria({ status: next })}
                placeholder={t("allStatuses")}
                emptyLabel={t("allStatuses")}
                options={[
                  { value: "", label: t("allStatuses") },
                  { value: "ACTIVE", label: t("active") },
                  { value: "INACTIVE", label: t("inactive") },
                ]}
              />
            </div>
            {filtered ? (
              <Button type="button" variant="ghost" onClick={clear}>
                {t("clearFilters")}
              </Button>
            ) : null}
          </HrToolbar>
          <HrPagedState
            view={view}
            refused={(code) => <HrInlineError code={code} />}
          >
            {(value, items, { busy }) => {
              const edit = (employee: EmployeeRow) =>
                onEdit(employee.id, criteria);
              // Rows of the previous page are inert while the next loads.
              const locked = editing !== undefined || busy;
              return (
                <div className="space-y-3">
                  {value.sitesComplete ? null : (
                    <Notice
                      tone="warning"
                      role="alert"
                      title={t("sitesIncomplete")}
                    />
                  )}
                  {items.length === 0 ? (
                    filtered ? (
                      <EmptyState
                        title={t("noMatches")}
                        body={t("noMatchesHint")}
                        action={
                          <Button
                            type="button"
                            variant="outline"
                            onClick={clear}
                          >
                            {t("clearFilters")}
                          </Button>
                        }
                      />
                    ) : (
                      <EmptyState title={t("empty")} body={t("emptyHint")} />
                    )
                  ) : (
                    <>
                      <p className="text-sm text-muted" role="status">
                        {t("pageCount", { count: items.length })}
                      </p>
                      <div className="hidden lg:block">
                        <EmployeeTable
                          items={items}
                          onEdit={edit}
                          disabled={locked}
                        />
                      </div>
                      <ul
                        className="space-y-3 lg:hidden"
                        aria-label={t("tableLabel")}
                      >
                        {items.map((employee) => (
                          <EmployeeCard
                            key={employee.id}
                            employee={employee}
                            onEdit={edit}
                            disabled={locked}
                          />
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              );
            }}
          </HrPagedState>
          <HrPager paging={paging} label={t("pagination")} />
        </section>
      )}
    </div>
  );
}

function EmployeeCard({
  employee,
  onEdit,
  disabled,
}: {
  readonly employee: EmployeeRow;
  readonly onEdit: (employee: EmployeeRow) => void;
  readonly disabled: boolean;
}) {
  const t = useTranslations("Hr.employees");
  return (
    <li className="space-y-3 rounded-xl border border-border bg-surface p-4">
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
          <dt className="text-xs text-muted">{t("supervisor")}</dt>
          <dd className="text-text">{employee.supervisorName ?? "—"}</dd>
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
        onEdit={onEdit}
        disabled={disabled}
        className="w-full sm:w-auto"
      />
    </li>
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
            key={`${access.identityKey}:${employee.id}`}
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
