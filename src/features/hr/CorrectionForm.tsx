"use client";

import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type Ref } from "react";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/FormField";
import { Panel } from "@/components/ui/Panel";
import { useDraftGuard } from "@/components/providers/draftGuard";
import { hrRefs } from "@/lib/convex/hrApi";

import type { DayDetail } from "./DayDetailView";
import { SectionTitle, WriteFeedback } from "./HrShared";
import {
  EMPTY_SIDE,
  TimeSideField,
  sideFromInstant,
  toLocalTimeInput,
  type TimeSide,
} from "./TimeSideField";
import { useHrWrite } from "./useHrWrite";

export const REASON_MAX = 500;

export function ReasonField({
  label,
  value,
  onChange,
  error,
  required = true,
  disabled,
  placeholder,
  inputRef,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string | undefined;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  /** Lets a field revealed on demand take focus. */
  readonly inputRef?: Ref<HTMLTextAreaElement>;
}) {
  const t = useTranslations("Hr.form");
  const id = useId();
  return (
    <FormField
      id={id}
      label={label}
      required={required}
      hint={t("reasonCount", { length: value.length, max: REASON_MAX })}
      {...(error === undefined ? {} : { error })}
    >
      {(field) => (
        <textarea
          {...field}
          ref={inputRef}
          value={value}
          maxLength={REASON_MAX}
          rows={3}
          disabled={disabled}
          {...(placeholder === undefined ? {} : { placeholder })}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-24 w-full rounded-md border border-input bg-surface px-3 py-2 text-base text-text outline-none placeholder:text-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:bg-disabled-surface aria-invalid:border-destructive md:text-sm"
        />
      )}
    </FormField>
  );
}

/**
 * Employee correction request for one business date. The proposal never
 * edits the original events; a supervisor or HR certifies it later.
 */
export function CorrectionForm({
  detail,
  timezone,
  returnedId,
}: {
  readonly detail: DayDetail;
  readonly timezone: string;
  /** Resubmit this returned request instead of opening a new one. */
  readonly returnedId?: string | undefined;
}) {
  const t = useTranslations("Hr.correction");
  const form = useTranslations("Hr.form");
  const submitCorrection = useMutation(hrRefs.submitCorrection);
  const [initial] = useState(() => ({
    start:
      detail.originalStartAt === undefined
        ? EMPTY_SIDE
        : sideFromInstant(
            detail.originalStartAt,
            detail.businessDate,
            timezone,
          ),
    end: sideFromInstant(detail.originalEndAt, detail.businessDate, timezone),
  }));
  const [start, setStart] = useState<TimeSide>(initial.start);
  const [end, setEnd] = useState<TimeSide>(initial.end);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ time?: string; reason?: string }>({});
  const write = useHrWrite(
    `correction:${detail.employeeId}:${detail.businessDate}:${returnedId ?? "new"}`,
  );
  // Entered, unsent details survive search and navigation unless discarded.
  useDraftGuard(
    write.state.kind !== "SAVED" &&
      (reason.trim() !== "" ||
        JSON.stringify([start, end]) !==
          JSON.stringify([initial.start, initial.end])),
    () => {
      setStart(initial.start);
      setEnd(initial.end);
      setReason("");
      setErrors({});
    },
    write.pending,
  );

  const send = async () => {
    const startInput = toLocalTimeInput(start);
    const endInput = toLocalTimeInput(end);
    const next: { time?: string; reason?: string } = {};
    if (startInput === null || endInput === null)
      next.time = form("timeInvalid");
    else if (startInput === undefined && endInput === undefined)
      next.time = t("timeRequired");
    if (reason.trim().length < 3) next.reason = form("reasonRequired");
    setErrors(next);
    if (next.time !== undefined || next.reason !== undefined) return;
    await write.submit((requestId) =>
      submitCorrection({
        requestId,
        businessDate: detail.businessDate,
        ...(startInput ? { start: startInput } : {}),
        ...(endInput ? { end: endInput } : {}),
        reason: reason.trim(),
        ...(returnedId === undefined ? {} : { correctionId: returnedId }),
      }),
    );
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  if (write.state.kind === "SAVED")
    return (
      <Panel role="status" aria-live="polite" data-testid="hr-correction-saved">
        <p className="text-sm font-semibold text-success">{t("submitted")}</p>
        <p className="mt-1 text-sm text-muted">{t("submittedHint")}</p>
      </Panel>
    );

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby="hr-correction-title"
      noValidate
      className="rounded-xl border border-border bg-surface p-4"
    >
      <SectionTitle>
        <span id="hr-correction-title">
          {t(returnedId === undefined ? "title" : "resubmitTitle")}
        </span>
      </SectionTitle>
      <p className="mb-4 text-sm text-muted">{t("intro")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TimeSideField
          label={t("start")}
          hint={t("startHint")}
          side={start}
          onChange={setStart}
          disabled={write.locked}
        />
        <TimeSideField
          label={t("end")}
          hint={t("endHint")}
          side={end}
          onChange={setEnd}
          disabled={write.locked}
          error={errors.time}
        />
      </div>
      <div className="mt-4">
        <ReasonField
          label={t("reason")}
          value={reason}
          onChange={setReason}
          error={errors.reason}
          disabled={write.locked}
        />
      </div>
      <div className="mt-4 space-y-3">
        <Button
          type="submit"
          disabled={write.locked}
          data-testid="hr-correction-submit"
        >
          {write.pending ? form("submitting") : t("submit")}
        </Button>
        <WriteFeedback state={write.state} onRetry={() => void write.retry()} />
      </div>
    </form>
  );
}
