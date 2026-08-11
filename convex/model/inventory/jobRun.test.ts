import { describe, expect, it } from "vitest";

import { fail, ok, type Result } from "../result";
import {
  DEFAULT_PAGES_PER_RUN,
  MAX_PAGES_PER_RUN,
  initialCheckpoint,
  runJob,
  validateCheckpoint,
  type JobCheckpoint,
  type JobReaderPage,
} from "./jobRun";

/**
 * A reader over a fixed list, paging by offset.
 *
 * The cursor is the offset as a string. Not what a Convex cursor is — but the
 * *contract* is the one the driver depends on: opaque, advancing, and `complete`
 * being the reader's own word rather than an inference from a short page.
 */
const listReader =
  (items: readonly number[], pageSize: number) =>
  async (
    cursor: string | null,
  ): Promise<Result<JobReaderPage<number>, unknown>> => {
    const offset = cursor === null ? 0 : Number(cursor);
    const page = items.slice(offset, offset + pageSize);
    const next = offset + page.length;
    return ok({
      items: page,
      nextCursor: next >= items.length ? null : String(next),
      complete: next >= items.length,
    });
  };

/** Sums whatever it is given. */
const summing = async (
  items: readonly number[],
  total: number,
): Promise<Result<number, unknown>> =>
  ok(total + items.reduce((sum, value) => sum + value, 0));

describe("validateCheckpoint", () => {
  it("accepts the initial checkpoint", () => {
    expect(validateCheckpoint(initialCheckpoint).ok).toBe(true);
  });

  it.each([
    ["a non-record", null],
    ["a numeric cursor", { cursor: 7, pagesRead: 0, itemsProcessed: 0 }],
    ["an empty cursor", { cursor: "", pagesRead: 0, itemsProcessed: 0 }],
    [
      "a negative page count",
      { cursor: null, pagesRead: -1, itemsProcessed: 0 },
    ],
    [
      "a fractional item count",
      { cursor: null, pagesRead: 0, itemsProcessed: 1.5 },
    ],
  ])("refuses %s", (_label, candidate) => {
    // A checkpoint comes back from a scheduler argument or a document, so it is
    // exactly the kind of value that satisfies the interface structurally and
    // not actually.
    expect(validateCheckpoint(candidate as JobCheckpoint).ok).toBe(false);
  });
});

