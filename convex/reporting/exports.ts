/**
 * Asynchronous exports: request, chunk, artifact (`ADR-0011` §7,
 * `INV-0011-01`, `INV-0011-02`, `INV-0011-08`).
 *
 * An export is the request most likely to be written as a scan. "Give me this
 * warehouse's balances as a spreadsheet" reads naturally as one call that walks
 * a table, and that call is the one that times out on the tenant with the most
 * data — which is the tenant most likely to have asked.
 *
 * So it is a job. `requestExport` creates a record and returns; `runExportChunk`
 * advances it by one bounded page, appending rendered rows to the artifact and
 * storing the cursor it stopped at. An interrupted run resumes rather than
 * restarting, and a repeated request replays the job it already created instead
 * of starting a second walk over the same rows.
 *
 * ### Where this stops, precisely
 *
 * `INV-0011-08` requires artifacts to be private and delivered through a
 * short-lived signed URL. That is `FileStoragePort`
 * ([INT-08](../../docs/integration-contracts/file-storage-port.md)), whose
 * vendor is not configured, so there is no signed URL to issue and none is
 * pretended. The artifact instead lives on the job document and is readable only
 * through `getReportJob`, which checks `reporting.export.read` for the site.
 * That is a *narrower* channel than a signed URL, not a substitute for one: it
 * cannot be forwarded, cannot be opened by an unauthenticated fetch, and expires
 * with the job rather than on a timer.
 *
 * The consequence is a real cap. A document has a size limit, so the artifact
 * does too, and an export that reaches it stops with `ARTIFACT_LIMIT_REACHED`
 * rather than silently truncating. A truncated spreadsheet that looked complete
 * would be the worst possible outcome for a stock count.
 */
import { v } from "convex/values";

import {
  csvHeader,
  csvRows,
  fitsWithin,
  utf8Bytes,
} from "../model/reporting/csv";
import {
  decodeExportPosition,
  encodeExportPosition,
  stepFor,
  type ExportPosition,
} from "../model/reporting/exportCursor";
import { MAX_JOB_PAGE_SIZE } from "../model/inventory/jobPage";
import { formatQuantity, makeQuantity } from "../model/uom/quantity";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import type { TenantDocumentAccess, TenantOrgId } from "../lib/tenantDb";
import { reportJobStatus, reportKind } from "../lib/validators";
import {
  refusal,
  writeErrorValidator,
  writeOutcomeValidator,
} from "../lib/writeEnvelope";

/**
 * The most an artifact may hold, in bytes.
 *
 * Half of Convex's document limit, so the row that crosses the line still fits
 * with the rest of the document around it. Bytes rather than characters because
 * Thai is three bytes per character and a character-counted cap would be a third
 * of the intended size on the product's first language.
 */
export const MAX_ARTIFACT_BYTES = 512 * 1024;

/** Rows appended per chunk. One bounded page, like every other read. */
export const EXPORT_CHUNK_ROWS = MAX_JOB_PAGE_SIZE;

interface ReportJobDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly kind: "INVENTORY_BALANCES" | "RECEIPT_LINES" | "PUTAWAY_TASKS";
  readonly status: "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED";
  readonly requestId: string;
  readonly cursor?: string;
  readonly rowCount: number;
  readonly artifact: string;
  readonly artifactBytes: number;
}

interface BalanceRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly bucketKey: string;
  readonly itemId: string;
  readonly locationId?: string;
  readonly stockStatus: string;
  readonly quantity: { readonly uom: string; readonly minorUnits: number };
  readonly updatedAt: number;
}

interface ReceiptLineRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly receiptId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly baseMinorUnits: number;
  readonly kind: string;
  readonly classification: string;
  readonly stockStatus: string;
}

interface PutawayTaskRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly itemId: string;
  readonly status: string;
  readonly fromLocationId: string;
  readonly chosenLocationId?: string;
  readonly recommendedLocationId?: string;
  readonly baseMinorUnits: number;
}

