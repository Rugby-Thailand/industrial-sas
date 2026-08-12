/**
 * How an inbound table renders the two values that are not plain text.
 *
 * Shared by every inbound table module, and deliberately free of translations:
 * the tables are split by domain so that a quality screen does not ship the
 * receiving catalogue, and a shared helper that named a namespace would rejoin
 * what that split separated.
 */
import type { ReactNode } from "react";

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

/**
 * The same, for a figure stored in an item's base unit.
 *
 * A purchase-order line carries three quantities in two units: what was ordered,
 * in the unit the order was written in, and what has been received and what is
 * outstanding, in the item's base unit. The base unit comes from the item
 * document rather than from the line, so it can be absent — a dangling item
 * reference — and an absent unit makes the figure unrenderable rather than bare.
 * `40.000 CASE` ordered against a bare `0` was read as zero *cases*; it is zero
 * eaches, and 480 of them are outstanding.
 */
export const withBaseUnit = (
  minorUnits: number,
  baseUom: string | undefined,
): string =>
  baseUom === undefined ? UNRENDERABLE : withUnit(minorUnits, baseUom);

/**
 * An identifier with no display name yet, rendered whole.
 *
 * It used to be abbreviated to its last ten characters behind an ellipsis —
 * `…m_resin_hd`. That discarded the half that tells two identifiers apart
 * (`prv_item_resin_hd` and `prv_loc_resin_hd` abbreviate to the same string),
 * and it did not even buy a narrower column: what survived was one unbroken
 * token that wrapped anyway.
 *
 * So the value is shown as it is. The cell does not wrap and the table scrolls
 * (`EntityTable`), which is this application's answer to a value wider than the
 * space for it; `title` puts the whole string one hover away when a column is
 * clipped mid-scroll.
 */
export const identifier = (value: string | undefined): ReactNode =>
  value === undefined || value.length === 0 ? (
    UNRENDERABLE
  ) : (
    <span className="whitespace-nowrap" title={value}>
      {value}
    </span>
  );
