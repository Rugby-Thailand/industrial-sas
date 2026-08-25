import {
  formatBusinessDate,
  parseBusinessDate,
  type DisplayCalendar,
} from "../../convex/model/time/businessDate";
import { formatQuantity, makeQuantity } from "../../convex/model/uom/quantity";

import { DEFAULT_TIME_ZONE, type AppLocale } from "../i18n/routing";

export const UNRENDERABLE = "——";

export function formatMinorUnits(minorUnits: number, uom: string): string {
  const quantity = makeQuantity(minorUnits, uom);
  if (!quantity.ok) return UNRENDERABLE;
  const rendered = formatQuantity(quantity.value);
  return rendered.ok ? rendered.value : UNRENDERABLE;
}

export function formatBusinessDateIso(
  iso: string,
  calendar: DisplayCalendar = "GREGORIAN",
): string {
  const parsed = parseBusinessDate(iso);
  if (!parsed.ok) return UNRENDERABLE;
  const rendered = formatBusinessDate(parsed.value, calendar);
  return rendered.ok ? rendered.value : UNRENDERABLE;
}

export function formatInstant(
  epochMilliseconds: number,
  locale: AppLocale,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  if (!Number.isFinite(epochMilliseconds)) return UNRENDERABLE;
  try {
    return new Intl.DateTimeFormat(`${locale}-u-ca-gregory`, {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(epochMilliseconds));
  } catch {
    return UNRENDERABLE;
  }
}

export function formatInstantDate(
  epochMilliseconds: number,
  locale: AppLocale,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  if (!Number.isFinite(epochMilliseconds)) return UNRENDERABLE;
  try {
    return new Intl.DateTimeFormat(`${locale}-u-ca-gregory`, {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(epochMilliseconds));
  } catch {
    return UNRENDERABLE;
  }
}

export function formatCount(value: number, locale: AppLocale): string {
  if (!Number.isFinite(value)) return UNRENDERABLE;
  return new Intl.NumberFormat(`${locale}-u-nu-latn`).format(value);
}

export function abbreviateIdentifier(value: string, keep = 6): string {
  if (keep <= 0) return UNRENDERABLE;
  return value.length <= keep * 2 + 1
    ? value
    : `${value.slice(0, keep)}…${value.slice(-keep)}`;
}
