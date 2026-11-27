"use client";

import { CalendarDays } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef } from "react";
import { DayPicker, type Matcher } from "react-day-picker";
import { isIsoDate } from "../../../convex/model/hr/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  type DialogCompletionHandle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/FormField";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";

type DateFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string | undefined;
  max?: string | undefined;
  invalid?: boolean | undefined;
  describedBy?: string | undefined;
  rangeStart?: string | undefined;
  rangeEnd?: string | undefined;
};

const dateValue = (value?: string) =>
  isIsoDate(value) ? new Date(value + "T12:00:00Z") : undefined;
const navButton =
  "inline-flex size-11 items-center justify-center rounded-md hover:bg-raised focus-ring aria-disabled:opacity-40";

export function FilterDateField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  invalid,
  describedBy,
  rangeStart,
  rangeEnd,
}: DateFieldProps) {
  const t = useTranslations("FilterCalendar");
  const locale = useLocale();
  const completion = useRef<DialogCompletionHandle>(null);
  const selected = dateValue(value);
  const earliest = dateValue(min),
    latest = dateValue(max);
  const from = dateValue(rangeStart),
    to = dateValue(rangeEnd);
  const disabled: Matcher[] = [];
  if (earliest) disabled.push({ before: earliest });
  if (latest) disabled.push({ after: latest });
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, {
      ...options,
      calendar: "gregory",
      timeZone: "UTC",
    }).format;
  const month = format({ month: "long", year: "numeric" });
  const title = t("open", { field: label });
  return (
    <FormField id={id} label={label}>
      {(field) => (
        <div className="flex min-w-0 items-center gap-1">
          <Input
            {...field}
            type="text"
            maxLength={10}
            placeholder={t("format")}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="min-w-0 flex-1 tabular-nums"
          />
          <Dialog completionRef={completion}>
            <DialogTrigger asChild>
              <IconButton label={title} variant="ghost">
                <CalendarDays aria-hidden="true" />
              </IconButton>
            </DialogTrigger>
            <DialogContent
              size="sm"
              className="max-w-sm gap-2"
              closeLabel={t("close")}
            >
              <DialogTitle className="pr-12">{label}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("hint")}
              </DialogDescription>
              <DayPicker
                mode="single"
                required
                autoFocus
                timeZone="UTC"
                lang={locale}
                selected={selected}
                {...(selected ? { defaultMonth: selected } : {})}
                {...(earliest ? { startMonth: earliest } : {})}
                {...(latest ? { endMonth: latest } : {})}
                disabled={disabled}
                modifiers={from && to ? { span: { from, to } } : {}}
                modifiersClassNames={{ span: "bg-accent-surface" }}
                onSelect={(day) =>
                  completion.current?.complete(() =>
                    onChange(day.toISOString().slice(0, 10)),
                  )
                }
                labels={{
                  labelDayButton: format({ dateStyle: "full" }),
                  labelWeekday: format({ weekday: "long" }),
                  labelGrid: month,
                  labelNav: () => t("navigate"),
                  labelPrevious: () => t("previous"),
                  labelNext: () => t("next"),
                }}
                formatters={{
                  formatCaption: month,
                  formatWeekdayName: format({ weekday: "short" }),
                }}
                classNames={{
                  root: "relative min-w-0 text-sm tabular-nums",
                  nav: "pointer-events-none absolute inset-x-0 top-0 flex justify-between [&>button]:pointer-events-auto",
                  button_next: navButton,
                  button_previous: navButton,
                  chevron: "size-4 fill-current",
                  month_caption:
                    "flex h-11 items-center justify-center px-11 font-semibold",
                  month_grid:
                    "w-full table-fixed border-separate border-spacing-0",
                  weekday: "py-2 text-xs font-medium text-muted",
                  day: "p-0 text-center",
                  day_button:
                    "min-h-10 w-full rounded-md hover:bg-raised focus-ring",
                  selected:
                    "[&>button]:bg-primary [&>button]:font-semibold [&>button]:text-primary-foreground",
                  today: "font-bold underline underline-offset-4",
                  disabled: "text-disabled",
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      )}
    </FormField>
  );
}
