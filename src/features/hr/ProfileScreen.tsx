"use client";

import { useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";

import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { hrRefs } from "@/lib/convex/hrApi";
import { HR_CODES } from "@/lib/navigation";

import { formatBusinessDate, weekdayName } from "./format";
import { Facts, HrGate, HrQueryState, PlanText } from "./HrShared";
import { HrInitials } from "./HrUi";

export function HrProfileScreen() {
  const t = useTranslations("Hr.profile");
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} showBack={false} />
      <HrGate code={HR_CODES.self}>
        <ProfileContent />
      </HrGate>
    </>
  );
}

function ProfileContent() {
  const t = useTranslations("Hr.profile");
  const locale = useLocale();
  const outcome = useQuery(hrRefs.profile, {});
  return (
    <HrQueryState outcome={outcome}>
      {() => {
        if (!outcome?.ok) return null;
        const profile = outcome.value;
        if (!profile.linked)
          return (
            <Notice
              tone="neutral"
              title={t("notLinked")}
              body={t("notLinkedHint")}
              testId="hr-profile-unlinked"
            />
          );
        const employee = profile.employee;
        const schedule = employee.schedule;
        const active = employee.status === "ACTIVE" && profile.employed;
        return (
          <div className="max-w-3xl space-y-6">
            {active ? null : (
              <Notice
                tone="warning"
                title={t("notActive")}
                body={t("notActiveHint")}
              />
            )}
            <Panel
              aria-labelledby="hr-profile-heading"
              className="space-y-5 p-4 sm:p-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <HrInitials name={employee.displayName} size="lg" />
                  <div className="min-w-0">
                    <h2
                      id="hr-profile-heading"
                      className="text-xl leading-7 font-semibold break-words text-text"
                    >
                      {employee.displayName}
                    </h2>
                    <p className="text-sm text-muted">
                      {employee.code}
                      {employee.site ? ` · ${employee.site.name}` : ""}
                    </p>
                  </div>
                </div>
                <StatusBadge
                  tone={active ? "success" : "muted"}
                  label={t(active ? "active" : "inactive")}
                />
              </div>
              <Facts
                items={[
                  { label: t("code"), value: employee.code },
                  {
                    label: t("site"),
                    value: employee.site
                      ? `${employee.site.code} · ${employee.site.name}`
                      : "—",
                  },
                  {
                    label: t("supervisor"),
                    value: employee.supervisorName ?? t("noSupervisor"),
                  },
                  {
                    label: t("employment"),
                    value: employee.employmentEndDate
                      ? t("employmentRange", {
                          from: formatBusinessDate(
                            employee.employmentStartDate,
                            locale,
                          ),
                          to: formatBusinessDate(
                            employee.employmentEndDate,
                            locale,
                          ),
                        })
                      : t("employmentFrom", {
                          from: formatBusinessDate(
                            employee.employmentStartDate,
                            locale,
                          ),
                        }),
                  },
                  { label: t("timezone"), value: profile.timezone },
                ]}
              />
            </Panel>
            <Panel aria-labelledby="hr-profile-schedule">
              <h2
                id="hr-profile-schedule"
                className="mb-3 text-lg leading-7 font-semibold text-text"
              >
                {t("schedule")}
              </h2>
              {schedule === undefined ? (
                <p className="text-sm text-muted">{t("noSchedule")}</p>
              ) : (
                <Facts
                  items={[
                    {
                      label: t("workDays"),
                      value: (
                        <span className="flex flex-wrap gap-1.5">
                          {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                            const on = schedule.workDays.includes(day);
                            return (
                              <span
                                key={day}
                                className={`inline-flex min-w-10 justify-center rounded-md border px-2 py-1 text-xs font-semibold ${
                                  on
                                    ? "border-link/40 bg-accent-surface text-link"
                                    : "border-dashed border-border text-muted"
                                }`}
                              >
                                {weekdayName(day, locale)}
                                <span className="sr-only">
                                  {on ? "" : ` (${t("dayOff")})`}
                                </span>
                              </span>
                            );
                          })}
                        </span>
                      ),
                    },
                    {
                      label: t("shift"),
                      value: (
                        <PlanText plan={{ kind: "SCHEDULED", ...schedule }} />
                      ),
                    },
                  ]}
                />
              )}
              <p className="mt-4 text-xs text-muted">{t("readOnly")}</p>
            </Panel>
          </div>
        );
      }}
    </HrQueryState>
  );
}
