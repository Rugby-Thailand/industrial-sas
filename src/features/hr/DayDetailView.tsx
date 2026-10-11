"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Panel } from "@/components/ui/Panel";
import type { RefValue } from "@/lib/convex/clientRef";
import type { hrRefs } from "@/lib/convex/hrApi";

import { formatBusinessDate, formatDateTime } from "./format";
import {
  CorrectionBadge,
  DayStatusBadge,
  Duration,
  Facts,
  PlanText,
  SectionTitle,
  TimeText,
} from "./HrShared";

export type DayDetail = Extract<
  RefValue<typeof hrRefs.selfDayDetail>,
  { ok: true }
>["detail"];

/**
 * One business date: planned shift, original events, effective certified
 * times and the correction/decision history. Self-service shows the whole
 * record; review composes the same parts around its decision.
 */
export function DayDetailView({
  detail,
  timezone,
  children,
}: {
  readonly detail: DayDetail;
  readonly timezone: string;
  readonly children?: ReactNode;
}) {
  const t = useTranslations("Hr.day");
  return (
    <div className="space-y-4 sm:space-y-6">
      <Panel
        aria-labelledby="hr-day-summary"
        className="space-y-3 p-3 sm:space-y-4 sm:p-4"
      >
        <DayHeading detail={detail} />
        {detail.locked ? (
          <p className="text-sm font-semibold text-warning">{t("locked")}</p>
        ) : null}
        <DayTimes detail={detail} timezone={timezone} />
        <DayCertification detail={detail} timezone={timezone} />
        <DayPriorDecisions detail={detail} timezone={timezone} />
      </Panel>

      {children}

      <Panel aria-labelledby="hr-day-events">
        <DayEvents detail={detail} timezone={timezone} />
      </Panel>

      <Panel aria-labelledby="hr-day-requests">
        <DayRequests detail={detail} timezone={timezone} />
      </Panel>
    </div>
  );
}

type DayPart = { readonly detail: DayDetail; readonly timezone: string };

/** The business date, who it belongs to (review) and its current status. */
export function DayHeading({
  detail,
  heading,
}: {
  readonly detail: DayDetail;
  /** Shown under the business date, e.g. the reviewed employee. */
  readonly heading?: ReactNode;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h2
        id="hr-day-summary"
        className="text-lg leading-7 font-semibold text-text"
      >
        {formatBusinessDate(detail.businessDate, locale, {
          weekday: true,
        })}
        {heading === undefined ? null : (
          <span className="block text-sm font-normal text-muted">
            {heading}
          </span>
        )}
      </h2>
      <DayStatusBadge
        status={detail.status}
        issue={detail.issue}
        disposition={detail.disposition}
      />
    </div>
  );
}

/**
 * Recorded and effective times with the one outside-shift note. Review
 * shows the original times in its decision, so it asks for `effectiveOnly`.
 */
export function DayTimes({
  detail,
  timezone,
  effectiveOnly = false,
}: DayPart & { readonly effectiveOnly?: boolean }) {
  const t = useTranslations("Hr.day");
  return (
    <>
      <div
        className={
          effectiveOnly ? undefined : "grid gap-3 md:grid-cols-2 md:gap-4"
        }
      >
        {effectiveOnly ? null : (
          <div className="rounded-lg border border-border p-3 sm:p-4">
            <h3 className="mb-2 text-sm font-semibold text-text">
              {t("original")}
            </h3>
            <Facts
              dense
              items={[
                {
                  label: t("planned"),
                  value: <PlanText plan={detail.plan} />,
                },
                {
                  label: t("clockIn"),
                  value: (
                    <TimeText at={detail.originalStartAt} timeZone={timezone} />
                  ),
                },
                {
                  label: t("clockOut"),
                  value: (
                    <TimeText at={detail.originalEndAt} timeZone={timezone} />
                  ),
                },
              ]}
            />
          </div>
        )}
        <div className="rounded-lg border border-link/40 bg-selected/40 p-3 sm:p-4">
          <h3 className="mb-2 text-sm font-semibold text-link">
            {t("effective")}
          </h3>
          <Facts
            dense
            items={[
              {
                label: t("clockIn"),
                value: (
                  <TimeText at={detail.effectiveStartAt} timeZone={timezone} />
                ),
              },
              {
                label: t("clockOut"),
                value: (
                  <TimeText at={detail.effectiveEndAt} timeZone={timezone} />
                ),
              },
              {
                label: t("worked"),
                value: <Duration minutes={detail.workedMinutes} />,
              },
              {
                label: t("outside"),
                value: <Duration minutes={detail.outsideShiftMinutes} />,
              },
            ]}
          />
        </div>
      </div>
      <p className="text-xs text-muted">{t("minutesNote")}</p>
    </>
  );
}