/**
 * The columns of each export, and the row renderer that fills them.
 *
 * Declared together so a column cannot be added to the header without a value,
 * which is how an export ends up with a blank column nobody can explain.
 *
 * Quantities are rendered through `formatQuantity` — the same kernel the screens
 * use — so a spreadsheet and a screen never disagree about a number. A raw
 * `minorUnits` would be thousandths, and somebody would eventually read 500000
 * as five hundred thousand kilograms.
 */
const REPORTS = {
  INVENTORY_BALANCES: {
    columns: [
      "bucketKey",
      "itemId",
      "locationId",
      "stockStatus",
      "uom",
      "quantity",
    ],
    render: (row: BalanceRow) => [
      row.bucketKey,
      row.itemId,
      row.locationId ?? "",
      row.stockStatus,
      row.quantity.uom,
      renderQuantity(row.quantity.uom, row.quantity.minorUnits),
    ],
  },
  RECEIPT_LINES: {
    columns: [
      "receiptLineId",
      "receiptId",
      "itemId",
      "locationId",
      "kind",
      "classification",
      "stockStatus",
      "baseQuantity",
    ],
    render: (row: ReceiptLineRow) => [
      row._id,
      row.receiptId,
      row.itemId,
      row.locationId,
      row.kind,
      row.classification,
      row.stockStatus,
      renderQuantity("", row.baseMinorUnits),
    ],
  },
  PUTAWAY_TASKS: {
    columns: [
      "putawayTaskId",
      "itemId",
      "status",
      "fromLocationId",
      "recommendedLocationId",
      "chosenLocationId",
      "baseQuantity",
    ],
    render: (row: PutawayTaskRow) => [
      row._id,
      row.itemId,
      row.status,
      row.fromLocationId,
      row.recommendedLocationId ?? "",
      row.chosenLocationId ?? "",
      renderQuantity("", row.baseMinorUnits),
    ],
  },
} as const;

/**
 * A quantity as a person reads it.
 *
 * Falls back to the raw integer when the value is outside the kernel's declared
 * bound, because an export that dropped a row it could not format would be
 * quietly incomplete — and being obviously odd beats being silently short.
 */
function renderQuantity(uom: string, minorUnits: number): string {
  const quantity = makeQuantity(minorUnits, uom === "" ? "BASE" : uom);
  if (!quantity.ok) return String(minorUnits);
  const formatted = formatQuantity(quantity.value);
  return formatted.ok ? formatted.value : String(minorUnits);
}

/** What one chunk read, and where the next one resumes. */
interface SourcePage {
  readonly rows: readonly (readonly string[])[];
  readonly position: ExportPosition;
  readonly done: boolean;
}

/**
 * Read one page of the source a report kind walks.
 *
 * **One cursored read per call.** A Convex function execution may perform only
 * one indexed read that has a continuation, so a two-level walk cannot advance
 * its parent *and* drain a child in the same chunk. Receipt lines therefore
 * alternate: a chunk either moves to the next receipt (appending nothing) or
 * drains a page of the current receipt's lines. `stepFor` names which, from the
 * stored position, so the rule is a decision in the code rather than a comment
 * somebody has to honour.
 *
 * The alternative — taking a fixed number of lines per receipt — is what this
 * replaces. It was bounded and it was wrong: a delivery with more lines than the
 * page size silently lost the rest, and the finished file looked complete.
 */
