"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowRight, Check, MessageSquarePlus, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { SelectControl } from "@/components/ui/SelectControl";
import { Label } from "@/components/ui/label";
import { useDraftGuard } from "@/components/providers/draftGuard";
import { usePageSearchContext } from "@/components/shell/search/pageContext";
import { hrRefs } from "@/lib/convex/hrApi";
import { useDeepLinkFocus } from "@/lib/deepLink";
import { FOCUS_TARGET_IDS, type ReviewFocus } from "@/lib/navigation";

import { ReasonField } from "./CorrectionForm";
import {
  DayCertification,
  DayEvents,
  DayHeading,
  DayPriorDecisions,
  DayRequests,
  DayTimes,
  type DayDetail,
} from "./DayDetailView";
import {
  HrInlineError,
  HrQueryState,
  PlanText,
  SectionTitle,
  TimeText,
  WriteFeedback,
} from "./HrShared";
import { HrDisclosure } from "./HrUi";
import {
  EMPTY_SIDE,
  TimeSideField,
  sideFromInstant,
  toLocalTimeInput,
  type TimeSide,
} from "./TimeSideField";
import { useHrWrite } from "./useHrWrite";

export function ReviewDetail({
  employeeId,
  businessDate,
  focus,
}: {
  readonly employeeId: string;
  readonly businessDate: string;
  /** Opened from a link: move to the decision area once it has loaded. */
  readonly focus?: ReviewFocus;
}) {
  const t = useTranslations("Hr.review");
  const day = useTranslations("Hr.day");
  const outcome = useQuery(hrRefs.reviewDayDetail, {
    employeeId,
    businessDate,
  });
  const loaded =
    outcome?.ok === true && outcome.value.ok ? outcome.value : null;
  useDeepLinkFocus(
    focus === undefined ? null : FOCUS_TARGET_IDS.decision,
    loaded !== null,
    `${employeeId}:${businessDate}`,
  );
  // "This record" for AI Search, from what this page loaded and may show.
  usePageSearchContext(
    loaded === null
      ? null
      : {
          page: "hr.review",
          employee: {
            id: loaded.employee.id,
            code: loaded.employee.code,
            name: loaded.employee.displayName,
          },
          date: businessDate,
        },
  );
  return (
    <HrQueryState outcome={outcome}>
      {() => {
        if (!outcome?.ok) return null;
        const result = outcome.value;
        if (!result.ok) return <HrInlineError code={result.code} />;
        const { detail, timezone, employee } = result;
        const pending = detail.corrections.find(
          (correction) => correction.id === detail.pendingCorrectionId,
        );
        return (
          <Panel
            aria-labelledby="hr-day-summary"
            className="space-y-4 p-3 sm:p-4"
          >
            <DayHeading
              detail={detail}
              heading={`${employee.displayName} · ${employee.code}`}
            />
            {employee.linked ? null : <UnlinkedNote />}
            {/* The decision area a link focuses: the evidence, then the
                action; a locked or settled day explains itself instead. */}
            <div
              id={FOCUS_TARGET_IDS.decision}
              className="space-y-4 rounded-lg"
            >
              {pending === undefined ? (
                <RecordedTimes detail={detail} timezone={timezone} />
              ) : null}
              {detail.certification?.current ? (
                <DayCertification detail={detail} timezone={timezone} />
              ) : null}
              {detail.locked ? (
                <Notice
                  tone="warning"
                  title={day("locked")}
                  body={day("lockedHint")}
                  testId="hr-review-locked"
                />
              ) : pending !== undefined ? (
                <CorrectionDecision
                  key={`${pending.id}:${pending.version}`}
                  correction={pending}
                  detail={detail}
                  timezone={timezone}
                />
              ) : detail.status === "EXCEPTION" ? (
                <DispositionForm
                  key={`${employeeId}:${businessDate}:${detail.revision}`}
                  employeeId={employeeId}
                  detail={detail}
                  timezone={timezone}
                />
              ) : detail.certification?.current ? (
                <ReviewAgain
                  key={`${employeeId}:${businessDate}:${detail.revision}`}
                  employeeId={employeeId}
                  detail={detail}
                  timezone={timezone}
                />
              ) : (
                <Notice
                  tone="neutral"
                  title={t("nothingToDecide")}
                  testId="hr-review-nothing"
                />
              )}
            </div>
            {/* Read-only: calculated times, earlier decisions and the logs.
                The original times stay in the decision area above. */}
            <HrDisclosure
              label={t("details")}
              className="border-t border-border"
              contentClassName="space-y-5"
              testId="hr-review-details"
            >
              <DayTimes detail={detail} timezone={timezone} effectiveOnly />
              {detail.certification?.current ? null : (
                <DayCertification detail={detail} timezone={timezone} />
              )}
              <DayPriorDecisions detail={detail} timezone={timezone} />
              <section aria-labelledby="hr-day-events">
                <DayEvents detail={detail} timezone={timezone} />
              </section>
              <section aria-labelledby="hr-day-requests">
                <DayRequests detail={detail} timezone={timezone} />
              </section>
            </HrDisclosure>
          </Panel>
        );
      }}
    </HrQueryState>
  );
}

