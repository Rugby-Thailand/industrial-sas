export const OCCUPANCY_BANDS = Object.freeze([
  "EMPTY",
  "LIGHT",
  "BUSY",
  "FULL",
] as const);

export type OccupancyBand = (typeof OCCUPANCY_BANDS)[number];

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

export interface OccupancyCell {
  readonly locationId: string;
  readonly code: string;
  readonly locationType: string;
  readonly distinctBuckets: number;
  readonly band: OccupancyBand;

  readonly row: number;
  readonly column: number;
}

export interface OccupancyMap {
  readonly cells: readonly OccupancyCell[];
  readonly columns: number;
  readonly rows: number;

  readonly bandCounts: Readonly<Record<OccupancyBand, number>>;
}

export const DEFAULT_COLUMNS = 6;

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
