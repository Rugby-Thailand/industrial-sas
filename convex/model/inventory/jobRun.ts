/**
 * The bounded, resumable driver every ledger job shares — as pure algebra.
 *
 * A job in this system is a fold over pages: read a bounded page, do something
 * with it, remember where you got to, stop when the budget runs out. That shape
 * is identical for reconciliation and for expiry reclassification, and it is
 * exactly the shape people get wrong: a run that forgets its checkpoint restarts
 * from the beginning, a run with no budget holds a transaction open until it is
 * killed, and a run whose checkpoint is a document ID silently skips a row when
 * one is inserted mid-run.
 *
 * This module owns the *control*, not the work. It takes no Convex import, reads
 * no database, and takes no clock — plan §6.2 — so every one of its interesting
 * cases is reachable from a deterministic test, including the ones a real
 * database would produce only under load.
 *
 * ### The checkpoint is the cursor, and nothing else
 *
 * A checkpoint carries the opaque cursor the *reader* minted and a count of what
 * has been done. It deliberately does not carry a document ID, a timestamp, or a
 * "last processed key": those are all recoverable-looking values that go wrong
 * when rows are inserted or deleted between runs. The cursor is the reader's own
 * position in its own index; passing it back is the only resumption this module
 * permits.
 *
 * ### Why a run stops for three different reasons
 *
 * `COMPLETE` means the index is exhausted. `BUDGET_EXHAUSTED` means the run hit
 * its cap and there is more to do — the caller schedules another. `FAILED` means
 * a page could not be read or processed. Collapsing the first two would make
 * "the job finished" indistinguishable from "the job gave up", which is the one
 * thing an operator monitoring a nightly reconciliation needs to know.
 */
import { isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";

/* -------------------------------------------------------------------------- */
/* Budget                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The most pages one run may read.
 *
 * A cap on *pages*, not on rows: the page size is already bounded by
 * `MAX_JOB_PAGE_SIZE`, so pages × page size bounds the work, and a cap
 * expressed in pages is one a scheduler can reason about without knowing the
 * page size.
 *
 * Twenty is deliberately small. A run that needs more than 2,000 rows of work is
 * a run that should be scheduled again rather than one that should hold a
 * transaction longer; Convex's own limits punish the alternative.
 */
export const MAX_PAGES_PER_RUN = 20;

/** The default when a caller expresses no preference. */
export const DEFAULT_PAGES_PER_RUN = 5;

/* -------------------------------------------------------------------------- */
/* Checkpoint                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Where a run got to.
 *
 * `cursor` is `null` exactly when the scan has not started or has finished; a
 * caller cannot distinguish those two from the checkpoint alone, and should not
 * try — `JobRunOutcome.status` is what says which.
 */
export interface JobCheckpoint {
  readonly cursor: string | null;
  /** Pages read so far, across every run of this job. */
  readonly pagesRead: number;
  /** Items processed so far, across every run of this job. */
  readonly itemsProcessed: number;
}

export const initialCheckpoint: JobCheckpoint = Object.freeze({
  cursor: null,
  pagesRead: 0,
  itemsProcessed: 0,
});

export type JobRunError =
  | { readonly code: "INVALID_CHECKPOINT"; readonly field: string }
  | { readonly code: "INVALID_PAGE_BUDGET"; readonly requested: string }
  | {
      readonly code: "PAGE_READ_FAILED";
      readonly page: number;
      readonly cause: unknown;
    }
  | {
      readonly code: "PAGE_WORK_FAILED";
      readonly page: number;
      readonly cause: unknown;
    }
  | {
      readonly code: "CURSOR_DID_NOT_ADVANCE";
      readonly page: number;
    };

/**
 * Re-check a checkpoint that claims to be one.
 *
 * `JobCheckpoint` is an interface, so a value read back from a document or a
 * scheduler argument is exactly the kind of thing that satisfies it structurally
 * and not actually. A negative `pagesRead` would make a budget comparison
 * nonsense; a non-string cursor would be handed to a reader that cannot use it.
 */
export function validateCheckpoint(
  checkpoint: JobCheckpoint,
): Result<JobCheckpoint, JobRunError> {
  if (!isRecord(checkpoint)) {
    return fail({ code: "INVALID_CHECKPOINT", field: "checkpoint" });
  }
  const { cursor, pagesRead, itemsProcessed } = checkpoint;

  if (cursor !== null && !isString(cursor)) {
    return fail({ code: "INVALID_CHECKPOINT", field: "cursor" });
  }
  if (cursor !== null && cursor.length === 0) {
    return fail({ code: "INVALID_CHECKPOINT", field: "cursor" });
  }
  if (!isSafeInt(pagesRead) || pagesRead < 0) {
    return fail({ code: "INVALID_CHECKPOINT", field: "pagesRead" });
  }
  if (!isSafeInt(itemsProcessed) || itemsProcessed < 0) {
    return fail({ code: "INVALID_CHECKPOINT", field: "itemsProcessed" });
  }

  return ok(
    Object.freeze({
      cursor: cursor as string | null,
      pagesRead,
      itemsProcessed,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* The run                                                                     */
/* -------------------------------------------------------------------------- */

export type JobRunStatus = "COMPLETE" | "BUDGET_EXHAUSTED" | "FAILED";

export interface JobRunOutcome<Summary> {
  readonly status: JobRunStatus;
  readonly checkpoint: JobCheckpoint;
  /** Pages read *by this run*, not across the job's life. */
  readonly pagesThisRun: number;
  readonly summary: Summary;
  /** Present only when `status` is `FAILED`. */
  readonly error?: JobRunError;
}

/** One page, as the reader answers it. */
export interface JobReaderPage<Item> {
  readonly items: readonly Item[];
  readonly nextCursor: string | null;
  readonly complete: boolean;
}

export interface JobRunInput<Item, Summary> {
  readonly checkpoint: JobCheckpoint;
  /** Pages this run may read. Refused above `MAX_PAGES_PER_RUN`. */
  readonly pageBudget: number;
  /** Reads one bounded page from the caller's cursor. */
  readonly readPage: (
    cursor: string | null,
  ) => Promise<Result<JobReaderPage<Item>, unknown>>;
  /** Does the job's work for one page, folding into the running summary. */
  readonly processPage: (
    items: readonly Item[],
    summary: Summary,
  ) => Promise<Result<Summary, unknown>>;
  readonly initialSummary: Summary;
}

/**
 * Drive one bounded run.
 *
 * The loop is short and every exit is named. Three details are load-bearing:
 *
 * - **The checkpoint advances only after the page's work succeeded.** A run that
 *   checkpointed first and then failed would skip a page on resume, which is the
 *   silent-data-loss version of this bug.
 * - **A cursor that did not advance is a failure, not a loop.** A reader that
 *   answers the same cursor twice would otherwise spin until the budget ran out
 *   and report `BUDGET_EXHAUSTED`, which reads as "more to do" forever.
 * - **`complete` is the reader's word, not an inference from a short page.** A
 *   page can be short because the index ended or because the reader chose to
 *   return fewer; only the reader knows which.
 */
export async function runJob<Item, Summary>(
  input: JobRunInput<Item, Summary>,
): Promise<Result<JobRunOutcome<Summary>, JobRunError>> {
  const start = validateCheckpoint(input.checkpoint);
  if (!start.ok) return start;

  if (
    !isSafeInt(input.pageBudget) ||
    input.pageBudget < 1 ||
    input.pageBudget > MAX_PAGES_PER_RUN
  ) {
    return fail({
      code: "INVALID_PAGE_BUDGET",
      requested: String(input.pageBudget),
    });
  }

  let cursor = start.value.cursor;
  let pagesRead = start.value.pagesRead;
  let itemsProcessed = start.value.itemsProcessed;
  let summary = input.initialSummary;
  let pagesThisRun = 0;

  while (pagesThisRun < input.pageBudget) {
    const page = await input.readPage(cursor);
    if (!page.ok) {
      return ok(
        failedRun(
          { cursor, pagesRead, itemsProcessed },
          pagesThisRun,
          summary,
          {
            code: "PAGE_READ_FAILED",
            page: pagesRead,
            cause: page.error,
          },
        ),
      );
    }

    const processed = await input.processPage(page.value.items, summary);
    if (!processed.ok) {
      return ok(
        failedRun(
          { cursor, pagesRead, itemsProcessed },
          pagesThisRun,
          summary,
          {
            code: "PAGE_WORK_FAILED",
            page: pagesRead,
            cause: processed.error,
          },
        ),
      );
    }

    summary = processed.value;
    pagesRead += 1;
    pagesThisRun += 1;
    itemsProcessed += page.value.items.length;

    if (page.value.complete) {
      return ok(
        Object.freeze({
          status: "COMPLETE" as const,
          checkpoint: Object.freeze({
            cursor: null,
            pagesRead,
            itemsProcessed,
          }),
          pagesThisRun,
          summary,
        }),
      );
    }

    const next = page.value.nextCursor;
    if (next === null || next === cursor) {
      return ok(
        failedRun(
          { cursor, pagesRead, itemsProcessed },
          pagesThisRun,
          summary,
          { code: "CURSOR_DID_NOT_ADVANCE", page: pagesRead },
        ),
      );
    }
    cursor = next;
  }

  return ok(
    Object.freeze({
      status: "BUDGET_EXHAUSTED" as const,
      checkpoint: Object.freeze({ cursor, pagesRead, itemsProcessed }),
      pagesThisRun,
      summary,
    }),
  );
}

const failedRun = <Summary>(
  checkpoint: JobCheckpoint,
  pagesThisRun: number,
  summary: Summary,
  error: JobRunError,
): JobRunOutcome<Summary> =>
  Object.freeze({
    status: "FAILED" as const,
    /*
     * The checkpoint is the one from *before* the failed page, so a retry
     * re-reads it rather than skipping it. Re-reading is safe because both jobs
     * are read-only folds; a job that wrote would need the work itself to be
     * idempotent, which is what `convex/lib/idempotency.ts` is for.
     */
    checkpoint: Object.freeze(checkpoint),
    pagesThisRun,
    summary,
    error,
  });
