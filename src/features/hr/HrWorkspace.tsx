"use client";

import { useQuery } from "convex/react";
import { ListOrdered } from "lucide-react";
import { useTranslations } from "next-intl";

import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { TableScroller } from "@/components/ui/TableScroller";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import {
  clockRef,
  decideAttendanceCorrectionRef,
  decideLeaveRef,
  listTeamInboxRef,
  readMyHrRef,
  requestAttendanceCorrectionRef,
  requestLeaveRef,
  type HrRequestStatus,
  type MyHrRecord,
  type TeamHrInboxPayload,
} from "@/lib/convex/hrApi";

const PREVIEW_SELF: MyHrRecord = {
  found: true,
  employee: {
    employeeId: "prv_employee_001",
    employeeNumber: "EMP-001",
    displayName: "สมชาย ใจดี",
    warehouseId: "prv_wh_bangpoo",
  },
  days: [
    {
      attendanceDayId: "prv_day_20260817",
      businessDate: "2026-08-17",
      status: "ON_BREAK",
      clockInAt: Date.UTC(2026, 7, 17, 1, 2),
      breakStartedAt: Date.UTC(2026, 7, 17, 5, 0),
      breakMinutes: 0,
      lastEventAt: Date.UTC(2026, 7, 17, 5, 0),
      timezone: "Asia/Bangkok",
    },
    {
      attendanceDayId: "prv_day_20260816",
      businessDate: "2026-08-16",
      status: "CLOSED",
      clockInAt: Date.UTC(2026, 7, 16, 1, 1),
      clockOutAt: Date.UTC(2026, 7, 16, 10, 5),
      breakMinutes: 45,
      lastEventAt: Date.UTC(2026, 7, 16, 10, 5),
      timezone: "Asia/Bangkok",
    },
  ],
  corrections: [
    {
      attendanceCorrectionId: "prv_correction_001",
      attendanceDayId: "prv_day_20260816",
      status: "SUBMITTED",
      reason: "Forgot to clock out at the loading bay",
      requestedAt: Date.UTC(2026, 7, 17, 2),
    },
  ],
  leaves: [
    {
      leaveRequestId: "prv_leave_001",
      startDate: "2026-08-21",
      endDate: "2026-08-21",
      leaveType: "ANNUAL",
      durationKind: "FULL_DAY",
      privateReason: "Family appointment",
      status: "APPROVED",
      requestedAt: Date.UTC(2026, 7, 10),
      decisionNote: "Coverage confirmed",
    },
  ],
  complete: true,
  asOf: Date.UTC(2026, 7, 17, 5, 1),
};

const PREVIEW_TEAM: TeamHrInboxPayload = {
  items: [
    {
      requestId: "prv_correction_002",
      kind: "CORRECTION",
      employeeId: "prv_employee_002",
      employeeNumber: "EMP-002",
      displayName: "วิภา แสงทอง",
      requestedAt: Date.UTC(2026, 7, 17, 4),
      summary: "Attendance correction",
    },
    {
      requestId: "prv_leave_002",
      kind: "LEAVE",
      employeeId: "prv_employee_003",
      employeeNumber: "EMP-003",
      displayName: "ธนา กล้าดี",
      requestedAt: Date.UTC(2026, 7, 17, 3),
      summary: "2026-08-25 – 2026-08-26",
    },
  ],
  complete: true,
  asOf: Date.UTC(2026, 7, 17, 5, 1),
};

const requestTone = (status: HrRequestStatus): BadgeTone => {
  if (status === "APPROVED") return "success";
  if (status === "REJECTED" || status === "CANCELLED") return "danger";
  return "pending";
};

const dateTime = (value: number | undefined) =>
  value === undefined
    ? "—"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(value);

export function HrWorkspace() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId, preview) =>
        preview ? (
          <HrContent
            warehouseId={warehouseId}
            preview
            self={PREVIEW_SELF}
            team={PREVIEW_TEAM}
          />
        ) : (
          <ServerHrWorkspace warehouseId={warehouseId} />
        )
      }
    </QueryGate>
  );
}

