"use client";

import { useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { OutcomeGate } from "@/components/system/DataGate";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Link } from "@/i18n/navigation";
import { hrRefs } from "@/lib/convex/hrApi";
import { ROUTES } from "@/lib/navigation";
import { formatBusinessDate } from "./format";

/** Optional employee updates load independently of the attendance action. */
export function HrHomeUpdates() {
  const t = useTranslations("Hr.homeUpdates");
  const locale = useLocale();
  const leave = useQuery(hrRefs.leaveSelf, {});
  const notices = useQuery(hrRefs.announcements, {
    pinnedOnly: true,
    limit: 3,
  });
  const payslips = useQuery(hrRefs.payslips, {});
  const notifications = useQuery(hrRefs.notifications, {
    unreadOnly: true,
    limit: 1,
  });
  return (
    <Panel
      aria-labelledby="hr-home-updates"
      className="space-y-3"
      data-testid="hr-home-updates"
    >
      <SectionHeader
        id="hr-home-updates"
        title={t("title")}
        actions={
          <Link
            href={ROUTES.hrNotifications}
            className="inline-flex min-h-touch items-center rounded-md text-sm font-semibold text-link focus-ring"
          >
            {t("notifications")}
          </Link>
        }
      />
      <OutcomeGate outcome={notifications}>
        {({ value }) => (
          <p className="text-sm text-muted">
            {value.ok
              ? t(value.unreadCountComplete ? "unread" : "unreadMore", {
                  count: value.unreadCount,
                })
              : t("unavailable")}
          </p>
        )}
      </OutcomeGate>
      <div className="divide-y divide-border">
        <Update title={t("leave")} href={ROUTES.hrLeave}>
          <OutcomeGate outcome={leave}>
            {({ value }) => {
              if (!value.ok) return <p>{t("unavailable")}</p>;
              if (value.gate)
                return (
                  <p>
                    {t(
                      value.gate === "POLICY_NOT_ACTIVE"
                        ? "policyGate"
                        : "leaveSetup",
                    )}
                  </p>
                );
              const annual = value.accounts.find(
                (account: { type: string }) => account.type === "ANNUAL",
              );
              return (
                <p>
                  {annual
                    ? t("annualDays", { days: annual.available })
                    : t("leaveSetup")}
                </p>
              );
            }}
          </OutcomeGate>
        </Update>
        <Update title={t("announcements")} href={ROUTES.hrAnnouncements}>
          <OutcomeGate outcome={notices}>
            {({ value }) =>
              !value.ok ? (
                <p>{t("unavailable")}</p>
              ) : (
                <>
                  {value.gate ? <p>{t("policyGate")}</p> : null}
                  {value.items.length ? (
                    <ul className="space-y-1">
                      {value.items.map(
                        (item: {
                          announcement: { _id: string; title: string };
                        }) => (
                          <li key={item.announcement._id}>
                            <Link
                              className="inline-flex min-h-touch items-center rounded-md text-link focus-ring hover:underline"
                              href={`${ROUTES.hrAnnouncements}/${encodeURIComponent(item.announcement._id)}`}
                            >
                              {item.announcement.title}
                            </Link>
                          </li>
                        ),
                      )}
                    </ul>
                  ) : (
                    <p>{t("noPinned")}</p>
                  )}
                </>
              )
            }
          </OutcomeGate>
        </Update>
        <Update title={t("payslips")} href={ROUTES.hrPayslips}>
          <OutcomeGate outcome={payslips}>
            {({ value }) => {
              if (!value.ok)
                return (
                  <p>
                    {t(
                      value.code === "POLICY_NOT_ACTIVE"
                        ? "policyGate"
                        : "unavailable",
                    )}
                  </p>
                );
              const latest = value.items.find(
                (item: { superseded: boolean }) => !item.superseded,
              );
              return (
                <p>
                  {latest
                    ? t("statementPeriod", {
                        from: formatBusinessDate(latest.from, locale, {
                          short: true,
                        }),
                        to: formatBusinessDate(latest.to, locale, {
                          short: true,
                        }),
                      })
                    : t("noPayslips")}
                </p>
              );
            }}
          </OutcomeGate>
          <p className="mt-1 text-xs">{t("verificationHint")}</p>
        </Update>
      </div>
    </Panel>
  );
}
function Update({
  title,
  href,
  children,
}: {
  readonly title: string;
  readonly href: string;
  readonly children: ReactNode;
}) {
  const t = useTranslations("Hr.homeUpdates");
  return (
    <section className="py-3 first:pt-0 last:pb-0">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        <Link
          href={href}
          className="inline-flex min-h-touch items-center rounded-md text-sm font-semibold text-link focus-ring"
        >
          {t("view", { section: title })}
        </Link>
      </div>
      <div className="text-sm text-muted">{children}</div>
    </section>
  );
}
