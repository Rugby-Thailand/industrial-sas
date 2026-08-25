import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CSV_BOM,
  CSV_LINE_ENDING,
  csvField,
  csvHeader,
  csvRows,
  utf8Bytes,
} from "../../convex/model/reporting/csv";
import {
  applyRollupDelta,
  compareRollup,
  subjectKeyFor,
  summarizeRollups,
} from "../../convex/model/reporting/rollup";

function parseCsv(text: string): string[][] {
  const body = text.startsWith(CSV_BOM) ? text.slice(CSV_BOM.length) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];

    if (quoted) {
      if (character === '"') {
        if (body[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field === "") {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\r" && body[index + 1] === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      index += 1;
    } else {
      field += character ?? "";
    }
  }

  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

const FORMULA_STARTERS = ["=", "+", "-", "@", "\t", "\r"];

const guarded = (value: string): string =>
  FORMULA_STARTERS.some((starter) => value.startsWith(starter))
    ? `'${value}`
    : value;

const cellText = fc
  .array(
    fc.constantFrom(
      ...`abcXYZ0189 ,"'=+-@\t\r\n;|`.split(""),
      ...["ก", "ข", "เหล็กม้วน", "สลักเกลียว"],
    ),
    { maxLength: 12 },
  )
  .map((parts) => parts.join(""));

describe("a rendered export round-trips", () => {
  it("recovers every field exactly, whatever the tenant typed", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(cellText, { minLength: 1, maxLength: 4 }), {
          minLength: 1,
          maxLength: 6,
        }),
        (rows) => {
          const width = rows[0]?.length ?? 1;
          const rectangular = rows.map((row) =>
            Array.from({ length: width }, (_, column) => row[column] ?? ""),
          );

          const parsed = parseCsv(csvRows(rectangular));

          expect(parsed).toEqual(
            rectangular.map((row) => row.map((value) => guarded(value))),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("never lets a field start a formula once the guard is stripped", () => {
    fc.assert(
      fc.property(cellText, (value) => {
        const rendered = csvField(value);
        const inner = rendered.startsWith('"')
          ? rendered.slice(1, -1).replaceAll('""', '"')
          : rendered;

        const dangerous = ["=", "+", "-", "@", "\t", "\r"].some((starter) =>
          value.startsWith(starter),
        );
        expect(dangerous ? inner.startsWith("'") : true).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("carries the byte-order mark exactly once, on the header", () => {
    fc.assert(
      fc.property(
        fc.array(cellText, { minLength: 1, maxLength: 4 }),
        fc.array(fc.array(cellText, { minLength: 1, maxLength: 4 }), {
          maxLength: 4,
        }),
        (columns, rows) => {
          const document = csvHeader(columns) + csvRows(rows);
          expect(document.split(CSV_BOM).length - 1).toBe(1);
          expect(document.startsWith(CSV_BOM)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("counts bytes at least as large as characters, for any text", () => {
    fc.assert(
      fc.property(cellText, (value) => {
        expect(utf8Bytes(value)).toBeGreaterThanOrEqual(value.length);
      }),
      { numRuns: 200 },
    );
  });
});

describe("a maintained counter", () => {
  const deltas = fc.array(fc.integer({ min: -5, max: 5 }), { maxLength: 40 });

  it("never reads negative, whatever sequence it is given", () => {
    fc.assert(
      fc.property(deltas, (sequence) => {
        const final = sequence.reduce(
          (current, delta) => applyRollupDelta(current, delta).next,
          0,
        );
        expect(final).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 300 },
    );
  });

  it("reports an underflow exactly when the honest total would be negative", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 50 }),
        fc.integer({ min: -60, max: 60 }),
        (current, delta) => {
          const result = applyRollupDelta(current, delta);
          expect(result.underflow).toBe(current + delta < 0);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("matches an unclamped total whenever no step underflowed", () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 5 }), { maxLength: 30 }), (adds) => {
        const clamped = adds.reduce(
          (current, delta) => applyRollupDelta(current, delta).next,
          0,
        );
        expect(clamped).toBe(adds.reduce((sum, value) => sum + value, 0));
      }),
      { numRuns: 200 },
    );
  });

  it("stores each metric under exactly one subject key", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "RECEIPTS_OPENED" as const,
          "QC_PENDING" as const,
          "LOCATION_OCCUPANCY" as const,
        ),
        fc.option(fc.stringMatching(/^[a-z0-9]{1,8}$/), { nil: undefined }),
        (metric, subject) => {
          const first = subjectKeyFor(metric, subject);
          const second = subjectKeyFor(metric, subject);
          expect(first).toEqual(second);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("calls a verification balanced exactly when nothing drifted", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat({ max: 20 }), fc.nat({ max: 20 })), {
          maxLength: 12,
        }),
        (pairs) => {
          const summary = summarizeRollups(
            pairs.map(([stored, derived], index) =>
              compareRollup("RECEIPTS_OPENED", `s${index}`, stored, derived),
            ),
          );
          expect(summary.balanced).toBe(
            pairs.every(([stored, derived]) => stored === derived),
          );
          expect(summary.checked).toBe(pairs.length);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("negative controls", () => {
  it("the round-trip property fails when quoting is dropped", () => {
    const naive = (values: readonly string[]) =>
      `${values.join(",")}${CSV_LINE_ENDING}`;

    const outcome = fc.check(
      fc.property(
        fc.array(cellText, { minLength: 2, maxLength: 3 }),
        (values) => {
          expect(parseCsv(naive(values))[0]).toEqual(values.map(guarded));
        },
      ),
      { numRuns: 300 },
    );

    expect(outcome.failed).toBe(true);
  });

  it("the never-negative property fails when the clamp is removed", () => {
    const unclamped = (current: number, delta: number) => current + delta;

    const outcome = fc.check(
      fc.property(fc.array(fc.integer({ min: -5, max: 5 })), (sequence) => {
        const final = sequence.reduce(
          (current, delta) => unclamped(current, delta),
          0,
        );
        expect(final).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 300 },
    );

    expect(outcome.failed).toBe(true);
  });
});