async function readSourcePage(
  tenantDb: TenantDocumentAccess,
  job: ReportJobDocument,
  position: ExportPosition,
): Promise<SourcePage> {
  const page = {
    limit: EXPORT_CHUNK_ROWS,
    ...(position.outer === undefined ? {} : { cursor: position.outer }),
  };

  if (job.kind === "INVENTORY_BALANCES") {
    const answer = await tenantDb
      .byIndex<BalanceRow>(
        "inventoryBalances",
        "by_orgId_warehouseId_bucketKey",
        [{ field: "warehouseId", value: job.warehouseId }],
      )
      .page(page);
    return {
      rows: answer.page.map(REPORTS.INVENTORY_BALANCES.render),
      position: answer.isDone ? {} : { outer: answer.continueCursor },
      done: answer.isDone,
    };
  }

  if (job.kind === "PUTAWAY_TASKS") {
    const answer = await tenantDb
      .byIndex<PutawayTaskRow>("putawayTasks", "by_orgId_warehouseId_status", [
        { field: "warehouseId", value: job.warehouseId },
      ])
      .page(page);
    return {
      rows: answer.page.map(REPORTS.PUTAWAY_TASKS.render),
      position: answer.isDone ? {} : { outer: answer.continueCursor },
      done: answer.isDone,
    };
  }

  /*
   * Receipt lines are walked through their receipts, because a line has no
   * warehouse of its own.
   */
  const step = stepFor(position);

  if (step === "FINISHED") {
    // The parent walk was exhausted by an earlier chunk and its last subject has
    // been drained. Nothing is left to read at all.
    return { rows: [], position: {}, done: true };
  }

  if (step === "ADVANCE_SUBJECT") {
    // One receipt at a time. A wider page would be wasted: the very next chunk
    // can only drain one of them anyway, and the extra IDs would have to be
    // carried in the cursor.
    const receipts = await tenantDb
      .byIndex<{ readonly _id: string; readonly orgId: TenantOrgId }>(
        "receipts",
        "by_orgId_warehouseId_occurredAt",
        [{ field: "warehouseId", value: job.warehouseId }],
      )
      .page({ ...page, limit: 1 });

    const receipt = receipts.page[0];
    if (receipt === undefined) {
      // The parent walk is exhausted, so the export is complete.
      return { rows: [], position: {}, done: true };
    }

    /*
     * `parentDone` is carried rather than the absence of a cursor. "No cursor"
     * is the *start* of a walk, and reading exhaustion as a start is a live
     * lock: the first receipt would be exported again for ever.
     */
    return {
      rows: [],
      position: {
        ...(receipts.isDone
          ? { parentDone: true }
          : { outer: receipts.continueCursor }),
        subjectId: receipt._id,
      },
      done: false,
    };
  }

  const lines = await tenantDb
    .byIndex<ReceiptLineRow>("receiptLines", "by_orgId_receiptId", [
      { field: "receiptId", value: position.subjectId },
    ])
    .page({
      limit: EXPORT_CHUNK_ROWS,
      ...(position.inner === undefined ? {} : { cursor: position.inner }),
    });

  const rows = lines.page.map(REPORTS.RECEIPT_LINES.render);

  /*
   * Draining never reports `done`. Even the last receipt's last page leaves the
   * parent walk to confirm exhaustion on the following chunk — one extra call,
   * in exchange for never having to decide completeness from two cursors at
   * once.
   */
  const parentPosition = {
    ...(position.outer === undefined ? {} : { outer: position.outer }),
    ...(position.parentDone === true ? { parentDone: true } : {}),
  };

  return {
    rows,
    position: lines.isDone
      ? parentPosition
      : {
          ...parentPosition,
          subjectId: position.subjectId as string,
          inner: lines.continueCursor,
        },
    done: false,
  };
}

const jobValidator = v.object({
  reportJobId: v.id("reportJobs"),
  kind: reportKind,
  status: reportJobStatus,
  rowCount: v.number(),
  artifactBytes: v.number(),
  requestedAt: v.number(),
  completedAt: v.optional(v.number()),
  failureCode: v.optional(v.string()),
});

/**
 * Ask for an export.
 *
 * Returns immediately with a `QUEUED` job. The walk happens in `runExportChunk`,
 * which the client drives one page at a time — the same shape the purchase-order
 * import already uses, and for the same reason: a bounded step a caller can see
 * the progress of beats an unbounded one it can only wait for.
 */
