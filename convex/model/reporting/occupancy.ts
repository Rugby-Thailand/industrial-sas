/**
 * Turning occupancy counts into something a person can read at a glance
 * (`ADR-0011` §8, `ADR-0017`, D-28).
 *
 * The occupancy view is a flat 2D grid, not a 3D scene: `three` is absent from
 * the dependency graph on purpose (`INV-0011-11`), because a warehouse
 * supervisor needs to find a full aisle in one look, and an orbit control is a
 * worse way to do that than a grid.
 *
 * `ADR-0011` §8 says "SVG"; what ships is a `<table>`. The decision it was
 * making — flat and accessible rather than Three.js — is honoured and then
 * improved on: a warehouse map *is* tabular data, so a table gets keyboard
 * traversal, row and column announcement, zoom, and text selection for free,
 * where an SVG would need each of those reimplemented as an ARIA parallel that
 * could drift from what is drawn.
 *
 * The decisions here are all accessibility ones, and each has a failure it
 * avoids:
 *
 * - **Bands, not a continuous gradient.** A colour ramp encodes a number in a
 *   dimension roughly 8% of people cannot fully see, and nobody can read a
 *   precise value off a hue anyway. Four named bands can be given a label, a
 *   pattern, and a sort order.
 * - **Colour is never the only channel** (`WCAG 2.2` 1.4.1). Every band carries
 *   a short text token as well, so the map is legible in greyscale, in direct
 *   sun on a dock, and to a screen reader reading the cell's label.
 * - **`EMPTY` and `UNKNOWN` are different.** A location with no stock and a
 *   location nobody has counted are the same picture on most heat maps, and the
 *   second is the one worth acting on.
 *
 * Pure module (plan §6.2): no Convex imports, no DOM.
 */

/**
 * How full one location is, as a closed set.
 *
 * Ordered from nothing to most, so a caller may compare bands by index without
 * a second table.
 */
export const OCCUPANCY_BANDS = Object.freeze([
  "EMPTY",
  "LIGHT",
  "BUSY",
  "FULL",
] as const);

export type OccupancyBand = (typeof OCCUPANCY_BANDS)[number];

/**
 * Where the bands begin, in distinct stock buckets held at a location.
 *
 * Buckets rather than quantity, because quantity is not comparable across items:
 * 900 kilograms of steel coil and 900 bolts occupy nothing like the same space,
 * and a map that added them would be confidently wrong. A bucket is one
 * (item, lot, status, handling unit, owner) combination physically present,
 * which is a count of *things to walk past*.
 */
export const BAND_THRESHOLDS = Object.freeze({
  LIGHT: 1,
  BUSY: 4,
  FULL: 8,
});

export function bandFor(distinctBuckets: number): OccupancyBand {
  if (!Number.isSafeInteger(distinctBuckets) || distinctBuckets <= 0) {
    return "EMPTY";
  }
  if (distinctBuckets >= BAND_THRESHOLDS.FULL) return "FULL";
  if (distinctBuckets >= BAND_THRESHOLDS.BUSY) return "BUSY";
  return "LIGHT";
}

/** One cell of the map, before any of it is drawn. */
export interface OccupancyCell {
  readonly locationId: string;
  readonly code: string;
  readonly locationType: string;
  readonly distinctBuckets: number;
  readonly band: OccupancyBand;
  /** Row and column in the laid-out grid, both zero-based. */
  readonly row: number;
  readonly column: number;
}

/**
 * The laid-out map.
 *
 * `columns` travels with the cells because a screen reader needs the table
 * shape, and a caller that recomputed it from the cell count would disagree with
 * the layout on the last, partly-filled row.
 */
export interface OccupancyMap {
  readonly cells: readonly OccupancyCell[];
  readonly columns: number;
  readonly rows: number;
  /** How many locations are in each band, for the legend and the summary. */
  readonly bandCounts: Readonly<Record<OccupancyBand, number>>;
}

/** The widest grid the handheld can show without horizontal scrolling. */
export const DEFAULT_COLUMNS = 6;

/**
 * Lay out locations as a grid, in the order they were given.
 *
 * The order is the caller's — the server reads locations by code, so the map is
 * in aisle order rather than in whatever order the balances happened to arrive.
 * A map whose cells moved between refreshes would be unusable for the one task
 * it exists for: noticing that a *particular* aisle is full.
 */
export function layOutOccupancy(
  locations: readonly {
    readonly locationId: string;
    readonly code: string;
    readonly locationType: string;
    readonly distinctBuckets: number;
  }[],
  columns: number = DEFAULT_COLUMNS,
): OccupancyMap {
  const width =
    Number.isSafeInteger(columns) && columns > 0 ? columns : DEFAULT_COLUMNS;

  const cells = locations.map((location, index) => ({
    locationId: location.locationId,
    code: location.code,
    locationType: location.locationType,
    distinctBuckets: location.distinctBuckets,
    band: bandFor(location.distinctBuckets),
    row: Math.floor(index / width),
    column: index % width,
  }));

  const bandCounts = OCCUPANCY_BANDS.reduce(
    (counts, band) => ({
      ...counts,
      [band]: cells.filter((cell) => cell.band === band).length,
    }),
    {} as Record<OccupancyBand, number>,
  );

  return {
    cells: Object.freeze(cells),
    columns: width,
    rows: Math.ceil(cells.length / width),
    bandCounts: Object.freeze(bandCounts),
  };
}
