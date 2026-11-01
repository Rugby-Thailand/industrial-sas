/**
 * Operator-run, resumable move of legacy inline payslip bytes
 * (`hrPayslipRows.sourceBase64`) into private `hrPayslipPayloads` records.
 *
 * Each call handles one bounded page of rows (at most `MAX_BATCH`, so the
 * transaction reads and writes stay a few MiB even at the 384 KiB PDF limit)
 * and returns the cursor for the next call. A row moves only when its decoded
 * bytes still hash to the row's immutable `sourceHash`; the payload and the
 * row update commit in the same transaction, so a retry or an interrupted run
 * can never duplicate or lose a document. Rows whose bytes fail verification
 * are left untouched and reported, never repaired or dropped.
 *
 * Completion rule: one full pass from an empty cursor with `dryRun: true`
 * reports `inline === 0`, `missingPayload === 0` and `integrityFailures`
 * empty. See docs/operations/hr-payslip-payload-migration.md.
 */
import { v } from "convex/values";

import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { pdfBytes, pdfHash } from "../model/hr/payslip";

export const MAX_BATCH = 8;

export const migrateInlinePayloads = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    scanned: v.number(),
    migrated: v.number(),
    alreadyMigrated: v.number(),
    inline: v.number(),
    missingPayload: v.number(),
    integrityFailures: v.array(v.string()),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? MAX_BATCH;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH)
      throw new Error(`batchSize must be an integer from 1 to ${MAX_BATCH}`);
    const page = await ctx.db
      .query("hrPayslipRows")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    const report = {
      scanned: page.page.length,
      migrated: 0,
      alreadyMigrated: 0,
      inline: 0,
      missingPayload: 0,
      integrityFailures: [] as string[],
    };
    for (const row of page.page) {
      const outcome = await migrateRow(ctx.db, row, args.dryRun === true);
      if (outcome === "FAILED") report.integrityFailures.push(row._id);
      else if (outcome === "MIGRATED") report.migrated += 1;
      else if (outcome === "PENDING") report.inline += 1;
      else if (outcome === "MISSING") report.missingPayload += 1;
      else report.alreadyMigrated += 1;
    }
    return {
      ...report,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

async function migrateRow(
  db: MutationCtx["db"],
  row: Doc<"hrPayslipRows">,
  dryRun: boolean,
): Promise<"MIGRATED" | "PENDING" | "DONE" | "MISSING" | "FAILED"> {
  if (row.payloadId !== undefined) {
    const payload = await db.get(row.payloadId);
    if (
      payload === null ||
      payload.orgId !== row.orgId ||
      payload.sourceHash !== row.sourceHash
    )
      return "FAILED";
    // A row is complete only once no inline copy remains.
    if (row.sourceBase64 === undefined) return "DONE";
    if (payload.sourceBase64 !== row.sourceBase64) return "FAILED";
    if (dryRun) return "PENDING";
    await db.patch(row._id, { sourceBase64: undefined });
    return "MIGRATED";
  }
  if (row.sourceBase64 === undefined) return "MISSING";
  const bytes = pdfBytes(row.sourceBase64);
  if (bytes === null || (await pdfHash(bytes)) !== row.sourceHash)
    return "FAILED";
  if (dryRun) return "PENDING";
  const payloadId: Id<"hrPayslipPayloads"> = await db.insert(
    "hrPayslipPayloads",
    {
      orgId: row.orgId,
      importId: row.importId,
      employeeId: row.employeeId,
      sourceBase64: row.sourceBase64,
      sourceHash: row.sourceHash,
      byteLength: bytes.length,
      createdAt: row._creationTime,
    },
  );
  await db.patch(row._id, { payloadId, sourceBase64: undefined });
  return "MIGRATED";
}