/**
 * The planned shift and the times as recorded, shown once ahead of a
 * disposition (a correction request shows them in its own comparison).
 */
function RecordedTimes({
  detail,
  timezone,
}: {
  readonly detail: DayDetail;
  readonly timezone: string;
}) {
  const t = useTranslations("Hr.review");
  return (
    <dl
      className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-x-4 gap-y-2 rounded-lg bg-raised px-3 py-2 text-sm"
      data-testid="hr-review-recorded"
    >
      <div className="min-w-0">
        <dt className="text-xs text-muted">{t("planned")}</dt>
        <dd className="font-medium break-words text-text">
          <PlanText plan={detail.plan} />
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-muted">{t("recordedIn")}</dt>
        <dd className="font-medium text-text tabular-nums">
          <TimeText at={detail.originalStartAt} timeZone={timezone} />
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-muted">{t("recordedOut")}</dt>
        <dd className="font-medium text-text tabular-nums">
          <TimeText at={detail.originalEndAt} timeZone={timezone} />
        </dd>
      </div>
    </dl>
  );
}

/** A certified, unlocked day can be deliberately re-certified (e.g. in a revision). */
function ReviewAgain(props: {
  readonly employeeId: string;
  readonly detail: DayDetail;
  readonly timezone: string;
}) {
  const t = useTranslations("Hr.review");
  const [open, setOpen] = useState(false);
  return open ? (
    <DispositionForm {...props} />
  ) : (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t("reviewAgain")}
      </Button>
      <p className="text-sm text-muted">{t("reviewAgainHint")}</p>
    </div>
  );
}

function UnlinkedNote() {
  const t = useTranslations("Hr.review");
  return (
    <Notice tone="neutral" title={t("unlinked")} body={t("unlinkedHint")} />
  );
}

type Correction = DayDetail["corrections"][number];

