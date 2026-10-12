"use client";

import { useMutation } from "convex/react";
import { CalendarDays, ShieldCheck, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import {
  useDraftGuard,
  usePendingGuard,
} from "@/components/providers/draftGuard";
import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { guardedNavigate } from "@/lib/navigationGuard";
import { Button } from "@/components/ui/button";
import { CheckboxControl } from "@/components/ui/CheckboxControl";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { HrSiteSelect } from "./HrSiteSelect";
import { hrRefs } from "@/lib/convex/hrApi";
import {
  useDeepLinkFocus,
  useQueryParams,
  useUrlBackedState,
} from "@/lib/deepLink";
import {
  FOCUS_TARGET_IDS,
  HR_CODES,
  readSettingsSection,
} from "@/lib/navigation";

import { formatBusinessDate } from "./format";
import { HrPolicySettings } from "./HrPolicySettings";
import {
  Facts,
  HrGate,
  HrInlineError,
  useHrBack,
  WriteFeedback,
} from "./HrShared";
import { useHrListCriteria, navigationKey } from "./HrListCriteria";
import {
  HrPagedState,
  HrPager,
  HrSearchField,
  useHrPagedQuery,
} from "./HrPagedList";
import { HrDisclosure } from "./HrUi";
import { useHrWrite, type HrWriteState } from "./useHrWrite";

const CSV_COLUMNS =
  "period_id, period_version, site_code, employee_code, employee_name, business_date, timezone, planned_start, planned_end, actual_start, actual_end, worked_minutes, outside_shift_minutes, disposition, correction_reason";

export function HrSettingsScreen() {
  const t = useTranslations("Hr.settings");
  const back = useHrBack();
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} {...back} />
      <HrGate code={HR_CODES.admin}>
        <SettingsSections />
      </HrGate>
    </>
  );
}

/** `?section=holidays|access|policy` moves to that panel once access settles. */
const LIST_DEFAULTS = { hsite: "", hyear: "", mq: "" } as const;
const LIST_KEYS = Object.keys(LIST_DEFAULTS);

function SettingsSections() {
  const params = useQueryParams();
  const section = readSettingsSection(params);
  // List filters live in the URL too; typing in them is not a navigation.
  const token = navigationKey(params, LIST_KEYS);
  useDeepLinkFocus(
    section === null ? null : FOCUS_TARGET_IDS[section],
    true,
    token,
  );
  // Policy detail is closed until asked for; a link to it opens it in the
  // same render, so the section is open before focus moves there (on load,
  // reload and Back/Forward alike).
  const [policyOpen, setPolicyOpen] = useUrlBackedState(
    token,
    section === "policy",
  );
  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <HolidaysPanel />
      <AccessPanel />
      <HrPolicySettings />
      <PolicyPanel open={policyOpen} onToggle={setPolicyOpen} />
    </div>
  );
}

function SettingsHeading({
  id,
  icon,
  title,
  description,
}: {
  readonly id: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly description?: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border pb-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-surface text-link">
        {icon}
      </span>
      <div className="min-w-0">
        <h2 id={id} className="text-lg leading-7 font-semibold text-text">
          {title}
        </h2>
        {description === undefined ? null : (
          <p className="text-sm text-muted">{description}</p>
        )}
      </div>
    </div>
  );
}

function HolidaysPanel() {
  const t = useTranslations("Hr.settings");
  const access = useHrAccess();
  const id = useId();
  const [criteria, setCriteria, entry] = useHrListCriteria(
    LIST_DEFAULTS,
    "settings",
  );
  // With a complete site list an unknown site falls back to the first one;
  // beyond the preloaded list the URL's site is used and the server
  // authorizes it (an unavailable site is refused visibly).
  const site =
    access.sites.some((option) => option.id === criteria.hsite) ||
    (access.sitesComplete === false && criteria.hsite !== "")
      ? criteria.hsite
      : (access.sites[0]?.id ?? "");
  const setSite = (next: string) =>
    setCriteria({ hsite: next === access.sites[0]?.id ? "" : next, hyear: "" });
  return (
    <Panel
      id={FOCUS_TARGET_IDS.holidays}
      aria-labelledby={`${id}-title`}
      className="space-y-4"
    >
      <SettingsHeading
        id={`${id}-title`}
        icon={<CalendarDays aria-hidden="true" className="size-5" />}
        title={t("holidays")}
        description={t("holidaysIntro")}
      />
      {access.sites.length === 0 ? (
        <Notice tone="warning" title={t("noSites")} />
      ) : (
        <>
          <div className="grid gap-2 sm:max-w-sm">
            <Label htmlFor={`${id}-site`}>{t("site")}</Label>
            <HrSiteSelect
              id={`${id}-site`}
              surface="settings-holidays"
              value={site}
              // Another site remounts the holiday form; an unsent holiday
              // asks first instead of disappearing.
              onChange={(next) => guardedNavigate(() => setSite(next))}
              placeholder={t("site")}
              emptyLabel={t("noSites")}
            />
          </div>
          {site === "" ? null : (
            <SiteHolidays
              key={site}
              warehouseId={site}
              year={criteria.hyear}
              entry={entry}
              onYear={(hyear) => setCriteria({ hyear }, true)}
            />
          )}
        </>
      )}
    </Panel>
  );
}

