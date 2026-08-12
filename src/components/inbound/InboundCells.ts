/**
 * How an inbound table renders the two values that are not plain text.
 *
 * Shared by every inbound table module, and deliberately free of translations:
 * the tables are split by domain so that a quality screen does not ship the
 * receiving catalogue, and a shared helper that named a namespace would rejoin
 * what that split separated.
 */
import { formatMinorUnits, UNRENDERABLE } from "@/lib/formatters";

/**
 * A quantity and the unit it is counted in, together.
 *
 * `formatMinorUnits` renders the digits and nothing else — deliberately, because
 * the ledger's formatter must not invent a unit. On a receiving screen the unit
 * is not optional: `180.000` is unreadable and reads as a count of pieces when
 * it is thousandths of a kilogram (`ADR-0004`).
 */
export const withUnit = (minorUnits: number, uom: string): string =>
  `${formatMinorUnits(minorUnits, uom)} ${uom}`;

/** An identifier with no display name yet. Shown short and monospaced. */
export const shortId = (value: string | undefined): string =>
  value === undefined || value.length === 0
    ? UNRENDERABLE
    : value.length <= 12
      ? value
      : `…${value.slice(-10)}`;
