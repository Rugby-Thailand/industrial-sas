/**
 * The one formatting layer (`INV-0010-10`, `ADR-0010` §9).
 *
 * Every quantity, business date, and instant that reaches a screen passes
 * through this module, and this module delegates the arithmetic to the pure
 * domain kernels under `convex/model/**` rather than reimplementing it. That
 * direction of dependency is the point: the kernel may not import Convex or
 * React (plan §6.2, enforced by `pnpm verify:tenant-boundary`), but nothing stops
 * a screen from importing the kernel, and a second implementation of "how many
 * decimal places does a quantity have" is how two screens come to disagree about
 * one number.
 *
 * ### What is deliberately not `Intl`
 *
 * Quantities. `formatQuantity` renders the stored digits with an ASCII decimal
 * point and no grouping separators, because a locale-aware number formatter is
 * how `1.005` becomes `1,005` on a Thai screen. Instants *are* formatted with
 * `Intl.DateTimeFormat`, with an explicit timezone and the Gregorian calendar
 * pinned: the Thai locale's default calendar in `Intl` is Buddhist, and
 * `ADR-0010` §7 makes Buddhist Era a deliberate, per-document display choice —
 * never something a formatter picks up by itself.
 *
 * ### Why every function returns a string and never throws
 *
 * The values here come off the wire. A `minorUnits` that is `NaN` and a
 * `businessDate` that is `"2026-13-45"` are both reachable from a malformed
 * document, and neither should blank a warehouse screen. Each formatter answers
 * a fallback marker instead, which is visible, greppable, and cannot be mistaken
 * for a real figure.
 */
import {
  formatBusinessDate,
  parseBusinessDate,
  type DisplayCalendar,
} from "../../convex/model/time/businessDate";
import { formatQuantity, makeQuantity } from "../../convex/model/uom/quantity";

import { DEFAULT_TIME_ZONE, type AppLocale } from "../i18n/routing";

/**
 * What a screen shows in place of a value it cannot render.
 *
 * An em-dash pair rather than an empty cell or `"0"`: an empty cell reads as
 * "nothing here" and a zero reads as a balance. This reads as "unrenderable",
 * and `INV-0010-07` is satisfied because it is text rather than a colour.
 */
export const UNRENDERABLE = "——";

/**
 * A quantity in an item's base UOM, as stored: integer thousandths.
 *
 * Trailing zeros are kept. `12.000` and `12` are the same number and different
 * evidence: the stored value has three decimal places, and trimming them on a
 * balance screen makes a count look like a rounded measure.
 */
export function formatMinorUnits(minorUnits: number, uom: string): string {
  const quantity = makeQuantity(minorUnits, uom);
  if (!quantity.ok) return UNRENDERABLE;
  const rendered = formatQuantity(quantity.value);
  return rendered.ok ? rendered.value : UNRENDERABLE;
}

/**
 * A stored `YYYY-MM-DD` business date, rendered in the requested calendar.
 *
 * The calendar defaults to Gregorian and is never inferred from the locale.
 * Buddhist Era is display-only (`INV-0010-04`) and which documents use it is an
 * open tenant question (`RG-043`), so a caller has to ask for it.
 */
export function formatBusinessDateIso(
  iso: string,
  calendar: DisplayCalendar = "GREGORIAN",
): string {
  const parsed = parseBusinessDate(iso);
  if (!parsed.ok) return UNRENDERABLE;
  const rendered = formatBusinessDate(parsed.value, calendar);
  return rendered.ok ? rendered.value : UNRENDERABLE;
}

/**
 * A UTC instant, rendered in the organization timezone.
 *
 * `calendar: "gregory"` is explicit because `Intl` resolves `th-TH` to the
 * Buddhist calendar by default, which would put a BE year on every history row
 * without anyone asking for one. `hourCycle: "h23"` is explicit because the same
 * locale otherwise renders a 12-hour clock, and a warehouse timestamp that omits
 * AM/PM by wrapping is worse than one that does not need it.
 */
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
    // An unsupported timezone in a runtime's ICU data throws rather than
    // falling back. A blank timestamp column is a worse answer than a marker.
    return UNRENDERABLE;
  }
}

/**
 * A count, for captions such as "12 balance rows".
 *
 * Grouping separators are correct here and wrong for quantities: nobody scans a
 * caption into a form field, and an unseparated five-digit row count is harder
 * to read at a glance in warehouse lighting.
 */
export function formatCount(value: number, locale: AppLocale): string {
  if (!Number.isFinite(value)) return UNRENDERABLE;
  return new Intl.NumberFormat(`${locale}-u-nu-latn`).format(value);
}

/**
 * Shorten an opaque identifier for display, keeping both ends.
 *
 * For a value whose *middle* is what varies — a document ID, where the digits
 * are effectively random. Truncating one end makes two different IDs look
 * identical; keeping both ends keeps them distinguishable. The full value stays
 * available as the cell's `title` and in the DOM, so it is still copyable and
 * still findable by tests.
 *
 * Not for a value with a structure. A bucket key's ends are the organization
 * prefix and the stock status — the two parts every row of one screen shares —
 * so abbreviating one collapsed several buckets to the same text. That cell
 * decodes the key instead (`@/lib/inventory/bucketIdentity`), and this helper is
 * left to the identifiers it is honest about.
 */
export function abbreviateIdentifier(value: string, keep = 6): string {
  if (keep <= 0) return UNRENDERABLE;
  return value.length <= keep * 2 + 1
    ? value
    : `${value.slice(0, keep)}…${value.slice(-keep)}`;
}