export const requestExport = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    kind: reportKind,
  },
  // The shared write envelope, so one client contract covers every mutation in
  // the system: `documentId` is the report job's own ID.
  returns: writeOutcomeValidator,
  permissionCode: "reporting.export.execute",
  target: { table: "reportJobs" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    // One job per request. A retry through a dropped connection resumes the walk
    // it already started rather than beginning a second one (`INV-0011-02`).
    const existing = await ctx.tenantDb
      .byIndex<ReportJobDocument>("reportJobs", "by_orgId_requestId", [
        { field: "requestId", value: args.requestId },
      ])
      .unique();

    if (existing !== null) {
      /*
       * A replay is only a replay if it asks for the same thing. The same
       * request ID with a different warehouse or a different kind is not a
       * retry — it is a client bug or a collision, and answering with the
       * *earlier* job would hand back a balances extract to somebody who asked
       * for putaway tasks, or another site's data to somebody who asked for
       * this one. Both look like a successful export until read.
       *
       * `REQUEST_ARGUMENT_CONFLICT` is the vocabulary the idempotency module
       * already uses for exactly this (`convex/lib/idempotency.ts`).
       */
      if (
        existing.warehouseId !== args.warehouseId ||
        existing.kind !== args.kind
      ) {
        return refusal({ code: "REQUEST_ARGUMENT_CONFLICT" });
      }

      return {
        written: true as const,
        documentId: existing._id as string,
        replayed: true,
      };
    }

    const now = Date.now();
    const reportJobId = await ctx.tenantDb.insert("reportJobs", {
      warehouseId: args.warehouseId,
      kind: args.kind,
      status: "QUEUED",
      requestedByUserId: ctx.tenant.actor._id,
      requestedAt: now,
      requestId: args.requestId,
      rowCount: 0,
      artifact: csvHeader(REPORTS[args.kind].columns),
      artifactBytes: utf8Bytes(csvHeader(REPORTS[args.kind].columns)),
    });

    return {
      written: true as const,
      documentId: reportJobId as string,
      replayed: false,
    };
  },
});

/**
 * Advance an export by one page.
 *
 * Idempotent in the way that matters: running a chunk twice appends the same
 * page twice, so the cursor is written in the same transaction as the rows it
 * produced. A caller that retries after a transport failure re-runs a chunk that
 * either committed entirely or not at all.
 */
export const runExportChunk = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    reportJobId: v.id("reportJobs"),
  },
  returns: v.union(
    v.object({
      written: v.literal(true),
      status: reportJobStatus,
      rowCount: v.number(),
      artifactBytes: v.number(),
      complete: v.boolean(),
    }),
    v.object({ written: v.literal(false), error: writeErrorValidator }),
  ),
  permissionCode: "reporting.export.execute",
  target: { table: "reportJobs" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const job = await ctx.tenantDb.get<ReportJobDocument>(
      "reportJobs",
      args.reportJobId,
    );
    // A foreign job answers exactly what a nonexistent one answers
    // (`INV-0002-03`).
    if (job === null) return refusal({ code: "NOT_FOUND" });
    if (job.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND" });
    }
    if (job.status === "COMPLETE" || job.status === "FAILED") {
      return {
        written: true as const,
        status: job.status,
        rowCount: job.rowCount,
        artifactBytes: job.artifactBytes,
        complete: true,
      };
    }

    const position = decodeExportPosition(job.cursor);
    if (!position.ok) {
      /*
       * A stored position nobody can read is not recoverable by continuing:
       * restarting the walk would duplicate every row already written. The job
       * fails with the reason, and a fresh request starts a clean one.
       */
      await ctx.tenantDb.patch("reportJobs", job._id, {
        status: "FAILED",
        failureCode: position.error.code,
        completedAt: Date.now(),
      });
      return refusal({ code: position.error.code });
    }

    const source = await readSourcePage(ctx.tenantDb, job, position.value);
    const addition = csvRows(source.rows);
    const additionBytes = utf8Bytes(addition);

    if (!fitsWithin(job.artifactBytes, additionBytes, MAX_ARTIFACT_BYTES)) {
      /*
       * Stopped, not truncated. A spreadsheet that looked complete and was not
       * is the worst outcome an export can have — somebody counts stock from it.
       */
      await ctx.tenantDb.patch("reportJobs", job._id, {
        status: "FAILED",
        failureCode: "ARTIFACT_LIMIT_REACHED",
        completedAt: Date.now(),
      });
      return refusal({ code: "ARTIFACT_LIMIT_REACHED" });
    }

    const complete = source.done;
    const now = Date.now();

    const nextCursor = encodeExportPosition(source.position);
    if (!nextCursor.ok) {
      // The position cannot be stored, so the chunk cannot be committed as
      // resumable. Failing here loses one page of work; committing it would lose
      // the ability to continue, which loses the whole export.
      await ctx.tenantDb.patch("reportJobs", job._id, {
        status: "FAILED",
        failureCode: nextCursor.error.code,
        completedAt: now,
      });
      return refusal({ code: nextCursor.error.code });
    }

    await ctx.tenantDb.patch("reportJobs", job._id, {
      status: complete ? "COMPLETE" : "RUNNING",
      rowCount: job.rowCount + source.rows.length,
      artifact: job.artifact + addition,
      artifactBytes: job.artifactBytes + additionBytes,
      ...(complete ? {} : { cursor: nextCursor.value }),
      ...(complete ? { completedAt: now } : {}),
    });

    return {
      written: true as const,
      status: complete ? ("COMPLETE" as const) : ("RUNNING" as const),
      rowCount: job.rowCount + source.rows.length,
      artifactBytes: job.artifactBytes + additionBytes,
      complete,
    };
  },
});

