"use client";

import { useMutation, useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { useDraftGuard } from "@/components/providers/draftGuard";
import { Button } from "@/components/ui/button";
import { CheckboxControl } from "@/components/ui/CheckboxControl";
import { Panel } from "@/components/ui/Panel";
import { Link } from "@/i18n/navigation";
import { formatBusinessDate } from "./format";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import type { RefValue } from "@/lib/convex/clientRef";
import { hrRefs } from "@/lib/convex/hrApi";
import { HR_CODES } from "@/lib/navigation";
import {
  HrGate,
  HrInlineError,
  HrQueryState,
  SectionTitle,
  useHrBack,
  WriteFeedback,
} from "./HrShared";
import { LeaveRequestCard, type LeaveRequest } from "./LeaveScreen";
import { useHrWrite } from "./useHrWrite";

type QueueItem = Extract<
  RefValue<typeof hrRefs.leaveQueue>,
  { ok: true }
>["items"][number];
export function HrLeaveReviewScreen() {
  const t = useTranslations("Hr.leave");
  const back = useHrBack();
  return (
    <>
      <PageHeader
        title={t("reviewTitle")}
        summary={t("reviewSummary")}
        {...back}
      />
      <HrGate code={HR_CODES.review}>
        <ReviewContent />
      </HrGate>
    </>
  );
}
function ReviewContent() {
  const t = useTranslations("Hr.leave");
  const outcome = useQuery(hrRefs.leaveQueue, {});
  return (
    <HrQueryState outcome={outcome}>
      {() =>
        outcome?.ok ? (
          outcome.value.ok ? (
            outcome.value.items.length === 0 ? (
              <EmptyState title={t("emptyQueue")} />
            ) : (
              <ul className="space-y-4">
                {outcome.value.items.map((item) => (
                  <li key={item._id}>
                    <div className="space-y-2">
                      <ReviewItem item={item} />
                      <Button asChild variant="outline">
                        <Link
                          href={`/hr/leave/review/${encodeURIComponent(item._id)}`}
                        >
                          {t("openRecord")}
                        </Link>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <HrInlineError code={outcome.value.code} />
          )
        ) : null
      }
    </HrQueryState>
  );
}
function ReviewItem({ item }: { readonly item: QueueItem }) {
  const t = useTranslations("Hr.leave");
  const id = useId();
  const [reason, setReason] = useState("");
  const decide = useMutation(hrRefs.decideLeave);
  const write = useHrWrite(`leave-review:${item._id}`);
  useDraftGuard(
    reason !== "" && write.state.kind !== "SAVED",
    () => setReason(""),
    write.pending,
  );
  const decision = (value: "APPROVE" | "RETURN" | "CONFIRM_CANCEL" | "KEEP") =>
    void write.submit((requestId) =>
      decide({
        requestId,
        leaveRequestId: item._id,
        expectedVersion: item.version,
        decision: value,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    );
  return (
    <div className="space-y-2">
      <p className="font-semibold text-text">
        {item.employeeName} · {item.employeeCode}
      </p>
      <LeaveRequestCard
        request={item}
        actions={
          item.status === "PENDING" ||
          item.status === "CANCELLATION_REQUESTED" ? (
            <div className="space-y-3">
              <FormField id={id} label={t("decisionReason")}>
                {(field) => (
                  <Input
                    {...field}
                    value={reason}
                    disabled={write.locked}
                    maxLength={1000}
                    onChange={(event) => setReason(event.target.value)}
                  />
                )}
              </FormField>
              {!["ANNUAL", "PERSONAL", "TRAINING"].includes(item.type) ? (
                <p className="text-xs text-muted">{t("statutoryReview")}</p>
              ) : null}
              <div className="flex flex-wrap gap-3">
                {item.status === "CANCELLATION_REQUESTED" ? (
                  <>
                    <Button
                      disabled={write.locked}
                      onClick={() => decision("CONFIRM_CANCEL")}
                    >
                      {t("confirmCancel")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={write.locked || reason.trim().length < 3}
                      onClick={() => decision("KEEP")}
                    >
                      {t("keep")}
                    </Button>
                  </>
                ) : item.status === "PENDING" ? (
                  <>
                    <Button
                      disabled={write.locked}
                      onClick={() => decision("APPROVE")}
                    >
                      {t("approve")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        write.locked ||
                        reason.trim().length < 3 ||
                        !["ANNUAL", "PERSONAL", "TRAINING"].includes(item.type)
                      }
                      onClick={() => decision("RETURN")}
                    >
                      {t("return")}
                    </Button>
                  </>
                ) : null}
              </div>
              <WriteFeedback
                state={write.state}
                onRetry={() => void write.retry()}
              />
            </div>
          ) : null
        }
      />
    </div>
  );
}

export function HrLeaveReviewDetailScreen({
  requestId,
}: {
  readonly requestId: string;
}) {
  const t = useTranslations("Hr.leave");
  return (
    <>
      <PageHeader title={t("reviewTitle")} summary={t("reviewSummary")} />
      <HrGate code={HR_CODES.review}>
        <ReviewDetailContent requestId={requestId} />
      </HrGate>
    </>
  );
}
function ReviewDetailContent({ requestId }: { readonly requestId: string }) {
  const outcome = useQuery(hrRefs.leaveDetail, { leaveRequestId: requestId });
  return (
    <HrQueryState outcome={outcome}>
      {() =>
        outcome?.ok ? (
          outcome.value.ok ? (
            <div className="space-y-4">
              <ReviewItem
                item={{
                  ...outcome.value.request,
                  employeeName: outcome.value.employeeName,
                  employeeCode: outcome.value.employeeCode,
                }}
              />
              {outcome.value.canAdjust &&
              ["APPROVED", "CANCELLATION_REQUESTED"].includes(
                outcome.value.request.status,
              ) ? (
                <AdjustmentForm
                  key={requestId}
                  request={outcome.value.request}
                />
              ) : null}
            </div>
          ) : (
            <HrInlineError code={outcome.value.code} />
          )
        ) : null
      }
    </HrQueryState>
  );
}
function AdjustmentForm({ request }: { readonly request: LeaveRequest }) {
  const t = useTranslations("Hr.leave");
  const locale = useLocale();
  const id = useId();
  const adjust = useMutation(hrRefs.adjustLeave);
  const write = useHrWrite(`leave-adjust:${request._id}`);
  const [dates, setDates] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const reset = () => {
    setDates([]);
    setReason("");
  };
  useDraftGuard(dates.length > 0 || reason !== "", reset, write.pending);
  const finish = async () => {
    if (!dates.length || reason.trim().length < 3) return;
    const result = await write.submit((requestId) =>
      adjust({
        requestId,
        leaveRequestId: request._id,
        expectedVersion: request.version,
        restoreDates: [...dates],
        reason: reason.trim(),
      }),
    );
    if (result.kind === "SAVED") reset();
  };
  return (
    <Panel className="space-y-4">
      <SectionTitle>{t("adjust")}</SectionTitle>
      <p className="text-sm text-muted">{t("adjustHint")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void finish();
        }}
        className="space-y-4"
      >
        <fieldset disabled={write.locked} className="space-y-3">
          <legend className="mb-2 text-sm font-semibold">
            {t("restoreDates")}
          </legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {request.dates.map((date) => (
              <label
                key={date}
                className="flex min-h-touch items-center gap-3 text-sm"
              >
                <CheckboxControl
                  checked={dates.includes(date)}
                  onChange={(event) => {
                    if (write.state.kind === "SAVED") write.reset();
                    setDates((previous) =>
                      event.target.checked
                        ? [...previous, date]
                        : previous.filter((item) => item !== date),
                    );
                  }}
                />
                {formatBusinessDate(date, locale)}
              </label>
            ))}
          </div>
          <FormField id={id} label={t("decisionReason")} required>
            {(field) => (
              <Input
                {...field}
                value={reason}
                maxLength={1000}
                onChange={(event) => {
                  if (write.state.kind === "SAVED") write.reset();
                  setReason(event.target.value);
                }}
              />
            )}
          </FormField>
        </fieldset>
        <Button
          type="submit"
          disabled={
            write.locked || dates.length === 0 || reason.trim().length < 3
          }
        >
          {t("saveAdjustment")}
        </Button>
        <WriteFeedback
          state={write.state}
          onRetry={() =>
            void write.retry().then((result) => {
              if (result.kind === "SAVED") reset();
            })
          }
        />
      </form>
    </Panel>
  );
}
