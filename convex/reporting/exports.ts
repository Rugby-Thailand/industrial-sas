import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
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
import type { TenantDocumentAccess } from "../lib/tenantDb";
import { reportJobStatus, reportKind } from "../lib/validators";
import {
  refusal,
  writeErrorValidator,
  writeOutcomeValidator,
} from "../lib/writeEnvelope";

export const MAX_ARTIFACT_BYTES = 512 * 1024;

export const EXPORT_CHUNK_ROWS = MAX_JOB_PAGE_SIZE;

type ReportJobDocument = Doc<"reportJobs">;
type BalanceRow = Doc<"inventoryBalances">;
type ReceiptLineRow = Doc<"receiptLines">;
type PutawayTaskRow = Doc<"putawayTasks">;

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

function renderQuantity(uom: string, minorUnits: number): string {
  const quantity = makeQuantity(minorUnits, uom === "" ? "BASE" : uom);
  if (!quantity.ok) return String(minorUnits);
  const formatted = formatQuantity(quantity.value);
  return formatted.ok ? formatted.value : String(minorUnits);
}

interface SourcePage {
  readonly rows: readonly (readonly string[])[];
  readonly position: ExportPosition;
  readonly done: boolean;
}

// Convex permits only one paginated read per function execution.
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

  const step = stepFor(position);

  if (step === "FINISHED") {
    return { rows: [], position: {}, done: true };
  }

  if (step === "ADVANCE_SUBJECT") {
    const receipts = await tenantDb
      .byIndex<Pick<Doc<"receipts">, "_id" | "orgId">>(
        "receipts",
        "by_orgId_warehouseId_occurredAt",
        [{ field: "warehouseId", value: job.warehouseId }],
      )
      .page({ ...page, limit: 1 });

    const receipt = receipts.page[0];
    if (receipt === undefined) {
      return { rows: [], position: {}, done: true };
    }

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

export const requestExport = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    kind: reportKind,
  },

  returns: writeOutcomeValidator,
  permissionCode: "reporting.export.execute",
  target: { table: "reportJobs" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const existing = await ctx.tenantDb
      .byIndex<ReportJobDocument>("reportJobs", "by_orgId_requestId", [
        { field: "requestId", value: args.requestId },
      ])
      .unique();

    if (existing !== null) {
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

export const maxArtifactBytes = MAX_ARTIFACT_BYTES;
export const exportChunkRows = EXPORT_CHUNK_ROWS;
export const reportColumns = REPORTS;
