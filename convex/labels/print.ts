/**
 * Label evidence, and the boundary it stops at.
 *
 * `INV-0007-07` requires that a printed label always be generated from a
 * specific template version, with the payload hash and print job recorded. This
 * module does exactly that much and stops, and where it stops is the point:
 *
 * - The payload is **generated and stored**. That is verifiable and it is true.
 * - The payload is **not transmitted anywhere**. `PrinterTransportPort` is
 *   `INT-04` and does not exist.
 * - No label has been **physically printed, applied, or rescanned**. That is
 *   `RG-004` and `RG-029`, and they are open.
 * - Nothing renders a **PDF**. `pdf-lib` is installed and unused; the PDF
 *   fallback of `ADR-0007` §10 is not implemented.
 *
 * A print job therefore reaches `GENERATED` and no further. There is no
 * `PRINTED` status, because nothing here can observe a printer, and a status
 * claiming otherwise would be the single most misleading row in the database.
 *
 * ### Why reprints are their own permission and their own reason
 *
 * Three labels for one pallet is either three attempts at a jammed printer or a
 * label being applied to stock that has moved. `ADR-0007` §10 requires reprints
 * to be audited *as reprints*, so `label.print.reprint` is a distinct code and
 * `reason` is a stored column rather than a note.
 */
import { v } from "convex/values";

import { sha256Hex } from "../lib/idempotency";
import {
  listArgs,
  pageOf,
  pageOptions,
  pageRefusal,
  pageRequestOf,
  pageResult,
} from "../lib/listEnvelope";
import { createMasterDataRow } from "../lib/masterDataStore";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import { printReason, printJobStatus } from "../lib/validators";
import { MAX_JOB_PAGE_SIZE } from "../model/inventory/jobPage";
import {
  renderLabel,
  requiresReprintPermission,
  type PrintReason,
} from "../model/inbound/labelPayload";

export const LABEL_OPERATIONS = Object.freeze({
  generate: "label.print.generate",
  reprint: "label.print.reprint",
});

interface TemplateDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly code: string;
  readonly version: number;
  readonly format: string;
  readonly status: string;
  readonly body: string;
}

/**
 * The field values a label may carry.
 *
 * A record of strings rather than a typed shape, because a tenant's template
 * decides which placeholders exist and the server cannot know them in advance.
 * The kernel refuses any placeholder the caller did not fill and any value that
 * could introduce another placeholder, which is where the safety actually lives.
 */
const labelFields = v.record(v.string(), v.string());

/** Everything both entry points do, so the two cannot drift. */
async function generate(
  ctx: TenantFunctionContext,
  input: {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly labelTemplateId: string;
    readonly targetKind: string;
    readonly targetId: string;
    readonly fields: Record<string, string>;
    readonly reason: PrintReason;
  },
): Promise<ReturnType<typeof written> | ReturnType<typeof refusal>> {
  const template = await ctx.tenantDb.get<TemplateDocument>(
    "labelTemplates",
    input.labelTemplateId,
  );
  if (template === null) {
    return refusal({ code: "REFERENCE_NOT_FOUND", field: "labelTemplateId" });
  }

  const rendered = renderLabel({
    template: {
      code: template.code,
      version: template.version,
      format: template.format,
      status: template.status,
      body: template.body,
    },
    fields: input.fields,
  });
  if (!rendered.ok) return refusal(rendered.error);

  /*
   * The hash is over the *canonical text* — template code, version, format,
   * then payload — and not over the payload alone. Two template versions can
   * render byte-identical payloads, and a hash that could not tell them apart
   * would defeat the versioning it exists to prove.
   */
  const payloadHash = await sha256Hex(rendered.value.canonicalText);

  const document = {
    warehouseId: input.warehouseId,
    labelTemplateId: input.labelTemplateId,
    // Denormalized so the evidence row survives the template being retired.
    templateCode: template.code,
    templateVersion: template.version,
    targetKind: input.targetKind,
    targetId: input.targetId,
    payload: rendered.value.payload,
    payloadHash,
    reason: input.reason,
    // The only status a repository with no printer transport can honestly write.
    status: "GENERATED",
    requestedByUserId: ctx.tenant.actor._id,
    occurredAt: Date.now(),
  };

  const outcome = await createMasterDataRow({
    ...writeContextOf(ctx, {
      table: "labelPrintJobs",
      operation: requiresReprintPermission(input.reason)
        ? LABEL_OPERATIONS.reprint
        : LABEL_OPERATIONS.generate,
      requestId: input.requestId,
      warehouseId: input.warehouseId,
    }),
    fingerprint: { ...document, occurredAt: undefined },
    // No uniqueness contract: one pallet legitimately accumulates a job per
    // label over its life, including every reprint.
    uniqueness: [],
    document,
  });

  return outcome.ok ? written(outcome.value) : refusal(outcome.error);
}

