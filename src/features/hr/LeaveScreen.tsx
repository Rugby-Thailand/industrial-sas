"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import {
  useDraftGuard,
  usePendingGuard,
} from "@/components/providers/draftGuard";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/CheckboxControl";
import { Link } from "@/i18n/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SelectControl } from "@/components/ui/SelectControl";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { RefValue } from "@/lib/convex/clientRef";
import { hrRefs } from "@/lib/convex/hrApi";
import { HR_CODES } from "@/lib/navigation";
import { guardedNavigate } from "@/lib/navigationGuard";
import type { LeaveType } from "../../../convex/model/hr/policy";
import { formatBusinessDate, formatDateTime } from "./format";
import { useHrAccess } from "@/components/providers/HrAccessProvider";
import {
  Facts,
  HrGate,
  HrInlineError,
  HrQueryState,
  SectionTitle,
  useHrBack,
  WriteFeedback,
} from "./HrShared";
import { useHrWrite } from "./useHrWrite";

type SelfLeave = Extract<RefValue<typeof hrRefs.leaveSelf>, { ok: true }>;
export type LeaveRequest = SelfLeave["requests"][number];

export function HrLeaveScreen() {
  const t = useTranslations("Hr.leave");
  const back = useHrBack();
  const identity = useHrAccess().identityKey;
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} {...back} />
      <HrGate code={HR_CODES.self}>
        <LeaveContent key={identity} />
      </HrGate>
    </>
  );
}
function LeaveContent() {
  const outcome = useQuery(hrRefs.leaveSelf, {});
  return (
    <HrQueryState outcome={outcome}>
      {() =>
        outcome?.ok ? (
          outcome.value.ok ? (
            <LeaveView key={outcome.value.employeeId} result={outcome.value} />
          ) : (
            <HrInlineError code={outcome.value.code} />
          )
        ) : null
      }
    </HrQueryState>
  );
}
function LeaveView({ result }: { readonly result: SelfLeave }) {
  const t = useTranslations("Hr.leave");
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <div className="space-y-6">
      {result.gate ? (
        <Notice
          tone="warning"
          title={t("gate")}
          body={t("gateHint")}
          testId="hr-leave-gate"
        />
      ) : null}
      {result.gate === "OPENING_BALANCE_REQUIRED" ? (
        <RenewEntitlements employeeId={result.employeeId} />
      ) : null}
      <Panel className="space-y-4">
        <SectionTitle>{t("balances")}</SectionTitle>
        {result.accounts.length === 0 ? (
          <p className="text-sm text-muted">{t("noAccounts")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {result.accounts.map((account) => (
              <section
                key={account.type}
                className="space-y-2 rounded-lg border border-border p-3"
              >
                <h3 className="font-semibold text-text">
                  {t(`types.${account.type}`)}
                </h3>
                <Facts
                  dense
                  items={[
                    {
                      label: t("available"),
                      value:
                        account.type === "SICK" || account.type === "MILITARY"
                          ? t("actualDuration")
                          : Math.max(0, account.available),
                    },
                    {
                      label: t("paidAvailable"),
                      value: account.paidAvailable,
                    },
                    { label: t("used"), value: account.used },
                    { label: t("reserved"), value: account.reserved },
                  ]}
                />
              </section>
            ))}
          </div>
        )}
      </Panel>
      {result.gate === null ? (
        <LeaveForm employeeId={result.employeeId} types={result.types} />
      ) : null}
      <Panel className="space-y-4">
        <SectionTitle>{t("requests")}</SectionTitle>
        {historyOpen ? (
          <LeaveHistory
            today={result.today}
            close={() => setHistoryOpen(false)}
          />
        ) : (
          <>
            {result.requests.length === 0 ? (
              <EmptyState title={t("empty")} />
            ) : (
              <ul className="space-y-3">
                {result.requests.map((request) => (
                  <li key={request._id}>
                    <LeaveRequestCard
                      request={request}
                      actions={
                        <LeaveCancel request={request} today={result.today} />
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
            {result.requestsComplete === false ? (
              <Button
                variant="outline"
                onClick={() => guardedNavigate(() => setHistoryOpen(true))}
              >
                {t("browse")}
              </Button>
            ) : null}
          </>
        )}
      </Panel>
    </div>
  );
}
type ChargePreview = Extract<
  RefValue<typeof hrRefs.previewLeave>,
  { ok: true }
>;
export function LeaveForm({
  employeeId,
  types,
  retained,
}: {
  readonly employeeId: string;
  readonly types: SelfLeave["types"];
  readonly retained?: LeaveRequest;
}) {
  const t = useTranslations("Hr.leave");
  const writeCopy = useTranslations("Hr.write");
  const id = useId();
  const client = useConvex();
  const submit = useMutation(hrRefs.submitLeave);
  const resubmit = useMutation(hrRefs.resubmitLeave);
  const write = useHrWrite(
    retained
      ? `leave-resubmit:${employeeId}:${retained._id}:${retained.version}`
      : `leave-submit:${employeeId}`,
  );
  const [preview, setPreview] = useState<ChargePreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  const [draft, setDraft] = useState({
    type: retained?.type ?? ("ANNUAL" as LeaveType),
    from: retained?.from ?? "",
    to: retained?.to ?? "",
    reason: retained?.reason ?? "",
    evidence: retained?.evidence ?? "",
    eventDate: retained?.eventDate ?? "",
  });
  const [invalid, setInvalid] = useState(false);
  const clearPreview = () => {
    generation.current += 1;
    setPreview(null);
    setConfirmed(false);
    setPreviewError(null);
    setPreviewing(false);
  };
  const change = (key: keyof typeof draft, value: string) => {
    clearPreview();
    if (write.state.kind !== "IDLE") write.reset();
    setDraft((previous) => ({ ...previous, [key]: value }));
  };
  const reset = () => {
    clearPreview();
    setDraft({
      type: retained?.type ?? "ANNUAL",
      from: retained?.from ?? "",
      to: retained?.to ?? "",
      reason: retained?.reason ?? "",
      evidence: retained?.evidence ?? "",
      eventDate: retained?.eventDate ?? "",
    });
    setInvalid(false);
  };
  useDraftGuard(
    !write.locked &&
      (draft.from !== "" ||
        draft.to !== "" ||
        draft.reason !== "" ||
        draft.evidence !== "" ||
        draft.eventDate !== ""),
    reset,
    write.pending || previewing,
  );
  const payload = () => ({
    type: draft.type,
    from: draft.from,
    to: draft.to,
    reason: draft.reason.trim(),
    ...(draft.evidence.trim() ? { evidence: draft.evidence.trim() } : {}),
    ...(["SPOUSE", "NEWBORN_CARE", "MATERNITY"].includes(draft.type) &&
    draft.eventDate
      ? { eventDate: draft.eventDate }
      : {}),
  });
  const check = async () => {
    if (
      !draft.from ||
      !draft.to ||
      draft.to < draft.from ||
      draft.reason.trim().length < 3
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const attempt = ++generation.current;
    setPreview(null);
    setConfirmed(false);
    setPreviewError(null);
    setPreviewing(true);
    try {
      const outcome = await client.query(hrRefs.previewLeave, {
        ...payload(),
        ...(retained
          ? { leaveRequestId: retained._id, expectedVersion: retained.version }
          : {}),
      });
      if (generation.current !== attempt) return;
      if (!outcome.ok) setPreviewError("ACCESS_DENIED");
      else if (!outcome.value.ok) setPreviewError(outcome.value.code);
      else setPreview(outcome.value);
    } catch {
      if (generation.current === attempt) setPreviewError("UNKNOWN");
    } finally {
      if (generation.current === attempt) setPreviewing(false);
    }
  };
  const complete = (result: {
    readonly kind: string;
    readonly code?: string;
  }) => {
    if (result.kind === "SAVED") reset();
    if (result.kind === "REFUSED") {
      clearPreview();
      if (result.code === "LEAVE_PREVIEW_STALE")
        setPreviewError("LEAVE_PREVIEW_STALE");
    }
  };
  const finish = async () => {
    if (!preview || !confirmed || write.locked || previewing) return;
    const fields = { ...payload(), expectedPreviewHash: preview.previewHash };
    const result = await write.submit((requestId) =>
      retained
        ? resubmit({
            requestId,
            ...fields,
            leaveRequestId: retained._id,
            expectedVersion: retained.version,
          })
        : submit({ requestId, ...fields }),
    );
    complete(result);
  };
  return (
    <Panel className="space-y-4">
      <SectionTitle>{t(retained ? "resubmit" : "request")}</SectionTitle>
      {retained ? (
        <p className="text-sm text-muted">{t("resubmitHint")}</p>
      ) : null}
      <p className="max-w-prose text-sm text-muted">{t("wholeDaysHint")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void finish();
        }}
        noValidate
        className="space-y-4"
      >
        <fieldset
          disabled={write.locked}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <FormField id={`${id}-type`} label={t("type")} required>
            {(field) => (
              <SelectControl
                id={field.id}
                value={draft.type}
                placeholder={t("type")}
                emptyLabel={t("type")}
                options={types.map((type) => ({
                  value: type,
                  label: t(`types.${type}`),
                }))}
                onValueChange={(value) => change("type", value)}
              />
            )}
          </FormField>
          {(["from", "to"] as const).map((key) => (
            <FormField key={key} id={`${id}-${key}`} label={t(key)} required>
              {(field) => (
                <Input
                  {...field}
                  type="date"
                  value={draft[key]}
                  onChange={(event) => change(key, event.target.value)}
                />
              )}
            </FormField>
          ))}
          <FormField
            id={`${id}-reason`}
            label={t("reason")}
            required
            className="sm:col-span-2 lg:col-span-3"
          >
            {(field) => (
              <Input
                {...field}
                value={draft.reason}
                maxLength={1000}
                onChange={(event) => change("reason", event.target.value)}
              />
            )}
          </FormField>
          <FormField
            id={`${id}-evidence`}
            label={t("evidence")}
            className="sm:col-span-2"
          >
            {(field) => (
              <Input
                {...field}
                value={draft.evidence}
                maxLength={1000}
                onChange={(event) => change("evidence", event.target.value)}
              />
            )}
          </FormField>
          {["SPOUSE", "NEWBORN_CARE", "MATERNITY"].includes(draft.type) ? (
            <FormField id={`${id}-event`} label={t("eventDate")} required>
              {(field) => (
                <Input
                  {...field}
                  type="date"
                  value={draft.eventDate}
                  onChange={(event) => change("eventDate", event.target.value)}
                />
              )}
            </FormField>
          ) : null}
        </fieldset>
        {invalid ? (
          <Notice tone="danger" role="alert" title={t("invalid")} />
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={write.locked || previewing}
          onClick={() => void check()}
        >
          {t(previewing ? "previewing" : "preview")}
        </Button>
        {previewError === "LEAVE_PREVIEW_STALE" ? (
          <Notice tone="warning" role="alert" title={t("previewStale")} />
        ) : previewError === "ACCESS_DENIED" ? (
          <Notice
            tone="danger"
            role="alert"
            title={writeCopy("denied")}
            body={writeCopy("deniedHint")}
          />
        ) : previewError ? (
          <HrInlineError code={previewError} />
        ) : null}
        {preview ? (
          <section
            className="bg-surface-alt space-y-3 rounded-lg p-4"
            data-testid="hr-leave-preview"
          >
            <h3 className="font-semibold text-text">{t("previewTitle")}</h3>
            <p className="text-sm text-muted">{t("previewHint")}</p>
            <p className="text-sm text-muted">
              {t(
                preview.type === "MATERNITY" ? "calendarBasis" : "workingBasis",
              )}
            </p>
            <Facts
              items={[
                { label: t("previewDays"), value: preview.days },
                { label: t("previewPaidDays"), value: preview.paidDays },
                {
                  label: t("previewPayPercent"),
                  value: `${preview.payPercent}%`,
                },
              ]}
            />
            <ul
              className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-text"
              aria-label={t("previewDays")}
            >
              {preview.dates.map((date) => (
                <li key={date}>
                  <time dateTime={date}>{date}</time>
                </li>
              ))}
            </ul>
            <CheckboxField
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={write.locked}
              label={t("previewConfirm")}
            />
          </section>
        ) : null}
        <Button
          type="submit"
          disabled={write.locked || !preview || !confirmed || previewing}
        >
          {write.pending
            ? t("submitting")
            : t(retained ? "resubmit" : "submit")}
        </Button>
        <WriteFeedback
          state={write.state}
          onRetry={() => void write.retry().then(complete)}
        />
      </form>
    </Panel>
  );
}

export function LeaveRequestCard({
  request,
  actions,
}: {
  readonly request: Omit<LeaveRequest, "_creationTime" | "orgId">;
  readonly actions?: ReactNode;
}) {
  const t = useTranslations("Hr.leave");
  const locale = useLocale();
  const timezone = useHrAccess().timezone ?? "Asia/Bangkok";
  return (
    <article className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-text">
            {t(`types.${request.type}`)}
          </h3>
          <p className="text-sm text-muted">
            {formatBusinessDate(request.from, locale)} –{" "}
            {formatBusinessDate(request.to, locale)}
          </p>
        </div>
        <StatusBadge
          tone={
            request.status === "APPROVED"
              ? "success"
              : request.status === "RETURNED"
                ? "warning"
                : request.status === "CANCELLED" ||
                    request.status === "WITHDRAWN"
                  ? "neutral"
                  : "pending"
          }
          label={t(`status.${request.status}`)}
        />
      </div>
      <p className="text-sm wrap-anywhere whitespace-pre-wrap text-text">
        {request.reason}
      </p>
      <p className="text-xs text-muted">
        {t("workingDays", { days: request.days, paidDays: request.paidDays })}
      </p>
      {request.evidence ? (
        <p className="text-sm wrap-anywhere whitespace-pre-wrap text-muted">
          {t("evidence")}: {request.evidence}
        </p>
      ) : null}
      {request.history.length ? (
        <details>
          <summary className="min-h-touch cursor-pointer text-sm text-link">
            {t("timeline")}
          </summary>
          <ol className="divide-y divide-border">
            {request.history.map((entry, index) => (
              <li
                key={`${entry.at}-${index}`}
                className="space-y-1 py-3 text-sm"
              >
                <p className="font-medium text-text">
                  {t.has(`history.${entry.action}`)
                    ? t(`history.${entry.action}`)
                    : t(`status.${request.status}`)}
                </p>
                <time
                  dateTime={new Date(entry.at).toISOString()}
                  className="text-xs text-muted"
                >
                  {formatDateTime(entry.at, locale, timezone)}
                </time>
                {entry.reason ? (
                  <p className="wrap-anywhere whitespace-pre-wrap text-muted">
                    {entry.reason}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      <Link
        className="inline-flex min-h-touch items-center text-sm text-link"
        href={`/hr/leave/${request._id}`}
      >
        {t("detail")}
      </Link>
      {actions}
    </article>
  );
}
export function LeaveCancel({
  request,
  today,
}: {
  readonly request: LeaveRequest;
  readonly today: string;
}) {
  const t = useTranslations("Hr.leave");
  const cancel = useMutation(hrRefs.cancelLeave);
  const write = useHrWrite(`leave-cancel:${request.employeeId}:${request._id}`);
  usePendingGuard(write.pending);
  if (request.status !== "PENDING" && request.status !== "APPROVED")
    return null;
  if (request.status === "APPROVED" && request.from <= today)
    return <p className="text-xs text-muted">{t("startedHint")}</p>;
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        disabled={write.locked}
        onClick={() =>
          void write.submit((requestId) =>
            cancel({
              requestId,
              leaveRequestId: request._id,
              expectedVersion: request.version,
            }),
          )
        }
      >
        {t(request.status === "PENDING" ? "cancelDraft" : "cancel")}
      </Button>
      <WriteFeedback state={write.state} onRetry={() => void write.retry()} />
    </div>
  );
}

function RenewEntitlements({ employeeId }: { readonly employeeId: string }) {
  const t = useTranslations("Hr.leave");
  const renew = useMutation(hrRefs.renewLeaveEntitlements);
  const write = useHrWrite(`leave-renewal:${employeeId}`);
  usePendingGuard(write.pending);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t("renewHint")}</p>
      <Button
        disabled={write.locked}
        onClick={() => void write.submit((requestId) => renew({ requestId }))}
      >
        {t("renew")}
      </Button>
      <WriteFeedback state={write.state} onRetry={() => void write.retry()} />
    </div>
  );
}
function LeaveHistory({
  today,
  close,
}: {
  readonly today: string;
  readonly close: () => void;
}) {
  const t = useTranslations("Hr.leave");
  const [cursors, setCursors] = useState<string[]>([]);
  const outcome = useQuery(hrRefs.leaveHistory, {
    paginationOpts: { numItems: 50, cursor: cursors.at(-1) ?? null },
  });
  return (
    <div className="space-y-4">
      <Button variant="outline" onClick={() => guardedNavigate(close)}>
        {t("returnCurrent")}
      </Button>
      <HrQueryState outcome={outcome}>
        {() =>
          outcome?.ok ? (
            outcome.value.ok ? (
              <>
                <ul className="space-y-3">
                  {outcome.value.page.map((request) => (
                    <li key={request._id}>
                      <LeaveRequestCard
                        request={request}
                        actions={
                          <LeaveCancel request={request} today={today} />
                        }
                      />
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    disabled={cursors.length === 0}
                    onClick={() =>
                      guardedNavigate(() =>
                        setCursors((previous) => previous.slice(0, -1)),
                      )
                    }
                  >
                    {t("previous")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={outcome.value.isDone}
                    onClick={() => {
                      if (outcome.value.ok) {
                        const cursor = outcome.value.continueCursor;
                        guardedNavigate(() =>
                          setCursors((previous) => [...previous, cursor]),
                        );
                      }
                    }}
                  >
                    {t("next")}
                  </Button>
                </div>
              </>
            ) : (
              <HrInlineError code={outcome.value.code} />
            )
          ) : null
        }
      </HrQueryState>
    </div>
  );
}
