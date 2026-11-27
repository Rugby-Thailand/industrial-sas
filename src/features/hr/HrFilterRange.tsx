"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { addDays } from "./format";
import { monthRange } from "./selfService";
import { FilterDateField } from "@/components/system/FilterDateField";
import {
  inclusiveDayCount,
  isIsoDate,
} from "../../../convex/model/hr/calendar";

export interface FilterRange {
  readonly from: string;
  readonly to: string;
}

export function filterRangeIssue(
  range: FilterRange,
  max?: string,
): "invalidRange" | "reversedRange" | "futureRange" | "longRange" | undefined {
  const { from, to } = range;
  if (
    (!isIsoDate(from) && (max !== undefined || from !== "")) ||
    (!isIsoDate(to) && (max !== undefined || to !== ""))
  )
    return "invalidRange";
  if (from !== "" && to !== "" && from > to) return "reversedRange";
  if (max) {
    if (from > max || to > max) return "futureRange";
    if (inclusiveDayCount(from, to) > 31) return "longRange";
  }
  return undefined;
}

export function HrFilterRange({
  id,
  from,
  to,
  max,
  onChange,
  onPreset,
  fromLabel,
  toLabel,
}: FilterRange & {
  readonly id: string;
  readonly max?: string;
  readonly onChange: (range: FilterRange, changed: keyof FilterRange) => void;
  readonly onPreset?: (range: FilterRange) => void;
  readonly fromLabel?: string;
  readonly toLabel?: string;
}) {
  const t = useTranslations("Hr.range");
  const errors = useTranslations("Hr.filterControls");
  // The hint remains visible during partial input, while a complete
  // invalid value can show an actionable error.
  const incomplete = [from, to].some(
    (value) => value.length < 10 && (value !== "" || max !== undefined),
  );
  const issue = incomplete ? undefined : filterRangeIssue({ from, to }, max);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const messageId = issue ? `${hintId} ${errorId}` : hintId;
  const presets =
    max && onPreset
      ? [
          { label: errors("today"), range: { from: max, to: max } },
          {
            label: errors("last7Days"),
            range: { from: addDays(max, -6), to: max },
          },
          {
            label: errors("thisMonth"),
            range: monthRange(max.slice(0, 7), max),
          },
        ]
      : [];
  return (
    <fieldset className="grid w-full min-w-0 gap-x-3 gap-y-2 min-[26rem]:grid-cols-2 sm:w-auto">
      <legend className="sr-only">{t("legend")}</legend>
      {presets.length > 0 ? (
        <div className="flex flex-wrap gap-1 min-[26rem]:col-span-2">
          {presets.map(({ label, range }) =>
            range === null ? null : (
              <Button
                key={label}
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={range.from === from && range.to === to}
                onClick={() => onPreset?.(range)}
              >
                {label}
              </Button>
            ),
          )}
        </div>
      ) : null}
      <FilterDateField
        id={`${id}-from`}
        label={fromLabel ?? t("from")}
        value={from}
        max={max}
        invalid={issue !== undefined}
        describedBy={messageId}
        rangeStart={from}
        rangeEnd={to}
        onChange={(next) => onChange({ from: next, to }, "from")}
      />
      <FilterDateField
        id={`${id}-to`}
        label={toLabel ?? t("to")}
        value={to}
        max={max}
        invalid={issue !== undefined}
        describedBy={messageId}
        rangeStart={from}
        rangeEnd={to}
        onChange={(next) => onChange({ from, to: next }, "to")}
      />
      <p id={hintId} className="text-xs text-muted min-[26rem]:col-span-2">
        {errors(max === undefined ? "calendarHint" : "calendarRangeHint")}
      </p>
      {issue ? (
        <p
          id={errorId}
          role="status"
          className="text-xs text-danger min-[26rem]:col-span-2"
        >
          {errors(issue)}
        </p>
      ) : null}
    </fieldset>
  );
}