/**
 * One job, with its artifact.
 *
 * A separate permission from running an export: the person who may *generate* a
 * stock extract and the person who may *read* one are not necessarily the same,
 * and an export is tenant data in its most portable form.
 */
export const getReportJob = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    reportJobId: v.id("reportJobs"),
  },
  returns: v.union(
    v.object({
      found: v.literal(true),
      job: jobValidator,
      artifact: v.string(),
    }),
    v.object({ found: v.literal(false) }),
  ),
  permissionCode: "reporting.export.read",
  target: { table: "reportJobs" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const job = await ctx.tenantDb.get<
      ReportJobDocument & {
        readonly requestedAt: number;
        readonly completedAt?: number;
        readonly failureCode?: string;
      }
    >("reportJobs", args.reportJobId);

    if (job === null || job.warehouseId !== args.warehouseId) {
      return { found: false as const };
    }

    return {
      found: true as const,
      job: {
        reportJobId: job._id as never,
        kind: job.kind,
        status: job.status,
        rowCount: job.rowCount,
        artifactBytes: job.artifactBytes,
        requestedAt: job.requestedAt,
        ...(job.completedAt === undefined
          ? {}
          : { completedAt: job.completedAt }),
        ...(job.failureCode === undefined
          ? {}
          : { failureCode: job.failureCode }),
      },
      artifact: job.artifact,
    };
  },
});

/**
 * This site's exports, one bounded page per status.
 *
 * Read per status rather than as one list, because `(orgId, warehouseId,
 * status)` is the index and a register that showed only the first page of a
 * status-ordered read would hide every completed export behind the queued ones.
 */
export const listReportJobs = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.object({ ok: v.literal(true), jobs: v.array(jobValidator) }),
  permissionCode: "reporting.export.read",
  target: { table: "reportJobs" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const statuses = ["QUEUED", "RUNNING", "COMPLETE", "FAILED"] as const;
    const jobs = [];

    for (const status of statuses) {
      const rows = await ctx.tenantDb
        .byIndex<
          ReportJobDocument & {
            readonly requestedAt: number;
            readonly completedAt?: number;
            readonly failureCode?: string;
          }
        >("reportJobs", "by_orgId_warehouseId_status", [
          { field: "warehouseId", value: args.warehouseId },
          { field: "status", value: status },
        ])
        .take(25);

      for (const row of rows) {
        jobs.push({
          reportJobId: row._id as never,
          kind: row.kind,
          status: row.status,
          rowCount: row.rowCount,
          artifactBytes: row.artifactBytes,
          requestedAt: row.requestedAt,
          ...(row.completedAt === undefined
            ? {}
            : { completedAt: row.completedAt }),
          ...(row.failureCode === undefined
            ? {}
            : { failureCode: row.failureCode }),
        });
      }
    }

    return { ok: true as const, jobs };
  },
});

/** Caps re-exported so a client and a test share one number. */
export const maxArtifactBytes = MAX_ARTIFACT_BYTES;
export const exportChunkRows = EXPORT_CHUNK_ROWS;
export const reportColumns = REPORTS;