/** The certification in force (or the one a later change superseded). */
export function DayCertification({ detail, timezone }: DayPart) {
  const t = useTranslations("Hr.day");
  const locale = useLocale();
  return (
    <>
      {detail.certification ? (
        <div className="rounded-lg border border-border p-4 text-sm">
          <p className="font-semibold text-text">
            {t(
              detail.certification.current
                ? "certifiedAs"
                : "certificationSuperseded",
              {
                disposition: t(
                  `disposition.${detail.certification.disposition}`,
                ),
              },
            )}
          </p>
          <p className="mt-1 text-muted">
            {t("decidedBy", {
              name: detail.certification.decidedByName ?? t("unknownActor"),
              at: formatDateTime(
                detail.certification.decidedAt,
                locale,
                timezone,
              ),
            })}
          </p>
          <p className="mt-1 break-words text-text">
            {t("reason")}: {detail.certification.reason}
          </p>
        </div>
      ) : null}
    </>
  );
}

export function DayPriorDecisions({ detail, timezone }: DayPart) {
  const t = useTranslations("Hr.day");
  const locale = useLocale();
  return (
    <>
      {detail.priorCertifications?.length ? (
        <div className="text-sm" data-testid="hr-prior-decisions">
          <p className="font-semibold text-text">{t("priorDecisions")}</p>
          <ol className="mt-1 space-y-1 border-l-2 border-border pl-3">
            {detail.priorCertifications.map((entry) => (
              <li
                key={`${entry.decidedAt}-${entry.disposition}`}
                className="text-muted"
              >
                <span className="text-text">
                  {t(`disposition.${entry.disposition}`)}
                </span>
                {entry.startAt !== undefined && entry.endAt !== undefined ? (
                  <span className="tabular-nums">
                    {" "}
                    (<TimeText at={entry.startAt} timeZone={timezone} />
                    {" – "}
                    <TimeText at={entry.endAt} timeZone={timezone} />)
                  </span>
                ) : null}
                {" · "}
                {t("decidedBy", {
                  name: entry.decidedByName ?? t("unknownActor"),
                  at: formatDateTime(entry.decidedAt, locale, timezone),
                })}
                <span className="block break-words">“{entry.reason}”</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </>
  );
}

export function DayEvents({ detail, timezone }: DayPart) {
  const t = useTranslations("Hr.day");
  const locale = useLocale();
  return (
    <>
      <SectionTitle>
        <span id="hr-day-events">{t("events")}</span>
      </SectionTitle>
      {detail.events.length === 0 ? (
        <p className="text-sm text-muted">{t("noEvents")}</p>
      ) : (
        <ol className="space-y-2 text-sm">
          {detail.events.map((event) => (
            <li
              key={`${event.kind}-${event.occurredAt}`}
              className="flex flex-wrap gap-x-3"
            >
              <span className="font-semibold text-text tabular-nums">
                {formatDateTime(event.occurredAt, locale, timezone)}
              </span>
              <span className="text-text">{t(`event.${event.kind}`)}</span>
              <span className="text-muted">
                {t("eventSource", {
                  name: event.actorName ?? t("unknownActor"),
                })}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export function DayRequests({ detail, timezone }: DayPart) {
  const t = useTranslations("Hr.day");
  const locale = useLocale();
  return (
    <>
      <SectionTitle>
        <span id="hr-day-requests">{t("requests")}</span>
      </SectionTitle>
      {detail.correctionsIncomplete ? (
        <p
          role="status"
          className="mb-2 text-sm font-semibold text-warning"
          data-testid="hr-corrections-incomplete"
        >
          {t("requestsIncomplete", { count: detail.corrections.length })}
        </p>
      ) : null}
      {detail.corrections.length === 0 ? (
        <p className="text-sm text-muted">{t("noRequests")}</p>
      ) : (
        <ul className="space-y-4">
          {detail.corrections.map((correction) => (
            <li
              key={correction.id}
              className="space-y-2 rounded-lg border border-border p-4 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-text tabular-nums">
                  <TimeText
                    at={correction.proposedStartAt}
                    timeZone={timezone}
                  />
                  {" – "}
                  <TimeText at={correction.proposedEndAt} timeZone={timezone} />
                </span>
                <CorrectionBadge status={correction.status} />
              </div>
              <p className="break-words text-text">
                {t("reason")}: {correction.reason}
              </p>
              {correction.status === "PENDING" && correction.stale ? (
                <p className="font-semibold text-warning">{t("stale")}</p>
              ) : null}
              <ol className="space-y-1 border-l-2 border-border pl-3">
                {correction.history.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="text-muted">
                    <span className="tabular-nums">
                      {formatDateTime(entry.at, locale, timezone)}
                    </span>
                    {" · "}
                    <span className="text-text">
                      {t(`history.${entry.action}`, {
                        name: entry.actorName ?? t("unknownActor"),
                      })}
                    </span>
                    {entry.reason ? (
                      <span className="block break-words">
                        “{entry.reason}”
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