function SiteHolidays({
  warehouseId,
  year,
  entry,
  onYear,
}: {
  readonly warehouseId: string;
  readonly year: string;
  readonly entry: string | null;
  readonly onYear: (year: string) => void;
}) {
  const t = useTranslations("Hr.settings");
  const form = useTranslations("Hr.form");
  const locale = useLocale();
  const id = useId();
  // Years are entered as shown in the locale (Buddhist era in Thai).
  const yearOffset = locale === "th" ? 543 : 0;
  const yearValid =
    year === "" ||
    (/^\d{4}$/.test(year) &&
      Number(year) - yearOffset >= 1900 &&
      Number(year) - yearOffset <= 2200);
  const { view, paging } = useHrPagedQuery(
    hrRefs.holidaysPage,
    yearValid
      ? {
          warehouseId,
          ...(year === "" ? {} : { year: Number(year) - yearOffset }),
        }
      : "skip",
    "settings-holidays",
    entry,
  );
  const save = useMutation(hrRefs.saveHoliday);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<{ date?: string; name?: string }>({});
  const adding = useHrWrite(`holiday:${warehouseId}`);
  useDraftGuard(
    adding.state.kind !== "SAVED" && (date !== "" || name.trim() !== ""),
    () => {
      setDate("");
      setName("");
      setErrors({});
    },
    adding.pending,
  );

  const add = async () => {
    const next: { date?: string; name?: string } = {};
    if (date === "") next.date = t("dateRequired");
    if (name.trim() === "") next.name = t("nameRequired");
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    cleared(
      await adding.submit((requestId) =>
        save({ requestId, warehouseId, date, name: name.trim() }),
      ),
    );
  };
  const cleared = (result: HrWriteState<unknown>) => {
    if (result.kind === "SAVED") {
      setDate("");
      setName("");
    }
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void add();
  };
  // Typing after a save starts the next holiday: the finished write no
  // longer speaks for it, so the new text is guarded as unsent.
  const startNext = () => {
    if (adding.state.kind === "SAVED") adding.reset();
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={onSubmit}
        noValidate
        className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-start"
      >
        <FormField
          id={`${id}-date`}
          label={t("holidayDate")}
          required
          error={errors.date}
        >
          {(field) => (
            <Input
              {...field}
              type="date"
              disabled={adding.locked}
              value={date}
              onChange={(e) => {
                startNext();
                setDate(e.target.value);
              }}
            />
          )}
        </FormField>
        <FormField
          id={`${id}-name`}
          label={t("holidayName")}
          required
          error={errors.name}
        >
          {(field) => (
            <Input
              {...field}
              value={name}
              disabled={adding.locked}
              maxLength={120}
              onChange={(e) => {
                startNext();
                setName(e.target.value);
              }}
            />
          )}
        </FormField>
        <Button
          type="submit"
          className="sm:mt-6"
          disabled={adding.locked}
          data-testid="hr-holiday-add"
        >
          {adding.pending ? form("submitting") : t("addHoliday")}
        </Button>
      </form>
      <WriteFeedback
        state={adding.state}
        onRetry={() => void adding.retry().then(cleared)}
      />
      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <FormField
            id={`${id}-year`}
            label={t("holidayYear")}
            hint={t("holidayYearHint")}
            error={yearValid ? undefined : t("holidayYearInvalid")}
          >
            {(field) => (
              <Input
                {...field}
                type="number"
                inputMode="numeric"
                min={1900 + yearOffset}
                max={2200 + yearOffset}
                value={year}
                onChange={(event) => onYear(event.target.value)}
                className="sm:w-32"
              />
            )}
          </FormField>
          {year === "" ? null : (
            <Button type="button" variant="ghost" onClick={() => onYear("")}>
              {t("allYears")}
            </Button>
          )}
        </div>
        {yearValid ? (
          <>
            <HrPagedState
              view={view}
              refused={(code) => <HrInlineError code={code} />}
            >
              {(_value, items) =>
                items.length === 0 ? (
                  <p className="text-sm text-muted">
                    {t(year === "" ? "noHolidays" : "noHolidaysInYear")}
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {items.map((holiday) => (
                      <HolidayRow key={holiday.id} holiday={holiday} />
                    ))}
                  </ul>
                )
              }
            </HrPagedState>
            <HrPager paging={paging} label={t("holidayPagination")} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function HolidayRow({
  holiday,
}: {
  readonly holiday: { id: string; date: string; name: string };
}) {
  const t = useTranslations("Hr.settings");
  const locale = useLocale();
  const remove = useMutation(hrRefs.deleteHoliday);
  const removing = useHrWrite(`holiday:delete:${holiday.id}`);
  usePendingGuard(removing.pending);
  const send = () =>
    void removing.submit((requestId) =>
      remove({ requestId, holidayId: holiday.id }),
    );
  return (
    <li className="space-y-1 px-3 py-1 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="font-semibold text-text">
            {formatBusinessDate(holiday.date, locale, {
              weekday: true,
              short: true,
            })}
          </span>
          <span className="block break-words text-muted">{holiday.name}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={removing.locked}
          aria-label={t("removeHoliday", { name: holiday.name })}
          onClick={send}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      <WriteFeedback
        state={removing.state}
        onRetry={() => void removing.retry()}
      />
    </li>
  );
}

function AccessPanel() {
  const t = useTranslations("Hr.settings");
  const id = useId();
  const [criteria, setCriteria, entry] = useHrListCriteria(
    LIST_DEFAULTS,
    "settings",
  );
  const { view, paging } = useHrPagedQuery(
    hrRefs.accessMembersPage,
    criteria.mq === "" ? {} : { search: criteria.mq },
    "settings-access",
    entry,
  );
  return (
    <Panel
      id={FOCUS_TARGET_IDS.access}
      aria-labelledby={`${id}-title`}
      className="space-y-4"
    >
      <SettingsHeading
        id={`${id}-title`}
        icon={<ShieldCheck aria-hidden="true" className="size-5" />}
        title={t("access")}
        description={t("accessIntro")}
      />
      <HrSearchField
        id={`${id}-search`}
        label={t("memberSearch")}
        placeholder={t("memberSearchHint")}
        value={criteria.mq}
        onSettled={(mq) => setCriteria({ mq }, true)}
      />
      <HrPagedState
        view={view}
        refused={(code) => <HrInlineError code={code} />}
      >
        {(result, items) =>
          !result.provisioned ? (
            <Notice
              tone="warning"
              title={t("notProvisioned")}
              body={t("notProvisionedHint")}
            />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted">
              {t(criteria.mq === "" ? "noMembers" : "noMemberMatches")}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {items.map((member) => (
                <MemberAccessRow key={member.userId} member={member} />
              ))}
            </ul>
          )
        }
      </HrPagedState>
      <HrPager paging={paging} label={t("memberPagination")} />
    </Panel>
  );
}

function MemberAccessRow({
  member,
}: {
  readonly member: {
    userId: string;
    displayName: string;
    roles: readonly string[];
  };
}) {
  const t = useTranslations("Hr.settings");
  const fixed = member.roles.filter(
    (role) => role === "HR_ADMIN" || role === "ORG_ADMIN",
  );
  return (
    <li className="space-y-1 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-text">{member.displayName}</span>
        {fixed.length > 0 ? (
          <span className="text-xs text-muted">
            {fixed.map((role) => t(`role.${role}`)).join(", ")}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-4">
        {(["HR_EMPLOYEE", "HR_SUPERVISOR"] as const).map((role) => (
          <RoleToggle key={role} member={member} role={role} />
        ))}
      </div>
    </li>
  );
}

function RoleToggle({
  member,
  role,
}: {
  readonly member: {
    userId: string;
    displayName: string;
    roles: readonly string[];
  };
  readonly role: "HR_EMPLOYEE" | "HR_SUPERVISOR";
}) {
  const t = useTranslations("Hr.settings");
  const set = useMutation(hrRefs.setMemberAccess);
  const write = useHrWrite(`access:${member.userId}:${role}`);
  usePendingGuard(write.pending);
  return (
    <div className="space-y-1">
      <label className="flex min-h-touch items-center gap-2 text-sm text-text">
        <CheckboxControl
          checked={member.roles.includes(role)}
          disabled={write.locked}
          onChange={(event) => {
            const granted = event.target.checked;
            void write.submit((requestId) =>
              set({ requestId, userId: member.userId, role, granted }),
            );
          }}
          aria-label={t("roleFor", {
            role: t(`role.${role}`),
            name: member.displayName,
          })}
        />
        {t(`role.${role}`)}
      </label>
      <WriteFeedback state={write.state} onRetry={() => void write.retry()} />
    </div>
  );
}

function PolicyPanel({
  open,
  onToggle,
}: {
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
}) {
  const t = useTranslations("Hr.settings");
  const access = useHrAccess();
  return (
    <Panel className="py-1 xl:col-span-2">
      <HrDisclosure
        id={FOCUS_TARGET_IDS.policy}
        label={t("policy")}
        open={open}
        onToggle={onToggle}
        contentClassName="space-y-3"
        testId="hr-settings-policy-toggle"
      >
        <Facts
          items={[
            { label: t("timezone"), value: access.timezone ?? "—" },
            { label: t("clockMethod"), value: t("clockMethodValue") },
            { label: t("holidayEdits"), value: t("holidayNote") },
            { label: t("limits"), value: t("limitsValue") },
            { label: t("reverification"), value: t("reverificationValue") },
            {
              label: t("csv"),
              value: (
                <>
                  <span className="block font-mono text-xs break-words">
                    {CSV_COLUMNS}
                  </span>
                  <span className="mt-1 block font-normal text-muted">
                    {t("csvNote")}
                  </span>
                </>
              ),
            },
          ]}
        />
      </HrDisclosure>
    </Panel>
  );
}
