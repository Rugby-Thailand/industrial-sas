import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  advance,
  currentCursor,
  initialCursorState,
  isFirstPage,
  pageNumber,
  retreat,
  type CursorState,
} from "../../src/lib/convex/pagination";
import type { LedgerPage } from "../../src/lib/convex/ledgerApi";
import { previewPage } from "@tests/fixtures/data/ledger";

/**
 * Paging is a fold over a list, and folds are where off-by-one defects live.
 *
 * The properties below are the ones a warehouse actually depends on: an
 * operator paging through a warehouse's balances must see every row, must see
 * none of them twice, and must be able to walk back to where they started.
 * Example-based tests cover the boundaries this file's generators would hit
 * only occasionally; these cover the shapes nobody thought to write down.
 */
describe("preview paging", () => {
  it("visiting every page yields the original list exactly once, in order", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 60 }),
        fc.integer({ min: 1, max: 20 }),
        (rows, pageSize) => {
          const seen: number[] = [];
          let cursor: string | undefined = undefined;
          let guard = 0;

          for (;;) {
            /*
             * Annotated: `cursor` is narrowed by the assignment further down,
             * which is typed from `page`, so leaving this to inference is a
             * circularity TypeScript reports rather than resolves.
             */
            const page: LedgerPage<number> = previewPage(
              rows,
              pageSize,
              cursor,
            );
            expect(page.ok).toBe(true);
            if (!page.ok) return;
            seen.push(...page.items);
            if (page.complete) {
              expect(page.nextCursor).toBeNull();
              break;
            }
            expect(page.nextCursor).not.toBeNull();
            cursor = page.nextCursor ?? undefined;
            // A cursor that failed to advance would loop forever; bound the
            // walk so the property fails instead of hanging.
            expect((guard += 1)).toBeLessThanOrEqual(rows.length + 2);
          }

          expect(seen).toEqual(rows);
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });

  it("never returns more than the requested page size", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 60 }),
        fc.integer({ min: 1, max: 20 }),
        (rows, pageSize) => {
          const page = previewPage(rows, pageSize, undefined);
          expect(page.ok && page.items.length).toBeLessThanOrEqual(pageSize);
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });

  it("refuses every cursor it did not mint", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 20 }),
        fc
          .string()
          .filter((candidate) => !/^\d+$/.test(candidate) || candidate === ""),
        (rows, cursor) => {
          // A cursor is an opaque token. Anything that is not a mint of this
          // module is a refusal rather than a plausible-looking offset.
          expect(previewPage(rows, 5, cursor).ok).toBe(false);
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });
});

describe("cursor state", () => {
  it("returns to the first page after retreating as often as it advanced", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { maxLength: 12 }),
        (cursors) => {
          const forward = cursors.reduce<CursorState>(
            (state, cursor) => advance(state, cursor),
            initialCursorState,
          );
          expect(pageNumber(forward)).toBe(cursors.length + 1);

          const back = cursors.reduce<CursorState>(
            (state) => retreat(state),
            forward,
          );
          expect(isFirstPage(back)).toBe(true);
          expect(currentCursor(back)).toBeUndefined();
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });

  it("cannot be driven below the first page by any number of retreats", () => {
    fc.assert(
      fc.property(fc.nat({ max: 30 }), (extra) => {
        let state = advance(initialCursorState, "c2");
        for (let index = 0; index <= extra; index += 1) state = retreat(state);

        expect(isFirstPage(state)).toBe(true);
        expect(pageNumber(state)).toBe(1);
      }),
      { seed: 20260811, numRuns: 100 },
    );
  });
});