function CorrectionDecision({
  correction,
  detail,
  timezone,
}: {
  readonly correction: Correction;
  readonly detail: DayDetail;
  readonly timezone: string;
}) {
  const t = useTranslations("Hr.review");
  const decide = useMutation(hrRefs.decideCorrection);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string>();
  const [decision, setDecision] = useState<"CERTIFY" | "RETURN">("CERTIFY");
  // The one text field is asked for on demand: as an optional comment, or
  // as the required reason once Return is chosen. Typed text is never
  // hidden, so nothing unseen is sent with a decision.
  const [commentOpen, setCommentOpen] = useState(false);
  const [returning, setReturning] = useState(false);
  const fieldShown = commentOpen || returning || comment !== "";
  const field = useRef<HTMLTextAreaElement>(null);
  const [focusField, setFocusField] = useState(0);
  useEffect(() => {
    if (focusField > 0) field.current?.focus();
  }, [focusField]);
  const write = useHrWrite(`decision:${correction.id}:${correction.version}`);
  // A comment is an unsent detail; a decision in flight (with or without a
  // comment) must settle before search, AI or a link can leave the page.
  useDraftGuard(
    write.state.kind !== "SAVED" && comment.trim() !== "",
    () => {
      setComment("");
      setError(undefined);
      setCommentOpen(false);
      setReturning(false);
    },
    write.pending,
  );

  const send = async (choice: "CERTIFY" | "RETURN") => {
    setDecision(choice);
    setError(undefined);
    await write.submit((requestId) =>
      decide({
        requestId,
        correctionId: correction.id,
        expectedVersion: correction.version,
        decision: choice,
        ...(comment.trim() === "" ? {} : { reason: comment.trim() }),
      }),
    );
  };
  // Return needs a reason: a first press reveals the field, and a typed
  // reason is sent as it stands.
  const sendReturn = () => {
    if (comment.trim().length >= 3) return void send("RETURN");
    if (returning) setError(t("returnReasonRequired"));
    setReturning(true);
    setFocusField((count) => count + 1);
  };
  const changed = {
    start: correction.proposedStartAt !== detail.originalStartAt,
    end: correction.proposedEndAt !== detail.originalEndAt,
  };

  return (
    <section aria-labelledby="hr-decision-title" className="space-y-4">
      <h3 id="hr-decision-title" className="sr-only">
        {t("decisionTitle")}
      </h3>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full table-fixed text-sm">
          <caption className="border-b border-border bg-raised px-3 py-2 text-left text-sm text-muted">
            {t("planned")}:{" "}
            <span className="font-medium text-text">
              <PlanText plan={detail.plan} />
            </span>
          </caption>
          <thead>
            <tr className="text-left text-xs text-muted">
              <td className="w-[30%] px-3 pt-2" />
              <th scope="col" className="px-2 pt-2 font-medium">
                {t("original")}
              </th>
              <th scope="col" className="px-2 pt-2 font-semibold text-link">
                <span className="inline-flex items-center gap-1">
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                  {t("proposed")}
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {(
              [
                [
                  "clockIn",
                  detail.originalStartAt,
                  correction.proposedStartAt,
                  changed.start,
                ],
                [
                  "clockOut",
                  detail.originalEndAt,
                  correction.proposedEndAt,
                  changed.end,
                ],
              ] as const
            ).map(([key, original, proposed, differs]) => (
              <tr key={key} data-testid={`hr-compare-${key}`}>
                <th
                  scope="row"
                  className="px-3 py-2 text-left font-normal break-words text-muted"
                >
                  {t(key)}
                </th>
                <td className="px-2 py-2 font-medium break-words text-text">
                  <TimeText at={original} timeZone={timezone} />
                </td>
                <td
                  className={`px-2 py-2 break-words ${
                    differs
                      ? "bg-selected/40 font-semibold text-link"
                      : "font-medium text-text"
                  }`}
                >
                  <TimeText at={proposed} timeZone={timezone} />
                  {differs ? (
                    <span className="sr-only"> ({t("changed")})</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <p className="text-xs text-muted">{t("employeeReason")}</p>
        <p className="mt-1 rounded-lg bg-raised p-3 text-sm break-words text-text">
          {correction.reason}
        </p>
      </div>
      {correction.stale ? (
        <Notice
          tone="warning"
          role="alert"
          title={t("stale")}
          body={t("staleHint")}
        />
      ) : null}
      {/* Kept mounted while hidden so toggling never drops typed text. */}
      <div hidden={!fieldShown}>
        <ReasonField
          label={t(returning ? "returnReason" : "comment")}
          value={comment}
          onChange={setComment}
          error={error}
          required={returning}
          disabled={write.locked}
          inputRef={field}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {returning ? (
          <>
            <Button
              type="button"
              disabled={write.locked}
              onClick={sendReturn}
              data-testid="hr-return-confirm"
            >
              <Undo2 aria-hidden="true" />
              {t("returnConfirm")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={write.locked}
              onClick={() => {
                setReturning(false);
                setError(undefined);
              }}
              data-testid="hr-return-cancel"
            >
              {t("returnCancel")}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              disabled={write.locked || correction.stale}
              onClick={() => void send("CERTIFY")}
              data-testid="hr-certify"
            >
              <Check aria-hidden="true" />
              {t("certify")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={write.locked}
              onClick={sendReturn}
              data-testid="hr-return"
            >
              <Undo2 aria-hidden="true" />
              {t("return")}
            </Button>
            {fieldShown ? null : (
              <Button
                type="button"
                variant="ghost"
                disabled={write.locked}
                onClick={() => {
                  setCommentOpen(true);
                  setFocusField((count) => count + 1);
                }}
                data-testid="hr-comment-add"
              >
                <MessageSquarePlus aria-hidden="true" />
                {t("commentAdd")}
              </Button>
            )}
          </>
        )}
      </div>
      <WriteFeedback
        state={write.state}
        onRetry={() => void write.retry()}
        saved={
          <p role="status" className="text-sm font-semibold text-success">
            {t(decision === "CERTIFY" ? "certified" : "returned")}
          </p>
        }
      />
    </section>
  );
}

const DISPOSITIONS = ["WORKED", "ABSENT", "LEAVE", "NONWORKING"] as const;
type DispositionChoice = (typeof DISPOSITIONS)[number];

/** Explicit accounting for an exception day without a pending request. */
function DispositionForm({
  employeeId,
  detail,
  timezone,
}: {
  readonly employeeId: string;
  readonly detail: DayDetail;
  readonly timezone: string;
}) {
  const t = useTranslations("Hr.review");
  const status = useTranslations("Hr.status.disposition");
  const form = useTranslations("Hr.form");
  const dispose = useMutation(hrRefs.disposeDay);
  const id = useId();
  const defaultChoice: DispositionChoice =
    detail.certification?.disposition ??
    (detail.originalStartAt !== undefined ? "WORKED" : "ABSENT");
  const [choice, setChoice] = useState<DispositionChoice>(defaultChoice);
  // A re-review starts from the certified times; otherwise the originals.
  const startAt = detail.certification?.startAt ?? detail.originalStartAt;
  const endAt = detail.certification?.endAt ?? detail.originalEndAt;
  const [start, setStart] = useState<TimeSide>(() =>
    sideFromInstant(startAt, detail.businessDate, timezone),
  );
  const [end, setEnd] = useState<TimeSide>(() =>
    endAt === undefined
      ? EMPTY_SIDE
      : sideFromInstant(endAt, detail.businessDate, timezone),
  );
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ time?: string; reason?: string }>({});
  const write = useHrWrite(
    `dispose:${employeeId}:${detail.businessDate}:${detail.revision}`,
  );
  const [initial] = useState(() => ({ choice: defaultChoice, start, end }));
  useDraftGuard(
    write.state.kind !== "SAVED" &&
      (reason.trim() !== "" ||
        JSON.stringify([choice, start, end]) !==
          JSON.stringify([initial.choice, initial.start, initial.end])),
    () => {
      setChoice(initial.choice);
      setStart(initial.start);
      setEnd(initial.end);
      setReason("");
      setErrors({});
    },
    write.pending,
  );

  const send = async () => {
    const next: { time?: string; reason?: string } = {};
    const startInput =
      choice === "WORKED" ? toLocalTimeInput(start) : undefined;
    const endInput = choice === "WORKED" ? toLocalTimeInput(end) : undefined;
    if (startInput === null || endInput === null)
      next.time = form("timeInvalid");
    if (reason.trim().length < 3) next.reason = form("reasonRequired");
    setErrors(next);
    if (next.time !== undefined || next.reason !== undefined) return;
    await write.submit((requestId) =>
      dispose({
        requestId,
        employeeId,
        businessDate: detail.businessDate,
        expectedRevision: detail.revision,
        disposition: choice,
        ...(startInput ? { start: startInput } : {}),
        ...(endInput ? { end: endInput } : {}),
        reason: reason.trim(),
      }),
    );
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby={`${id}-title`}
      className="space-y-4"
    >
      <SectionTitle>
        <span id={`${id}-title`}>{t("disposeTitle")}</span>
      </SectionTitle>
      <div className="grid gap-2 sm:max-w-sm">
        <Label htmlFor={`${id}-choice`}>{t("disposition")}</Label>
        <SelectControl
          id={`${id}-choice`}
          value={choice}
          onValueChange={(value) => setChoice(value as DispositionChoice)}
          placeholder={t("disposition")}
          emptyLabel={t("disposition")}
          disabled={write.locked}
          options={DISPOSITIONS.map((value) => ({
            value,
            label: status(value),
          }))}
        />
        <p className="text-xs text-muted">{t(`dispositionHint.${choice}`)}</p>
      </div>
      {choice === "WORKED" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <TimeSideField
            label={t("clockIn")}
            side={start}
            onChange={setStart}
            disabled={write.locked}
          />
          <TimeSideField
            label={t("clockOut")}
            side={end}
            onChange={setEnd}
            disabled={write.locked}
            error={errors.time}
          />
        </div>
      ) : null}
      <ReasonField
        label={t("disposeReason")}
        value={reason}
        onChange={setReason}
        error={errors.reason}
        disabled={write.locked}
      />
      <Button
        type="submit"
        disabled={write.locked}
        data-testid="hr-dispose-submit"
      >
        {write.pending ? form("submitting") : t("disposeSubmit")}
      </Button>
      <WriteFeedback state={write.state} onRetry={() => void write.retry()} />
    </form>
  );
}
