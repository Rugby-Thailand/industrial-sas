"use client";

import { useMutation } from "convex/react";
import { useHrQuery } from "@/hooks/useHrQuery";
import { ArrowRight, Check, MessageSquarePlus, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";

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
  DayCorrectionItem,
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
import { HrPagedState, HrPager, useHrPagedQuery } from "./HrPagedList";
import { HrDisclosure } from "./HrUi";
import {
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
  const outcome = useHrQuery(hrRefs.reviewDayDetail, {
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
              <DecisionArea
                key={`${employeeId}:${businessDate}`}
                employeeId={employeeId}
                detail={detail}
                timezone={timezone}
              />
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
                <DayRequests
                  detail={detail}
                  timezone={timezone}
                  older={
                    <AllDayCorrections
                      employeeId={detail.employeeId}
                      businessDate={detail.businessDate}
                      timezone={timezone}
                    />
                  }
                />
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

/**
 * An exception day needs a disposition; a certified, unlocked day can be
 * deliberately re-certified (e.g. in a revision). A form with unsent or
 * pending input stays open when a live update certifies the day elsewhere.
 */
function DayDisposition(props: {
  readonly employeeId: string;
  readonly detail: DayDetail;
  readonly timezone: string;
  readonly available: boolean;
  readonly onHeld: (held: boolean) => void;
  readonly onDiscard: () => void;
  readonly onDecided: () => void;
}) {
  const t = useTranslations("Hr.review");
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState(false);
  const { onHeld, onDecided, ...form } = props;
  const reportHeld = useCallback(
    (holding: boolean) => {
      setHeld(holding);
      onHeld(holding);
    },
    [onHeld],
  );
  return open || held || props.detail.status === "EXCEPTION" ? (
    <DispositionForm
      {...form}
      onHeld={reportHeld}
      onSaved={() => {
        setOpen(false);
        reportHeld(false);
        onDecided();
      }}
      onDiscard={() => {
        setOpen(false);
        reportHeld(false);
        props.onDiscard();
      }}
    />
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

type ReviewAction =
  | { readonly kind: "correction"; readonly correction: Correction }
  | { readonly kind: "disposition" }
  | null;

/**
 * The reviewer's last successful decision on this day. It outlives the form
 * that sent it, which the decision's own live update removes, and is shown
 * apart from whatever the day needs next.
 */
type DecisionReceipt =
  | {
      readonly kind: "CERTIFY" | "RETURN";
      readonly correctionId: string;
      readonly version: number;
    }
  | { readonly kind: "DISPOSE" };

/** The inline command owner outlives live changes to the day's eligibility. */
function DecisionArea({
  employeeId,
  detail,
  timezone,
}: {
  readonly employeeId: string;
  readonly detail: DayDetail;
  readonly timezone: string;
}) {
  const t = useTranslations("Hr.review");
  const day = useTranslations("Hr.day");
  const pending = detail.corrections.find(
    (c) => c.id === detail.pendingCorrectionId,
  );
  const dispositionAvailable =
    !detail.locked &&
    pending === undefined &&
    (detail.status === "EXCEPTION" || detail.certification?.current === true);
  const liveAction: ReviewAction = detail.locked
    ? null
    : pending
      ? { kind: "correction", correction: pending }
      : dispositionAvailable
        ? { kind: "disposition" }
        : null;
  const [action, setAction] = useState(liveAction);
  const [held, setHeld] = useState(false);
  const [receipt, setReceipt] = useState<DecisionReceipt | null>(null);
  const identity = (value: ReviewAction) =>
    value?.kind === "correction" ? value.correction.id : (value?.kind ?? null);
  if (!held && identity(action) !== identity(liveAction)) setAction(liveAction);
  // A newer pending request (another one, or the employee's resubmission of
  // the returned one) supersedes the receipt.
  if (
    receipt !== null &&
    pending !== undefined &&
    (receipt.kind === "DISPOSE" ||
      pending.id !== receipt.correctionId ||
      pending.version > receipt.version)
  )
    setReceipt(null);
  const discard = () => {
    setHeld(false);
    setAction(liveAction);
  };
  const decided = useCallback(
    (decision: "CERTIFY" | "RETURN", decidedFor: Correction) =>
      setReceipt({
        kind: decision,
        correctionId: decidedFor.id,
        version: decidedFor.version,
      }),
    [],
  );
  const disposed = useCallback(() => setReceipt({ kind: "DISPOSE" }), []);
  return (
    <>
      {receipt === null ? null : (
        <Notice
          tone="success"
          title={t(
            receipt.kind === "CERTIFY"
              ? "certified"
              : receipt.kind === "RETURN"
                ? "returned"
                : "disposed",
          )}
          {...(receipt.kind === "RETURN" ? { body: t("returnedHint") } : {})}
          testId="hr-review-receipt"
        />
      )}
      {detail.locked ? (
        <Notice
          tone="warning"
          title={day("locked")}
          body={day("lockedHint")}
          testId="hr-review-locked"
        />
      ) : pending !== undefined && action?.kind === "disposition" ? (
        <Notice tone="pending" title={day("pendingHint")} />
      ) : !dispositionAvailable && pending === undefined ? (
        <Notice
          tone="neutral"
          title={t("nothingToDecide")}
          testId="hr-review-nothing"
        />
      ) : action?.kind === "correction" &&
        pending?.id !== action.correction.id ? (
        <Notice
          tone="neutral"
          title={t("nothingToDecide")}
          testId="hr-review-nothing"
        />
      ) : null}
      {action?.kind === "correction" ? (
        <CorrectionDecision
          key={action.correction.id}
          correction={
            detail.corrections.find((c) => c.id === action.correction.id) ??
            action.correction
          }
          detail={detail}
          timezone={timezone}
          available={!detail.locked && pending?.id === action.correction.id}
          onHeld={setHeld}
          onDiscard={discard}
          onDecided={decided}
        />
      ) : action?.kind === "disposition" ? (
        <DayDisposition
          employeeId={employeeId}
          detail={detail}
          timezone={timezone}
          available={dispositionAvailable}
          onHeld={setHeld}
          onDiscard={discard}
          onDecided={disposed}
        />
      ) : null}
    </>
  );
}

function CorrectionDecision({
  correction,
  detail,
  timezone,
  available,
  onHeld,
  onDiscard,
  onDecided,
}: {
  readonly correction: Correction;
  readonly detail: DayDetail;
  readonly timezone: string;
  readonly available: boolean;
  readonly onHeld: (held: boolean) => void;
  readonly onDiscard: () => void;
  /** A successful decision; its receipt is shown by the decision area. */
  readonly onDecided: (
    decision: "CERTIFY" | "RETURN",
    correction: Correction,
  ) => void;
}) {
  const t = useTranslations("Hr.review");
  const form = useTranslations("Hr.form");
  const decide = useMutation(hrRefs.decideCorrection);
  const [loaded, setLoaded] = useState(correction);
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
  const write = useHrWrite(`decision:${loaded.id}:${loaded.version}`);
  const held = write.state.kind !== "SAVED" && comment.trim() !== "";
  const stale = loaded.version !== correction.version;
  if (stale && !held && !write.locked && write.state.kind !== "SAVED")
    setLoaded(correction);
  const changed = stale && !write.locked && write.state.kind !== "SAVED";
  const holding = held || write.locked;
  useEffect(() => onHeld(holding), [holding, onHeld]);
  useEffect(() => () => onHeld(false), [onHeld]);
  // A comment is an unsent detail; a decision in flight (with or without a
  // comment) must settle before search, AI or a link can leave the page.
  const draft = useDraftGuard(
    held,
    () => {
      setComment("");
      setError(undefined);
      setCommentOpen(false);
      setReturning(false);
    },
    write.pending,
  );
  const discardDraft = () => {
    setComment("");
    setError(undefined);
    setCommentOpen(false);
    setReturning(false);
    write.reset();
    draft.settle();
    onDiscard();
  };

  const send = async (choice: "CERTIFY" | "RETURN") => {
    if (!available || changed || write.locked) return;
    setDecision(choice);
    setError(undefined);
    const sent = loaded;
    const result = await write.submit((requestId) =>
      decide({
        requestId,
        correctionId: sent.id,
        expectedVersion: sent.version,
        decision: choice,
        ...(comment.trim() === "" ? {} : { reason: comment.trim() }),
      }),
    );
    if (result.kind === "SAVED") onDecided(choice, sent);
  };
  // Return needs a reason: a first press reveals the field, and a typed
  // reason is sent as it stands.
  const sendReturn = () => {
    if (!available || changed || write.locked) return;
    if (comment.trim().length >= 3) return void send("RETURN");
    if (returning) setError(t("returnReasonRequired"));
    setReturning(true);
    setFocusField((count) => count + 1);
  };
  const changedTimes = {
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
                  changedTimes.start,
                ],
                [
                  "clockOut",
                  detail.originalEndAt,
                  correction.proposedEndAt,
                  changedTimes.end,
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
              disabled={write.locked || !available || changed}
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
              disabled={
                write.locked || correction.stale || !available || changed
              }
              onClick={() => void send("CERTIFY")}
              data-testid="hr-certify"
            >
              <Check aria-hidden="true" />
              {t("certify")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={write.locked || !available || changed}
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
      {changed && available ? (
        <Notice
          tone="warning"
          role="alert"
          title={form("recordChanged")}
          body={form("recordChangedHint")}
        >
          <Button
            type="button"
            variant="outline"
            onClick={() => setLoaded(correction)}
          >
            {form("recordChangedUse")}
          </Button>
        </Notice>
      ) : null}
      {!available || changed ? (
        <Button
          type="button"
          variant="outline"
          disabled={write.locked}
          onClick={discardDraft}
        >
          {form("discardDraft")}
        </Button>
      ) : null}
      {changed ? null : (
        <WriteFeedback
          state={write.state}
          onRetry={() =>
            void write.retry().then((result) => {
              if (result.kind === "SAVED") onDecided(decision, loaded);
            })
          }
          // The decision area keeps the receipt once this form is gone.
          saved={null}
        />
      )}
    </section>
  );
}

const DISPOSITIONS = ["WORKED", "ABSENT", "LEAVE", "NONWORKING"] as const;
type DispositionChoice = (typeof DISPOSITIONS)[number];

/** The form's starting values for a loaded day. */
function dispositionBaseline(
  day: DayDetail,
  timezone: string,
): { choice: DispositionChoice; start: TimeSide; end: TimeSide } {
  // A re-review starts from the certified times; otherwise the originals.
  return {
    choice:
      day.certification?.disposition ??
      (day.originalStartAt !== undefined ? "WORKED" : "ABSENT"),
    start: sideFromInstant(
      day.certification?.startAt ?? day.originalStartAt,
      day.businessDate,
      timezone,
    ),
    end: sideFromInstant(
      day.certification?.endAt ?? day.originalEndAt,
      day.businessDate,
      timezone,
    ),
  };
}

/** Explicit accounting for an exception day without a pending request. */
function DispositionForm({
  employeeId,
  detail,
  timezone,
  onHeld,
  onSaved,
  onDiscard,
  available,
}: {
  readonly employeeId: string;
  readonly detail: DayDetail;
  readonly timezone: string;
  /** Reports unsent or in-flight input that a live update must not unmount. */
  readonly onHeld: (held: boolean) => void;
  readonly onSaved: () => void;
  readonly onDiscard: () => void;
  readonly available: boolean;
}) {
  const t = useTranslations("Hr.review");
  const status = useTranslations("Hr.status.disposition");
  const form = useTranslations("Hr.form");
  const dispose = useMutation(hrRefs.disposeDay);
  const id = useId();
  // The day revision this form was loaded from. A decision is always sent
  // against it, so a newer live revision needs the reviewer's explicit choice.
  const [loaded, setLoaded] = useState(detail);
  const [initial, setInitial] = useState(() =>
    dispositionBaseline(detail, timezone),
  );
  const [choice, setChoice] = useState<DispositionChoice>(initial.choice);
  const [start, setStart] = useState<TimeSide>(initial.start);
  const [end, setEnd] = useState<TimeSide>(initial.end);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ time?: string; reason?: string }>({});
  const write = useHrWrite(
    `dispose:${employeeId}:${detail.businessDate}:${loaded.revision}`,
  );
  const held =
    write.state.kind !== "SAVED" &&
    (reason.trim() !== "" ||
      JSON.stringify([choice, start, end]) !==
        JSON.stringify([initial.choice, initial.start, initial.end]));
  const stale = detail.revision !== loaded.revision;
  // A clean, settled form follows the live day.
  if (stale && !held && !write.locked && write.state.kind !== "SAVED") {
    const next = dispositionBaseline(detail, timezone);
    setLoaded(detail);
    setInitial(next);
    setChoice(next.choice);
    setStart(next.start);
    setEnd(next.end);
    setErrors({});
  }
  // A held draft over a newer revision waits for the user's explicit choice
  // (a clean one has just adopted the live day above).
  const changed = stale && !write.locked && write.state.kind !== "SAVED";
  const draft = useDraftGuard(
    held,
    () => {
      setChoice(initial.choice);
      setStart(initial.start);
      setEnd(initial.end);
      setReason("");
      setErrors({});
    },
    write.pending,
  );
  const holding = held || write.locked;
  useEffect(() => onHeld(holding), [holding, onHeld]);
  useEffect(() => () => onHeld(false), [onHeld]);
  // Edited values stay; untouched choice and times follow the current record.
  const adoptCurrent = () => {
    const next = dispositionBaseline(detail, timezone);
    setLoaded(detail);
    setInitial(next);
    setChoice((value) => (value === initial.choice ? next.choice : value));
    setStart((side) => (side.untouched ? next.start : side));
    setEnd((side) => (side.untouched ? next.end : side));
    setErrors({});
  };
  const discardDraft = () => {
    const next = dispositionBaseline(detail, timezone);
    setLoaded(detail);
    setInitial(next);
    setChoice(next.choice);
    setStart(next.start);
    setEnd(next.end);
    setReason("");
    setErrors({});
    write.reset();
    draft.settle();
    onDiscard();
  };
  const complete = (result: { readonly kind: string }) => {
    if (result.kind === "SAVED") {
      draft.settle();
      onSaved();
    }
  };

  const send = async () => {
    // Never send a draft against a revision the reviewer has not accepted.
    if (!available || changed || write.locked) return;
    const next: { time?: string; reason?: string } = {};
    // An untouched side keeps its exact saved instant, seconds included: the
    // current certification's (retained by the server against this revision)
    // or, when it has none, the original clock event.
    const certified = loaded.certification?.current
      ? loaded.certification
      : undefined;
    const retainCertified = {
      start: certified?.startAt !== undefined && start.untouched === true,
      end: certified?.endAt !== undefined && end.untouched === true,
    };
    const worked = choice === "WORKED";
    const startInput = worked
      ? toLocalTimeInput(
          start,
          retainCertified.start || loaded.certification?.startAt === undefined,
        )
      : undefined;
    const endInput = worked
      ? toLocalTimeInput(
          end,
          retainCertified.end || loaded.certification?.endAt === undefined,
        )
      : undefined;
    if (startInput === null || endInput === null)
      next.time = form("timeInvalid");
    if (reason.trim().length < 3) next.reason = form("reasonRequired");
    setErrors(next);
    if (next.time !== undefined || next.reason !== undefined) return;
    const result = await write.submit((requestId) =>
      dispose({
        requestId,
        employeeId,
        businessDate: loaded.businessDate,
        expectedRevision: loaded.revision,
        disposition: choice,
        ...(startInput ? { start: startInput } : {}),
        ...(endInput ? { end: endInput } : {}),
        ...(worked && (retainCertified.start || retainCertified.end)
          ? { retainCertified }
          : {}),
        reason: reason.trim(),
      }),
    );
    complete(result);
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
      {changed && available ? (
        <Notice
          tone="warning"
          role="alert"
          title={form("recordChanged")}
          body={form("recordChangedHint")}
          testId="hr-dispose-changed"
        >
          <Button type="button" variant="outline" onClick={adoptCurrent}>
            {form("recordChangedUse")}
          </Button>
        </Notice>
      ) : null}
      <Button
        type="submit"
        disabled={write.locked || changed || !available}
        data-testid="hr-dispose-submit"
      >
        {write.pending ? form("submitting") : t("disposeSubmit")}
      </Button>
      {!available || changed ? (
        <Button
          type="button"
          variant="outline"
          disabled={write.locked}
          onClick={discardDraft}
        >
          {form("discardDraft")}
        </Button>
      ) : null}
      {changed ? null : (
        <WriteFeedback
          state={write.state}
          onRetry={() => void write.retry().then(complete)}
          // The decision area keeps the receipt once this form closes.
          saved={null}
        />
      )}
    </form>
  );
}

/**
 * Every correction request of the reviewed day, a page at a time; mounted
 * only when opened, since the day detail already shows the newest ones.
 */
function AllDayCorrections({
  employeeId,
  businessDate,
  timezone,
}: {
  readonly employeeId: string;
  readonly businessDate: string;
  readonly timezone: string;
}) {
  const t = useTranslations("Hr.day");
  const [open, setOpen] = useState(false);
  return (
    <HrDisclosure
      label={t("allRequestsShow")}
      open={open}
      onToggle={setOpen}
      contentClassName="space-y-3"
      testId="hr-corrections-all"
    >
      {open ? (
        <AllDayCorrectionsList
          employeeId={employeeId}
          businessDate={businessDate}
          timezone={timezone}
        />
      ) : null}
    </HrDisclosure>
  );
}

function AllDayCorrectionsList({
  employeeId,
  businessDate,
  timezone,
}: {
  readonly employeeId: string;
  readonly businessDate: string;
  readonly timezone: string;
}) {
  const t = useTranslations("Hr.day");
  const { view, paging } = useHrPagedQuery(
    hrRefs.dayCorrectionsPage,
    { employeeId, businessDate },
    "day-corrections",
  );
  return (
    <>
      <HrPagedState<typeof hrRefs.dayCorrectionsPage>
        view={view}
        refused={(code) => <HrInlineError code={code} />}
      >
        {(_value, rows) =>
          rows.length === 0 ? (
            <p className="text-sm text-muted">{t("noRequests")}</p>
          ) : (
            <ul className="space-y-4">
              {rows.map((correction) => (
                <DayCorrectionItem
                  key={correction.id}
                  correction={correction}
                  timezone={timezone}
                />
              ))}
            </ul>
          )
        }
      </HrPagedState>
      <HrPager paging={paging} label={t("allRequestsPagination")} />
    </>
  );
}