const targetArgs = {
  requestId: v.string(),
  warehouseId: v.id("warehouses"),
  labelTemplateId: v.id("labelTemplates"),
  /** What the label is for: `HANDLING_UNIT`, `RECEIPT_LINE`, or `LOT`. */
  targetKind: v.string(),
  targetId: v.string(),
  fields: labelFields,
};

/** Generate a label payload for the first time. */
export const generateLabel = mutationWithOrg({
  args: targetArgs,
  returns: writeOutcomeValidator,
  permissionCode: "label.print.execute",
  target: { table: "labelPrintJobs" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) =>
    await generate(ctx, { ...args, reason: "INITIAL" }),
});

/**
 * Generate the payload again, as a reprint.
 *
 * A separate entry point with a separate permission, because the *fact* that
 * this is a second label matters to whoever reads the evidence later. Routing it
 * through `generateLabel` with a flag would let a handheld relabel a pallet
 * without ever touching `label.print.reprint`.
 */
export const reprintLabel = mutationWithOrg({
  args: targetArgs,
  returns: writeOutcomeValidator,
  permissionCode: "label.print.reprint",
  target: { table: "labelPrintJobs" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) =>
    await generate(ctx, { ...args, reason: "REPRINT" }),
});

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

const printJobValidator = v.object({
  labelPrintJobId: v.id("labelPrintJobs"),
  templateCode: v.string(),
  templateVersion: v.number(),
  targetKind: v.string(),
  targetId: v.string(),
  payloadHash: v.string(),
  reason: printReason,
  status: printJobStatus,
  occurredAt: v.number(),
});

/**
 * The label evidence for one target.
 *
 * The **payload is not returned**. It is stored, and a screen that listed it
 * would put printer control codes on a warehouse display for no operator
 * benefit; the hash is what proves which bytes were generated, and the version
 * is what proves which template produced them.
 */
export const listPrintJobsForTarget = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    targetKind: v.string(),
    targetId: v.string(),
    ...listArgs,
  },
  returns: pageOf(printJobValidator),
  permissionCode: "label.print.read",
  target: { table: "labelPrintJobs" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);

    const page = await ctx.tenantDb
      .byIndex<{ readonly _id: string; readonly orgId: TenantOrgId }>(
        "labelPrintJobs",
        "by_orgId_targetKind_targetId",
        [
          { field: "targetKind", value: args.targetKind },
          { field: "targetId", value: args.targetId },
        ],
      )
      .page(pageOptions(request.value));

    return pageResult(
      page.page.map((row) => {
        const record = row as unknown as Record<string, unknown>;
        return {
          labelPrintJobId: row._id as never,
          templateCode: record["templateCode"] as string,
          templateVersion: record["templateVersion"] as number,
          targetKind: record["targetKind"] as string,
          targetId: record["targetId"] as string,
          payloadHash: record["payloadHash"] as string,
          reason: record["reason"] as never,
          status: record["status"] as never,
          occurredAt: record["occurredAt"] as number,
        };
      }),
      page,
    );
  },
});

/** The page cap, re-exported so a client can size its own loop. */
export const maxLabelPageSize = MAX_JOB_PAGE_SIZE;
