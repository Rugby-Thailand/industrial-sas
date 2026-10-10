"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { CheckboxControl } from "@/components/ui/CheckboxControl";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";

import { addDays, businessDateIn, formatTime, parseTimeInput } from "./format";

export interface TimeSide {
  readonly value: string;
  readonly nextDay: boolean;
}

export const EMPTY_SIDE: TimeSide = { value: "", nextDay: false };

/** A local time for a business date, as the server expects it. */
export function toLocalTimeInput(
  side: TimeSide,
): { minute: number; nextDay: boolean } | undefined | null {
  if (side.value === "") return undefined;
  const minute = parseTimeInput(side.value);
  return minute === null ? null : { minute, nextDay: side.nextDay };
}

/** Prefill a side from a saved instant relative to its business date. */
export function sideFromInstant(
  instant: number | undefined,
  businessDate: string,
  timeZone: string,
): TimeSide {
  if (instant === undefined) return EMPTY_SIDE;
  return {
    value: formatTime(instant, "en", timeZone),
    nextDay: businessDateIn(instant, timeZone) === addDays(businessDate, 1),
  };
}

export function TimeSideField({
  label,
  hint,
  side,
  onChange,
  error,
  disabled,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly side: TimeSide;
  readonly onChange: (side: TimeSide) => void;
  readonly error?: string | undefined;
  readonly disabled?: boolean;
}) {
  const t = useTranslations("Hr.form");
  const id = useId();
  return (
    <div className="space-y-2">
      <FormField
        id={id}
        label={label}
        {...(hint === undefined ? {} : { hint })}
        {...(error === undefined ? {} : { error })}
      >
        {(field) => (
          <Input
            {...field}
            type="time"
            step={60}
            value={side.value}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...side, value: event.target.value })
            }
          />
        )}
      </FormField>
      <label className="flex min-h-touch items-center gap-2 text-sm text-text">
        <CheckboxControl
          checked={side.nextDay}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...side, nextDay: event.target.checked })
          }
        />
        {t("nextDay")}
      </label>
    </div>
  );
}
