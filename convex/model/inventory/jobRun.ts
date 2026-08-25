import { isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";

export const MAX_PAGES_PER_RUN = 20;

export const DEFAULT_PAGES_PER_RUN = 5;

export interface JobCheckpoint {
  readonly cursor: string | null;

  readonly pagesRead: number;

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

export type JobRunStatus = "COMPLETE" | "BUDGET_EXHAUSTED" | "FAILED";

export interface JobRunOutcome<Summary> {
  readonly status: JobRunStatus;
  readonly checkpoint: JobCheckpoint;

  readonly pagesThisRun: number;
  readonly summary: Summary;

  readonly error?: JobRunError;
}

export interface JobReaderPage<Item> {
  readonly items: readonly Item[];
  readonly nextCursor: string | null;
  readonly complete: boolean;
}

export interface JobRunInput<Item, Summary> {
  readonly checkpoint: JobCheckpoint;

  readonly pageBudget: number;

  readonly readPage: (
    cursor: string | null,
  ) => Promise<Result<JobReaderPage<Item>, unknown>>;

  readonly processPage: (
    items: readonly Item[],
    summary: Summary,
  ) => Promise<Result<Summary, unknown>>;
  readonly initialSummary: Summary;
}

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

    checkpoint: Object.freeze(checkpoint),
    pagesThisRun,
    summary,
    error,
  });
