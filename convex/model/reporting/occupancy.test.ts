/**
 * Unit tier — occupancy banding and layout.
 *
 * The map exists so a supervisor can see a full aisle without reading a table.
 * That makes stable ordering and a legible empty/unknown distinction functional
 * requirements rather than presentation ones.
 */
import { describe, expect, it } from "vitest";

import { bandFor, layOutOccupancy, OCCUPANCY_BANDS } from "./occupancy";

describe("bandFor", () => {
  it("calls nothing EMPTY, and only nothing", () => {
    expect(bandFor(0)).toBe("EMPTY");
    expect(bandFor(1)).toBe("LIGHT");
  });

  it("rises through the bands", () => {
    expect(bandFor(3)).toBe("LIGHT");
    expect(bandFor(4)).toBe("BUSY");
    expect(bandFor(7)).toBe("BUSY");
    expect(bandFor(8)).toBe("FULL");
    expect(bandFor(80)).toBe("FULL");
  });

  it("does not invent a band from a nonsense count", () => {
    expect(bandFor(-1)).toBe("EMPTY");
    expect(bandFor(Number.NaN)).toBe("EMPTY");
    expect(bandFor(1.5)).toBe("EMPTY");
  });

  it("orders the bands from least to most", () => {
    expect([...OCCUPANCY_BANDS]).toEqual(["EMPTY", "LIGHT", "BUSY", "FULL"]);
  });
});

describe("layOutOccupancy", () => {
  const location = (code: string, distinctBuckets: number) => ({
    locationId: `loc_${code}`,
    code,
    locationType: "RACK_BIN",
    distinctBuckets,
  });

  it("keeps the caller's order, so a cell does not move between refreshes", () => {
    /*
     * The map's whole use is noticing that a *particular* aisle is full. A grid
     * whose cells shuffled on every poll could not be used for that at all.
     */
    const map = layOutOccupancy(
      [location("A-01", 0), location("A-02", 5), location("B-01", 9)],
      2,
    );

    expect(map.cells.map((cell) => cell.code)).toEqual([
      "A-01",
      "A-02",
      "B-01",
    ]);
    expect(map.cells.map((cell) => [cell.row, cell.column])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
  });

  it("reports the grid shape, including a partly filled last row", () => {
    const map = layOutOccupancy([location("A", 1), location("B", 1)], 6);
    expect({ columns: map.columns, rows: map.rows }).toEqual({
      columns: 6,
      rows: 1,
    });
  });

  it("counts each band for the legend", () => {
    const map = layOutOccupancy([
      location("A", 0),
      location("B", 2),
      location("C", 5),
      location("D", 12),
    ]);

    expect(map.bandCounts).toEqual({ EMPTY: 1, LIGHT: 1, BUSY: 1, FULL: 1 });
  });

  it("survives an empty warehouse without dividing by zero", () => {
    const map = layOutOccupancy([]);
    expect({ cells: map.cells, rows: map.rows }).toEqual({
      cells: [],
      rows: 0,
    });
  });

  it("falls back to the default width rather than laying out zero columns", () => {
    const map = layOutOccupancy([location("A", 1)], 0);
    expect(map.columns).toBeGreaterThan(0);
  });
});
