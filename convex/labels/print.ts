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

  const payloadHash = await sha256Hex(rendered.value.canonicalText);

  const document = {
    warehouseId: input.warehouseId,
    labelTemplateId: input.labelTemplateId,

    templateCode: template.code,
    templateVersion: template.version,
    targetKind: input.targetKind,
    targetId: input.targetId,
    payload: rendered.value.payload,
    payloadHash,
    reason: input.reason,

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

    uniqueness: [],
    document,
  });

  return outcome.ok ? written(outcome.value) : refusal(outcome.error);
}

const targetArgs = {
  requestId: v.string(),
  warehouseId: v.id("warehouses"),
  labelTemplateId: v.id("labelTemplates"),

  targetKind: v.string(),
  targetId: v.string(),
  fields: labelFields,
};

export const generateLabel = mutationWithOrg({
  args: targetArgs,
  returns: writeOutcomeValidator,
  permissionCode: "label.print.execute",
  target: { table: "labelPrintJobs" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) =>
    await generate(ctx, { ...args, reason: "INITIAL" }),
});

export const reprintLabel = mutationWithOrg({
  args: targetArgs,
  returns: writeOutcomeValidator,
  permissionCode: "label.print.reprint",
  target: { table: "labelPrintJobs" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) =>
    await generate(ctx, { ...args, reason: "REPRINT" }),
});

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

export const maxLabelPageSize = MAX_JOB_PAGE_SIZE;