describe("runJob", () => {
  it("reads every page and reports COMPLETE", async () => {
    const outcome = await runJob({
      checkpoint: initialCheckpoint,
      pageBudget: MAX_PAGES_PER_RUN,
      readPage: listReader([1, 2, 3, 4, 5], 2),
      processPage: summing,
      initialSummary: 0,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe("COMPLETE");
    expect(outcome.value.summary).toBe(15);
    expect(outcome.value.checkpoint.itemsProcessed).toBe(5);
    // A completed job has no cursor to resume from.
    expect(outcome.value.checkpoint.cursor).toBeNull();
  });

  it("stops at its budget and reports where to resume", async () => {
    const outcome = await runJob({
      checkpoint: initialCheckpoint,
      pageBudget: 2,
      readPage: listReader([1, 2, 3, 4, 5, 6, 7, 8], 2),
      processPage: summing,
      initialSummary: 0,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe("BUDGET_EXHAUSTED");
    expect(outcome.value.pagesThisRun).toBe(2);
    expect(outcome.value.checkpoint.cursor).toBe("4");
    expect(outcome.value.summary).toBe(1 + 2 + 3 + 4);
  });

  it("resumes exactly where it stopped, processing each item once", async () => {
    /*
     * The property the whole module exists for. Two budgeted runs must together
     * do exactly what one unbudgeted run does — no gap, no overlap.
     */
    const items = [1, 2, 3, 4, 5, 6, 7];
    const reader = listReader(items, 2);

    const first = await runJob({
      checkpoint: initialCheckpoint,
      pageBudget: 2,
      readPage: reader,
      processPage: summing,
      initialSummary: 0,
    });
    expect(first.ok && first.value.status).toBe("BUDGET_EXHAUSTED");
    if (!first.ok) return;

    const second = await runJob({
      checkpoint: first.value.checkpoint,
      pageBudget: MAX_PAGES_PER_RUN,
      readPage: reader,
      processPage: summing,
      initialSummary: first.value.summary,
    });

    expect(second.ok && second.value.status).toBe("COMPLETE");
    if (!second.ok) return;
    expect(second.value.summary).toBe(28);
    expect(second.value.checkpoint.itemsProcessed).toBe(items.length);
    expect(second.value.checkpoint.pagesRead).toBe(4);
  });

  it("survives being interrupted at every page boundary", async () => {
    // Interruption is the normal case for a scheduled job, not the exception.
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const reader = listReader(items, 2);

    let checkpoint = initialCheckpoint;
    let summary = 0;
    let guard = 0;

    for (;;) {
      const outcome = await runJob({
        checkpoint,
        pageBudget: 1,
        readPage: reader,
        processPage: summing,
        initialSummary: summary,
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      checkpoint = outcome.value.checkpoint;
      summary = outcome.value.summary;
      if (outcome.value.status === "COMPLETE") break;
      expect(outcome.value.status).toBe("BUDGET_EXHAUSTED");
      expect((guard += 1)).toBeLessThan(items.length + 2);
    }

    expect(summary).toBe(45);
    expect(checkpoint.itemsProcessed).toBe(items.length);
  });

  it("does not advance the checkpoint past a page whose work failed", async () => {
    /*
     * The silent-data-loss bug this ordering prevents: checkpointing before the
     * work means a retry skips the page that failed.
     */
    const outcome = await runJob({
      checkpoint: initialCheckpoint,
      pageBudget: MAX_PAGES_PER_RUN,
      readPage: listReader([1, 2, 3, 4], 2),
      processPage: async (items, total: number) =>
        items.includes(3) ? fail("work failed") : ok(total + items.length),
      initialSummary: 0,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe("FAILED");
    expect(outcome.value.error?.code).toBe("PAGE_WORK_FAILED");
    // The cursor still points at the page that failed, so a retry re-reads it.
    expect(outcome.value.checkpoint.cursor).toBe("2");
    expect(outcome.value.checkpoint.itemsProcessed).toBe(2);
  });

  it("reports a read failure without losing its place", async () => {
    const outcome = await runJob({
      checkpoint: initialCheckpoint,
      pageBudget: MAX_PAGES_PER_RUN,
      readPage: async () => fail("reader exploded"),
      processPage: summing,
      initialSummary: 0,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe("FAILED");
    expect(outcome.value.error?.code).toBe("PAGE_READ_FAILED");
    expect(outcome.value.checkpoint).toEqual(initialCheckpoint);
  });

  it("refuses a reader whose cursor does not advance", async () => {
    // Otherwise the run spins until its budget runs out and reports
    // `BUDGET_EXHAUSTED`, which reads as "more to do" forever.
    const outcome = await runJob({
      checkpoint: initialCheckpoint,
      pageBudget: MAX_PAGES_PER_RUN,
      readPage: async () =>
        ok({ items: [1], nextCursor: "stuck", complete: false }),
      processPage: summing,
      initialSummary: 0,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The first page advances from `null` to `"stuck"`; the second does not.
    expect(outcome.value.status).toBe("FAILED");
    expect(outcome.value.error?.code).toBe("CURSOR_DID_NOT_ADVANCE");
  });

  it("refuses a null next cursor on an incomplete page", async () => {
    // "Not complete" and "nowhere to resume from" cannot both be true.
    const outcome = await runJob({
      checkpoint: initialCheckpoint,
      pageBudget: MAX_PAGES_PER_RUN,
      readPage: async () =>
        ok({ items: [1], nextCursor: null, complete: false }),
      processPage: summing,
      initialSummary: 0,
    });

    expect(outcome.ok && outcome.value.error?.code).toBe(
      "CURSOR_DID_NOT_ADVANCE",
    );
  });

  it("refuses a budget outside the cap", async () => {
    for (const pageBudget of [0, -1, MAX_PAGES_PER_RUN + 1, 1.5, Number.NaN]) {
      const outcome = await runJob({
        checkpoint: initialCheckpoint,
        pageBudget,
        readPage: listReader([1], 1),
        processPage: summing,
        initialSummary: 0,
      });
      expect(outcome.ok, String(pageBudget)).toBe(false);
      expect(!outcome.ok && outcome.error.code).toBe("INVALID_PAGE_BUDGET");
    }
  });

  it("refuses a malformed checkpoint before reading anything", async () => {
    let reads = 0;
    const outcome = await runJob({
      checkpoint: { cursor: 7, pagesRead: 0, itemsProcessed: 0 } as never,
      pageBudget: DEFAULT_PAGES_PER_RUN,
      readPage: async () => {
        reads += 1;
        return ok({ items: [], nextCursor: null, complete: true });
      },
      processPage: summing,
      initialSummary: 0,
    });

    expect(outcome.ok).toBe(false);
    expect(reads).toBe(0);
  });

  it("completes immediately on an empty index", async () => {
    const outcome = await runJob({
      checkpoint: initialCheckpoint,
      pageBudget: DEFAULT_PAGES_PER_RUN,
      readPage: listReader([], 5),
      processPage: summing,
      initialSummary: 0,
    });

    expect(outcome.ok && outcome.value.status).toBe("COMPLETE");
    expect(outcome.ok && outcome.value.checkpoint.itemsProcessed).toBe(0);
    expect(outcome.ok && outcome.value.pagesThisRun).toBe(1);
  });

  it("bounds the work by pages, which bounds it by rows", () => {
    // A cap expressed in pages is one a scheduler can reason about without
    // knowing the page size; the page size is already bounded elsewhere.
    expect(MAX_PAGES_PER_RUN).toBeGreaterThan(0);
    expect(DEFAULT_PAGES_PER_RUN).toBeLessThanOrEqual(MAX_PAGES_PER_RUN);
  });
});