function ServerHrWorkspace({ warehouseId }: { readonly warehouseId: string }) {
  const selfOutcome = useQuery(readMyHrRef, {});
  const teamOutcome = useQuery(listTeamInboxRef, { warehouseId });
  if (selfOutcome === undefined || teamOutcome === undefined) {
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  }
  const self =
    selfOutcome.ok && selfOutcome.value.found ? selfOutcome.value : undefined;
  const team = teamOutcome.ok ? teamOutcome.value : undefined;
  if (self === undefined && team === undefined) {
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: selfOutcome.requestId }}
      />
    );
  }
  return (
    <HrContent
      warehouseId={warehouseId}
      {...(self === undefined ? {} : { self })}
      {...(team === undefined ? {} : { team })}
    />
  );
}

function HrContent({
  warehouseId,
  self,
  team,
  preview = false,
}: {
  readonly warehouseId: string;
  readonly self?: MyHrRecord;
  readonly team?: TeamHrInboxPayload;
  readonly preview?: boolean;
}) {
  const t = useTranslations("HR");
  const day = self?.days?.[0];
  const correctionItems =
    team?.items.filter((item) => item.kind === "CORRECTION") ?? [];
  const leaveItems = team?.items.filter((item) => item.kind === "LEAVE") ?? [];

  return (
    <div className="space-y-6">
      {preview ? (
        <Notice
          tone="accent"
          title={t("previewTitle")}
          body={t("previewBody")}
          testId="hr-preview-notice"
        />
      ) : null}

      {/*
       * The four-step explainer is training material, not state: it collapses
       * so the operator's own attendance card is the first thing on screen.
       */}
      <CollapsibleSection label={t("flowTitle")} icon={ListOrdered}>
        <ol className="grid gap-3 md:grid-cols-4">
          {(["clock", "correct", "leave", "review"] as const).map(
            (step, index) => (
              <li
                key={step}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <span className="text-xs font-semibold text-accent">
                  {t("stepNumber", { value: index + 1 })}
                </span>
                <p className="mt-1 font-semibold text-text">
                  {t(`flow.${step}`)}
                </p>
              </li>
            ),
          )}
        </ol>
      </CollapsibleSection>

      {self?.found === true && self.employee !== undefined ? (
        <section className="space-y-4" aria-labelledby="my-attendance-title">
          <Card>
            <CardHeader>
              <CardTitle id="my-attendance-title">
                {t("myAttendance")}
              </CardTitle>
              <CardDescription>
                {self.employee.employeeNumber} · {self.employee.displayName}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <dl className="contents">
                <Fact
                  label={t("businessDate")}
                  value={day?.businessDate ?? "—"}
                />
                <Fact
                  label={t("status")}
                  value={day === undefined ? "—" : t(`dayStatus.${day.status}`)}
                />
                <Fact label={t("clockIn")} value={dateTime(day?.clockInAt)} />
                <Fact label={t("clockOut")} value={dateTime(day?.clockOutAt)} />
              </dl>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <EntityWriteForm
              mutationRef={clockRef}
              legend={t("clockAction")}
              description={t("clockHelp")}
              submitLabel={t("recordClock")}
              requiredMessage={t("required")}
              testId="hr-clock-form"
              fields={[
                {
                  name: "kind",
                  label: t("clockIntent"),
                  kind: "select",
                  required: true,
                  placeholder: t("chooseAction"),
                  options: [
                    { value: "CLOCK_IN", label: t("event.CLOCK_IN") },
                    { value: "BREAK_START", label: t("event.BREAK_START") },
                    { value: "BREAK_END", label: t("event.BREAK_END") },
                    { value: "CLOCK_OUT", label: t("event.CLOCK_OUT") },
                  ],
                },
              ]}
              toArgs={(values, requestId) => ({
                requestId,
                warehouseId,
                kind: values["kind"] as
                  "CLOCK_IN" | "BREAK_START" | "BREAK_END" | "CLOCK_OUT",
                deviceOccurredAt: Date.now(),
              })}
            />

            {day === undefined ? null : (
              <EntityWriteForm
                mutationRef={requestAttendanceCorrectionRef}
                legend={t("correctionAction")}
                description={t("correctionHelp")}
                submitLabel={t("submitCorrection")}
                requiredMessage={t("required")}
                testId="hr-correction-form"
                fields={[
                  {
                    name: "clockIn",
                    label: t("correctClockIn"),
                    kind: "text",
                    required: true,
                    placeholder: "2026-08-17T08:00:00+07:00",
                  },
                  {
                    name: "clockOut",
                    label: t("correctClockOut"),
                    kind: "text",
                    required: true,
                    placeholder: "2026-08-17T17:00:00+07:00",
                  },
                  {
                    name: "breakMinutes",
                    label: t("breakMinutes"),
                    kind: "number",
                    required: true,
                    initialValue: String(day.breakMinutes),
                  },
                  {
                    name: "reason",
                    label: t("reason"),
                    kind: "textarea",
                    required: true,
                  },
                ]}
                toArgs={(values, requestId) => ({
                  requestId,
                  warehouseId,
                  attendanceDayId: day.attendanceDayId,
                  requestedClockInAt: Date.parse(values["clockIn"] ?? ""),
                  requestedClockOutAt: Date.parse(values["clockOut"] ?? ""),
                  requestedBreakMinutes: Number(values["breakMinutes"]),
                  reason: values["reason"] ?? "",
                })}
              />
            )}
          </div>

          <EntityWriteForm
            mutationRef={requestLeaveRef}
            legend={t("leaveAction")}
            description={t("leaveHelp")}
            submitLabel={t("submitLeave")}
            requiredMessage={t("required")}
            testId="hr-leave-form"
            fields={[
              {
                name: "startDate",
                label: t("startDate"),
                kind: "text",
                required: true,
                placeholder: "YYYY-MM-DD",
              },
              {
                name: "endDate",
                label: t("endDate"),
                kind: "text",
                required: true,
                placeholder: "YYYY-MM-DD",
              },
              {
                name: "leaveType",
                label: t("leaveTypeLabel"),
                kind: "select",
                required: true,
                options: (
                  ["ANNUAL", "SICK", "PERSONAL", "UNPAID", "OTHER"] as const
                ).map((value) => ({ value, label: t(`leaveType.${value}`) })),
              },
              {
                name: "durationKind",
                label: t("duration"),
                kind: "select",
                required: true,
                options: (
                  ["FULL_DAY", "HALF_DAY_AM", "HALF_DAY_PM", "HOURS"] as const
                ).map((value) => ({
                  value,
                  label: t(`durationKind.${value}`),
                })),
              },
              {
                name: "hours",
                label: t("hours"),
                kind: "number",
                hint: t("hoursHint"),
              },
              {
                name: "privateReason",
                label: t("privateReason"),
                kind: "textarea",
                // Optional and private by design; `hours` above stays primary
                // because an HOURS-duration request cannot post without it.
                importance: "secondary",
                hint: t("privateReasonHint"),
              },
            ]}
            toArgs={(values, requestId) => ({
              requestId,
              warehouseId,
              startDate: values["startDate"] ?? "",
              endDate: values["endDate"] ?? "",
              leaveType: values["leaveType"] as "ANNUAL",
              durationKind: values["durationKind"] as "FULL_DAY",
              ...((values["hours"] ?? "") === ""
                ? {}
                : { hours: Number(values["hours"]) }),
              ...((values["privateReason"] ?? "") === ""
                ? {}
                : { privateReason: values["privateReason"] }),
            })}
          />

          <RequestHistory self={self} />
        </section>
      ) : self === undefined ? null : (
        <Notice
          tone="warning"
          title={t("noEmployeeTitle")}
          body={t("noEmployeeBody")}
        />
      )}

      {team === undefined ? null : (
        <section className="space-y-4" aria-labelledby="team-inbox-title">
          <div>
            <h2
              id="team-inbox-title"
              className="text-xl font-semibold text-text"
            >
              {t("teamInbox")}
            </h2>
            <p className="mt-1 text-sm text-muted">{t("teamPrivacyHelp")}</p>
          </div>
          <TeamInbox team={team} />
          <div className="grid gap-4 xl:grid-cols-2">
            <EntityWriteForm
              mutationRef={decideAttendanceCorrectionRef}
              legend={t("decideCorrection")}
              submitLabel={t("recordDecision")}
              requiredMessage={t("required")}
              fields={[
                {
                  name: "requestId",
                  label: t("request"),
                  kind: "select",
                  required: true,
                  options: correctionItems.map((item) => ({
                    value: item.requestId,
                    label: `${item.employeeNumber} · ${item.displayName}`,
                  })),
                },
                {
                  name: "decision",
                  label: t("decision"),
                  kind: "select",
                  required: true,
                  options: [
                    { value: "APPROVE", label: t("approve") },
                    { value: "REJECT", label: t("reject") },
                  ],
                },
                {
                  name: "note",
                  label: t("decisionNote"),
                  kind: "textarea",
                  required: true,
                },
              ]}
              toArgs={(values, requestId) => ({
                requestId,
                warehouseId,
                attendanceCorrectionId: values["requestId"] ?? "",
                decision: values["decision"] as "APPROVE" | "REJECT",
                note: values["note"] ?? "",
              })}
            />
            <EntityWriteForm
              mutationRef={decideLeaveRef}
              legend={t("decideLeave")}
              submitLabel={t("recordDecision")}
              requiredMessage={t("required")}
              fields={[
                {
                  name: "requestId",
                  label: t("request"),
                  kind: "select",
                  required: true,
                  options: leaveItems.map((item) => ({
                    value: item.requestId,
                    label: `${item.employeeNumber} · ${item.summary}`,
                  })),
                },
                {
                  name: "decision",
                  label: t("decision"),
                  kind: "select",
                  required: true,
                  options: [
                    { value: "APPROVE", label: t("approve") },
                    { value: "REJECT", label: t("reject") },
                  ],
                },
                {
                  name: "note",
                  label: t("decisionNote"),
                  kind: "textarea",
                  required: true,
                },
              ]}
              toArgs={(values, requestId) => ({
                requestId,
                warehouseId,
                leaveRequestId: values["requestId"] ?? "",
                decision: values["decision"] as "APPROVE" | "REJECT",
                note: values["note"] ?? "",
              })}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function Fact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold text-text">{value}</dd>
    </div>
  );
}

function RequestHistory({ self }: { readonly self: MyHrRecord }) {
  const t = useTranslations("HR");

  const businessDateOf = (attendanceDayId: string) =>
    (self.days ?? []).find((day) => day.attendanceDayId === attendanceDayId)
      ?.businessDate ?? attendanceDayId;
  const rows = [
    ...(self.corrections ?? []).map((request) => ({
      id: request.attendanceCorrectionId,
      kind: t("kindCorrection"),
      period: businessDateOf(request.attendanceDayId),
      status: request.status,
      requestedAt: request.requestedAt,
    })),
    ...(self.leaves ?? []).map((request) => ({
      id: request.leaveRequestId,
      kind: t("kindLeave"),
      period: `${request.startDate} – ${request.endDate}`,
      status: request.status,
      requestedAt: request.requestedAt,
    })),
  ];
  return (
    <TableScroller label={t("myRequests")}>
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <caption className="px-4 py-3 text-left font-semibold text-text">
          {t("myRequests")}
        </caption>
        <thead>
          <tr className="border-y border-border bg-raised text-left">
            <th className="px-4 py-3">{t("type")}</th>
            <th className="px-4 py-3">{t("period")}</th>
            <th className="px-4 py-3">{t("requestedAt")}</th>
            <th className="px-4 py-3">{t("status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border">
              <td className="px-4 py-3">{row.kind}</td>
              <td className="px-4 py-3 font-mono">{row.period}</td>
              <td className="px-4 py-3">{dateTime(row.requestedAt)}</td>
              <td className="px-4 py-3">
                <StatusBadge
                  tone={requestTone(row.status)}
                  label={t(`requestStatus.${row.status}`)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

function TeamInbox({ team }: { readonly team: TeamHrInboxPayload }) {
  const t = useTranslations("HR");
  return (
    <TableScroller label={t("teamInboxTable")} testId="hr-team-inbox">
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <caption className="px-4 py-3 text-left font-semibold text-text">
          {t("teamInboxCaption", { count: team.items.length })}
        </caption>
        <thead>
          <tr className="border-y border-border bg-raised text-left">
            <th className="px-4 py-3">{t("employee")}</th>
            <th className="px-4 py-3">{t("type")}</th>
            <th className="px-4 py-3">{t("period")}</th>
            <th className="px-4 py-3">{t("requestedAt")}</th>
          </tr>
        </thead>
        <tbody>
          {team.items.map((item) => (
            <tr key={item.requestId} className="border-b border-border">
              <td className="px-4 py-3">
                <span className="font-mono">{item.employeeNumber}</span>
                <br />
                {item.displayName}
              </td>
              <td className="px-4 py-3">
                {t(item.kind === "CORRECTION" ? "kindCorrection" : "kindLeave")}
              </td>
              <td className="px-4 py-3">{item.summary}</td>
              <td className="px-4 py-3">{dateTime(item.requestedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}
