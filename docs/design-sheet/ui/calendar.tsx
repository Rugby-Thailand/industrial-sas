// Structure adapted from the shadcn/ui radix-nova Calendar (MIT), retrieved
// 2026-10-14, on react-day-picker 9.14.0. Sheet-owned: Tailwind class
// contracts and react-day-picker's default stylesheet are not used; the
// `rdp-*` classes and day data attributes are styled by controls.css.
//
// Thai uses react-day-picker's Buddhist calendar so captions, grid names and
// day names all show the Buddhist year with Latin digits. Values stay civil
// Gregorian dates; only presentation changes.
"use client";

import { useEffect, useRef } from "react";
import {
  DayPicker,
  type ChevronProps,
  type DayButtonProps,
  type Matcher,
} from "react-day-picker";
import { DayPicker as BuddhistDayPicker, th } from "react-day-picker/buddhist";
import { enGB } from "react-day-picker/locale";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
} from "lucide-react";

const pad = (value: number) => String(value).padStart(2, "0");
export const civilValue = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function Chevron({ orientation, className }: ChevronProps) {
  const Icon =
    orientation === "left"
      ? ChevronLeftIcon
      : orientation === "right"
        ? ChevronRightIcon
        : ChevronDownIcon;
  return <Icon aria-hidden="true" className={className} />;
}

function DayButton({ day, modifiers, ...props }: DayButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);
  // A stable Gregorian civil date for tests and handoff. react-day-picker's
  // own td[data-day] follows the display calendar (2569-… in Thai).
  return <button ref={ref} data-civil-date={civilValue(day.date)} {...props} />;
}

// Single-date selection is always `required`: confirming the selected day
// keeps it. Clearing belongs to an explicit Clear action owned by the caller.
type CalendarProps = {
  thai: boolean;
  selected: Date | undefined;
  onSelect: (date: Date) => void;
  defaultMonth: Date;
  today: Date;
  disabled?: Matcher[];
  startMonth?: Date;
  endMonth?: Date;
  autoFocus?: boolean;
};

export function Calendar({ thai, ...props }: CalendarProps) {
  const shared = {
    ...props,
    mode: "single" as const,
    required: true as const,
    className: "sheet-calendar",
    showOutsideDays: true,
    weekStartsOn: 1 as const,
    numerals: "latn" as const,
    components: { Chevron, DayButton },
  };
  return thai ? (
    <BuddhistDayPicker {...shared} locale={th} />
  ) : (
    <DayPicker {...shared} locale={enGB} />
  );
}
