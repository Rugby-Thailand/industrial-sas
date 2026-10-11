/**
 * HR display formatting. Instants are shown in the organization timezone the
 * server reports; business dates (`YYYY-MM-DD`) are calendar labels and are
 * formatted as UTC dates so the browser's zone can never shift their weekday.
 */

const intlLocale = (locale: string) => (locale === "th" ? "th-TH" : "en-GB");

export function formatTime(
  instant: number | undefined,
  locale: string,
  timeZone: string,
): string {
  if (instant === undefined) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(instant);
}

export function formatDateTime(
  instant: number | undefined,
  locale: string,
  timeZone: string,
): string {
  if (instant === undefined) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(instant);
}

/** Business date of an instant in the organization timezone, as `YYYY-MM-DD`. */
export function businessDateIn(instant: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function utcDate(date: string): Date | null {
  const match = DATE.exec(date);
  if (match === null) return null;
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
}

export function formatBusinessDate(
  date: string,
  locale: string,
  options: { readonly weekday?: boolean; readonly short?: boolean } = {},
): string {
  const value = utcDate(date);
  if (value === null) return date;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    ...(options.weekday ? { weekday: options.short ? "short" : "long" } : {}),
    day: "numeric",
    month: options.short ? "short" : "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

export function addDays(date: string, delta: number): string {
  const value = utcDate(date);
  if (value === null) return date;
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}

export function weekdayName(isoWeekday: number, locale: string): string {
  // 2024-01-01 was a Monday.
  const value = new Date(Date.UTC(2024, 0, isoWeekday));
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "short",
    timeZone: "UTC",
  }).format(value);
}

export const splitMinutes = (minutes: number) => ({
  hours: Math.floor(Math.max(0, minutes) / 60),
  minutes: Math.max(0, minutes) % 60,
});

/** `HH:MM` → minutes after midnight, or null. */
export function parseTimeInput(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes after midnight in `timeZone` for an instant, with its date. */
export function localTimeOf(
  instant: number,
  timeZone: string,
): { readonly date: string; readonly value: string } {
  return {
    date: businessDateIn(instant, timeZone),
    value: formatTime(instant, "en", timeZone),
  };
}

function narrowWeekday(isoWeekday: number, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: locale === "th" ? "narrow" : "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2024, 0, isoWeekday)));
}

/**
 * Compact working-day summary: `Mon–Fri` for a consecutive run, otherwise
 * the short names. `everyDay` is used when all seven days are worked.
 */
export function workDaysLabel(
  days: readonly number[],
  locale: string,
  everyDay: string,
): string {
  const sorted = [...new Set(days.map((day) => (day === 0 ? 7 : day)))].sort(
    (a, b) => a - b,
  );
  if (sorted.length === 7) return everyDay;
  if (sorted.length === 0) return "";
  const consecutive = sorted.every(
    (day, index) => index === 0 || day === sorted[index - 1]! + 1,
  );
  if (consecutive && sorted.length > 2)
    return `${narrowWeekday(sorted[0]!, locale)}–${narrowWeekday(sorted.at(-1)!, locale)}`;
  return sorted.map((day) => narrowWeekday(day, locale)).join(" ");
}
