import { customerLinkArg } from "../customers/validators";
import type { ImageProviderOutcome as JobTicketProviderOutcome } from "../lib/imageProvider";
import { requestImageProvider as requestJobTicketProvider } from "../lib/imageProvider";
export {
  IMAGE_PROVIDER_POLICY as JOB_TICKET_PROVIDER_POLICY,
  requestImageProvider as requestJobTicketProvider,
} from "../lib/imageProvider";
export type {
  ImageProviderPolicy as JobTicketProviderPolicy,
  ImageProviderFailure as JobTicketProviderFailure,
  ImageProviderOutcome as JobTicketProviderOutcome,
} from "../lib/imageProvider";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  actionWithOrg,
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { inventoryWriter } from "../lib/inventoryWriter";
import { writeOutcomeValidator } from "../lib/writeEnvelope";
import { command, created, failure, stamp } from "./commands";
import { ATTACHMENT_GRACE_MS } from "./attachments";
import {
  MAX_JOB_SCAN_ITEMS,
  JOB_TICKET_JSON_SCHEMA,
  JOB_TICKET_PROMPT,
  jobTicketError,
  jobTicketDetailError,
  parseJobTicket,
} from "../model/finishedGoods/jobScans";

import { jobLocationReader } from "./jobScanLocations";
import { boundedRecordPage } from "../lib/boundedRecordPage";
import {
  indexableNeedle,
  jobScanNameMatches,
  jobScanSearchIndex,
  jobScanTextMatches,
  normalizeJobScanSearch,
  searchJobScans,
} from "../lib/jobScanSearch";
import { diffFields } from "../lib/masterDataStore";
import { normalizeCustomerName } from "../model/customers/customers";
import {
  customerReviewState,
  recordCustomerJobLink,
  refreshCustomerLatestJob,
} from "../customers/activitySummary";
import {
  autoLinkPaused,
  resolveExactCustomerMatch,
  resolveExplicitCustomerLink,
  type ResolvedExactCustomerMatch,
} from "../customers/matching";
import { canReadCustomers } from "../customers/warehouseScope";
const batchFormat = v.union(
  v.literal("PALLET"),
  v.literal("BOX"),
  v.literal("OTHER"),
);

const READ = "masterData.storageLayout.read";
const MANAGE = "masterData.storageLayout.manage";
const TABLE = "finishedGoodsJobScans";
export const JOB_TICKET_RATE_LIMIT = Object.freeze({
  key: "finishedGoods.jobTicket.ai",
  limit: 20,
  windowMs: 10 * 60_000,
});
const DEFAULT_MODEL = "openai/gpt-6-luna";
const MAX_ITEMS = MAX_JOB_SCAN_ITEMS;
const LIST_LIMIT = 300;

const optionalText = v.optional(v.string());
const optionalNumber = v.optional(v.number());
// Only ticket metadata is editable. Location, provenance and inventory are
// deliberately absent from this validator and the corresponding patch.
const correctionFields = v.object({
  factoryOrder: v.string(),
  productBarcodeText: v.string(),
  deliveryDate: optionalText,
  partName: optionalText,
  customer: optionalText,
  manufacturingDate: optionalText,
  quantity: optionalNumber,
  factoryQuantity: optionalNumber,
  customerQuantity: optionalNumber,
  storageFormat: v.optional(batchFormat),
});
const ticketItem = v.object({
  factoryOrder: v.string(),
  productBarcodeText: v.string(),
  deliveryDate: optionalText,
  partName: optionalText,
  customer: optionalText,
  manufacturingDate: optionalText,
  quantity: optionalNumber,
  factoryQuantity: optionalNumber,
  customerQuantity: optionalNumber,
  storageFormat: v.optional(batchFormat),
  source: v.union(v.literal("AI"), v.literal("BARCODE"), v.literal("MANUAL")),
  imageUrl: optionalText,
  imageAssetId: v.optional(v.id("jobTicketAssets")),
  aiRaw: optionalText,
  aiUsageOperationId: optionalText,
});
const mappedLocation = v.union(
  v.object({ locationId: v.id("locations") }),
  v.object({
    zoneId: v.id("storageZones"),
    supportPositionId: v.optional(v.id("storagePositions")),
  }),
);

const extractedTicketFields = v.object({
  factoryOrder: optionalText,
  productBarcodeText: optionalText,
  deliveryDate: optionalText,
  partName: optionalText,
  customer: optionalText,
  manufacturingDate: optionalText,
  quantity: optionalNumber,
  factoryQuantity: optionalNumber,
  customerQuantity: optionalNumber,
});
const extractionOutcome = v.union(
  v.object({
    ok: v.literal(true),
    mock: v.literal(true),
    fields: extractedTicketFields,
    raw: v.string(),
  }),
  v.object({
    ok: v.literal(true),
    mock: v.literal(false),
    aiUsageOperationId: v.string(),
    fields: extractedTicketFields,
    raw: v.string(),
  }),
  v.object({
    ok: v.literal(false),
    error: v.object({
      code: v.union(
        v.literal("IMAGE_URL_INVALID"),
        v.literal("AI_UNAVAILABLE"),
        v.literal("AI_UNREADABLE"),
      ),
    }),
  }),
  v.object({
    ok: v.literal(false),
    error: v.object({ code: v.literal("RATE_LIMITED") }),
    retryAfterMs: v.number(),
  }),
);

/** Validate the entire selection before either bulk operation writes anything. */
async function validateJobScanSelection(
  ctx: TenantFunctionContext,
  warehouseId: Id<"warehouses">,
  ids: readonly Id<"finishedGoodsJobScans">[],
) {
  if (!ids.length || ids.length > LIST_LIMIT)
    return failure("SCAN_GROUP_SIZE_INVALID");
  for (const id of new Set(ids)) {
    const scan = await ctx.tenantDb.get<Doc<"finishedGoodsJobScans">>(
      TABLE,
      id,
    );
    if (!scan || scan.warehouseId !== warehouseId) return failure("NOT_FOUND");
  }
  return null;
}

/** Resolve and derive all parents on the server; client snapshots are never trusted. */
async function mapLocation(
  ctx: TenantFunctionContext,
  warehouseId: Id<"warehouses">,
  input: { locationId?: string; zoneId?: string; supportPositionId?: string },
) {
  const location = await jobLocationReader(ctx, warehouseId).byId(input);
  if (!location) return null;
  return {
    locationId: location.locationId,
    buildingId: location.buildingId,
    ...(location.floorId ? { floorId: location.floorId } : {}),
    ...(location.zoneId ? { zoneId: location.zoneId } : {}),
    ...(location.supportPositionId
      ? { supportPositionId: location.supportPositionId }
      : {}),
    locationCode: location.code,
    locationName: location.name,
  };
}

/** Reads a job ticket photo with OpenRouter. Sample extraction requires explicit local opt-in. */
export const extractJobTicket = actionWithOrg({
  rateLimit: JOB_TICKET_RATE_LIMIT,
  args: { warehouseId: v.id("warehouses"), imageUrl: v.string() },
  returns: extractionOutcome,
  permissionCode: MANAGE,
  target: { table: TABLE },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args): Promise<Infer<typeof extractionOutcome>> => {
    // An uploaded https URL, or the photo itself as a JPEG data URL (≈1 MB after client resize).
    if (
      !/^(https:\/\/|data:image\/(jpeg|png|webp);base64,)/i.test(
        args.imageUrl,
      ) ||
      args.imageUrl.length > 4_000_000
    )
      return { ok: false as const, error: { code: "IMAGE_URL_INVALID" } };
    if (ctx.quota === undefined || !ctx.quota.allowed)
      return {
        ok: false as const,
        error: { code: "RATE_LIMITED" },
        retryAfterMs: ctx.quota?.retryAfterMs ?? JOB_TICKET_RATE_LIMIT.windowMs,
      };
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      if (
        process.env.NODE_ENV === "production" ||
        process.env.JOB_SCAN_DEMO_AI !== "1"
      )
        return { ok: false as const, error: { code: "AI_UNAVAILABLE" } };
      const sample = {
        factory_order: "FO69070073",
        delivery_date: "6/7/2569",
        part_name: "VMI BOX TRAY BXVMI004 Rev.02",
        customer: "บริษัท ฟาบริเนท จำกัด (สำนักงานใหญ่)",
        manufacturing_date: "27/7/2569",
        quantity: 1000,
        factory_quantity: 1000,
        customer_quantity: 1000,
        product_barcode_text: "FBN-BXVMI004-BOX-00F",
      };
      return {
        ok: true as const,
        mock: true,
        fields: parseJobTicket(sample),
        raw: JSON.stringify(sample),
      };
    }
    const model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
    const send = (signal: AbortSignal) =>
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: "system", content: JOB_TICKET_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "Extract information from this image" },
                { type: "image_url", image_url: { url: args.imageUrl } },
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "job_ticket",
              strict: true,
              schema: JOB_TICKET_JSON_SCHEMA,
            },
          },
        }),
      });
    let outcome: JobTicketProviderOutcome;
    try {
      outcome = await requestJobTicketProvider(send, {
        tracking: { port: ctx.aiUsage, feature: "JOB_TICKET_SCAN", model },
        validateContent: (content) => {
          try {
            parseJobTicket(
              JSON.parse(content.replace(/^```(?:json)?|```$/gm, "")),
            );
            return true;
          } catch {
            return false;
          }
        },
      });
    } catch {
      return { ok: false as const, error: { code: "AI_UNAVAILABLE" } };
    }
    if (!outcome.ok) {
      // Static fields only: never the provider body, ticket image, extracted
      // customer/code text, model output or credentials.
      console.error(
        JSON.stringify({
          event: "jobScan.provider.unavailable",
          reason: outcome.reason,
          ...(outcome.status === undefined ? {} : { status: outcome.status }),
          attempts: outcome.attempts,
          elapsedMs: outcome.elapsedMs,
        }),
      );
      return { ok: false as const, error: { code: "AI_UNAVAILABLE" } };
    }
    try {
      const json = JSON.parse(
        outcome.content.replace(/^```(?:json)?|```$/gm, ""),
      );
      return {
        ok: true as const,
        mock: false,
        aiUsageOperationId: ctx.requestId,
        fields: parseJobTicket(json),
        raw: JSON.stringify(json),
      };
    } catch {
      console.warn(
        JSON.stringify({
          event: "jobScan.provider.unreadable",
          attempts: outcome.attempts,
          elapsedMs: outcome.elapsedMs,
        }),
      );
      return { ok: false as const, error: { code: "AI_UNREADABLE" } };
    }
  },
});

export const saveJobScans = mutationWithOrg({
  writer: inventoryWriter,
  args: {
    warehouseId: v.id("warehouses"),
    requestId: v.string(),
    locationText: v.string(),
    location: v.optional(mappedLocation),
    items: v.array(ticketItem),
  },
  returns: writeOutcomeValidator,
  permissionCode: MANAGE,
  target: { table: TABLE },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) =>
    command(ctx, args, "finishedGoods.jobScan.save", TABLE, async () => {
      if (!args.items.length || args.items.length > MAX_ITEMS)
        return failure("SCAN_GROUP_SIZE_INVALID");
      for (const item of args.items) {
        const error = jobTicketError(item);
        if (error) return failure(error);
        const detailError = jobTicketDetailError(item);
        if (detailError) return failure(detailError.code, detailError.field);
      }
      // Validate the whole group before any insert or attachment transition.
      const assets = new Map<string, Doc<"jobTicketAssets">>();
      for (const item of args.items) {
        if (item.imageUrl && !item.imageAssetId)
          return failure("ATTACHMENT_INVALID");
        if (!item.imageAssetId) continue;
        const asset = await ctx.tenantDb.get<Doc<"jobTicketAssets">>(
          "jobTicketAssets",
          item.imageAssetId,
        );
        if (
          !asset ||
          asset.warehouseId !== args.warehouseId ||
          asset.createdByUserId !== ctx.tenant.actor._id ||
          asset.state !== "READY" ||
          asset.expiresAt <= Date.now() ||
          !asset.url ||
          assets.has(asset._id) ||
          (item.imageUrl && item.imageUrl !== asset.url)
        )
          return failure("ATTACHMENT_INVALID");
        assets.set(asset._id, asset);
      }
      const linked = new Set<string>();
      for (const item of args.items) {
        if (!item.aiUsageOperationId) continue;
        const op = await ctx.tenantDb
          .byIndex<Doc<"aiUsageOperations">>(
            "aiUsageOperations",
            "by_orgId_operationId",
            [{ field: "operationId", value: item.aiUsageOperationId }],
          )
          .unique();
        if (
          item.source !== "AI" ||
          !op ||
          op.feature !== "JOB_TICKET_SCAN" ||
          op.actorUserId !== ctx.tenant.actor._id ||
          op.warehouseId !== args.warehouseId ||
          op.jobScanId ||
          linked.has(op.operationId)
        )
          return failure("AI_USAGE_LINK_INVALID");
        linked.add(op.operationId);
      }
      const mapped = args.location
        ? await mapLocation(ctx, args.warehouseId, args.location)
        : null;
      if (args.location && !mapped) return failure("LOCATION_UNAVAILABLE");
      const locationText = (
        args.locationText.trim() ||
        mapped?.locationCode ||
        ""
      ).slice(0, 200);
      if (!locationText && !mapped) return failure("LOCATION_REQUIRED");
      let firstId = "";
      const customerMatches = new Map<string, ResolvedExactCustomerMatch>();
      for (const item of args.items) {
        const matchText = item.customer?.trim();
        let customerLink: {
          customerId?: Id<"customers">;
          customerLinkSource?: "AUTO";
        } = {};
        if (matchText && !autoLinkPaused()) {
          const key = normalizeCustomerName(matchText);
          let match = customerMatches.get(key);
          if (!match) {
            match = await resolveExactCustomerMatch(ctx.tenantDb, matchText);
            customerMatches.set(key, match);
          }
          if (match.kind === "MATCHED") {
            customerLink = {
              customerId: match.customerId,
              customerLinkSource: "AUTO",
            };
          }
        }
        // Every live save is classified, so blank tickets never enter the
        // legacy review stream and named unmatched ones enter the indexed one.
        const reviewPending = customerReviewState({
          customer: item.customer,
          ...customerLink,
        });
        const stamps = created(ctx);
        const factoryOrder = item.factoryOrder.trim();
        const id = (await ctx.tenantDb.insert(TABLE, {
          ...item,
          ...customerLink,
          ...(reviewPending === undefined
            ? {}
            : { customerReviewPending: reviewPending }),
          imageUrl: item.imageAssetId
            ? assets.get(item.imageAssetId)!.url
            : undefined,
          factoryOrder,
          productBarcodeText: item.productBarcodeText.trim(),
          warehouseId: args.warehouseId,
          locationText,
          mapped: Boolean(mapped),
          ...(mapped ?? {}),
          ...stamps,
        })) as Id<"finishedGoodsJobScans">;
        if (customerLink.customerId) {
          await recordCustomerJobLink(
            ctx.tenantDb,
            args.warehouseId,
            customerLink.customerId,
            {
              jobScanId: id,
              factoryOrder,
              createdAt: stamps.createdAt,
            },
          );
        }
        if (item.imageAssetId)
          await ctx.tenantDb.patch("jobTicketAssets", item.imageAssetId, {
            state: "ATTACHED",
            jobScanId: id,
          });
        if (item.aiUsageOperationId) {
          const op = await ctx.tenantDb
            .byIndex<Doc<"aiUsageOperations">>(
              "aiUsageOperations",
              "by_orgId_operationId",
              [{ field: "operationId", value: item.aiUsageOperationId }],
            )
            .unique();
          await ctx.tenantDb.patch("aiUsageOperations", op!._id, {
            jobScanId: id,
          });
        }
        firstId ||= id;
      }
      return { documentId: firstId };
    }),
});

export const updateJobScan = mutationWithOrg({
  writer: inventoryWriter,
  args: {
    warehouseId: v.id("warehouses"),
    jobScanId: v.id("finishedGoodsJobScans"),
    requestId: v.string(),
    expectedVersion: v.number(),
    fields: correctionFields,
    customerLink: v.optional(customerLinkArg),
  },
  returns: writeOutcomeValidator,
  permissionCode: MANAGE,
  target: { table: TABLE },
  warehouseId: (args) => args.warehouseId,
  handler: (ctx, args) =>
    command(ctx, args, "finishedGoods.jobScan.correct", TABLE, async () => {
      const before = await ctx.tenantDb.get<Doc<"finishedGoodsJobScans">>(
        TABLE,
        args.jobScanId,
      );
      if (!before || before.warehouseId !== args.warehouseId || before.voided)
        return failure("NOT_FOUND");
      const version = before.version ?? 1;
      if (
        !Number.isSafeInteger(args.expectedVersion) ||
        args.expectedVersion !== version
      )
        return failure("STALE_REVISION");
      const error = jobTicketError(args.fields);
      if (error) return failure(error);
      const detailError = jobTicketDetailError(args.fields);
      if (detailError) return failure(detailError.code, detailError.field);
      const submittedCustomerText = args.fields.customer;
      const nextCustomerText =
        submittedCustomerText?.trim() === before.customer?.trim()
          ? before.customer
          : submittedCustomerText?.trim() || undefined;
      const explicit = await resolveExplicitCustomerLink(
        ctx,
        args.customerLink,
        before,
      );
      if (!explicit.ok) return failure(explicit.code, "customerId");
      let {
        customerId: nextCustomerId,
        customerLinkSource: nextCustomerLinkSource,
      } = explicit;
      if (
        (!args.customerLink || args.customerLink.action === "KEEP") &&
        nextCustomerText !== before.customer &&
        before.customerLinkSource !== "MANUAL" &&
        before.customerLinkSource !== "UNLINKED"
      ) {
        const match = autoLinkPaused()
          ? { kind: "UNMATCHED" as const }
          : await resolveExactCustomerMatch(ctx.tenantDb, nextCustomerText);
        if (match.kind === "MATCHED") {
          nextCustomerId = match.customerId;
          nextCustomerLinkSource = "AUTO";
        } else {
          nextCustomerId = undefined;
          nextCustomerLinkSource = undefined;
        }
      }
      const nextReviewPending = customerReviewState({
        voided: before.voided,
        customer: nextCustomerText,
        customerId: nextCustomerId,
        customerLinkSource: nextCustomerLinkSource,
      });
      // Materialize optional fields so deleting an old value is intentional,
      // version-checked and included in the immutable audit event.
      const fields = {
        factoryOrder: args.fields.factoryOrder.trim(),
        productBarcodeText: args.fields.productBarcodeText.trim(),
        partName: args.fields.partName?.trim() || undefined,
        customer: nextCustomerText,
        customerId: nextCustomerId,
        customerLinkSource: nextCustomerLinkSource,
        deliveryDate: args.fields.deliveryDate?.trim() || undefined,
        manufacturingDate: args.fields.manufacturingDate?.trim() || undefined,
        quantity: args.fields.quantity,
        factoryQuantity: args.fields.factoryQuantity,
        customerQuantity: args.fields.customerQuantity,
        storageFormat: args.fields.storageFormat,
      };
      const changes = diffFields(before, fields);
      if (
        !changes.length &&
        before.customerReviewPending !== nextReviewPending
      ) {
        // Classification only: no correction, so open editors stay current.
        await ctx.tenantDb.patch(TABLE, before._id, {
          customerReviewPending: nextReviewPending,
        });
      } else if (changes.length) {
        const now = Math.max(Date.now(), before.updatedAt + 1);
        await ctx.tenantDb.patch(TABLE, before._id, {
          ...fields,
          customerReviewPending: nextReviewPending,
          version: version + 1,
          correctedAt: now,
          correctedByUserId: ctx.tenant.actor._id,
          updatedAt: now,
          updatedByUserId: ctx.tenant.actor._id,
        });
        if (before.customerId && before.customerId !== nextCustomerId) {
          await refreshCustomerLatestJob(
            ctx.tenantDb,
            args.warehouseId,
            before.customerId,
          );
        }
        if (
          nextCustomerId &&
          (before.customerId !== nextCustomerId ||
            before.factoryOrder !== fields.factoryOrder)
        ) {
          await refreshCustomerLatestJob(
            ctx.tenantDb,
            args.warehouseId,
            nextCustomerId,
          );
        }
      }
      return { documentId: before._id, changes };
    }),
});

/**
 * Recent corrections are read independently from the inventory and location,
 * with the record's current editable values.
 */
export const listJobScanCorrections = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    jobScanId: v.id("finishedGoodsJobScans"),
  },
  permissionCode: READ,
  target: { table: TABLE },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const record = await ctx.tenantDb.get<Doc<"finishedGoodsJobScans">>(
      TABLE,
      args.jobScanId,
    );
    if (!record || record.warehouseId !== args.warehouseId) return null;
    const history = await ctx.tenantDb
      .byIndex<Doc<"auditEvents">>(
        "auditEvents",
        "by_orgId_entityTable_entityId_occurredAt",
        [
          { field: "entityTable", value: TABLE },
          { field: "entityId", value: record._id },
        ],
      )
      .page({ limit: 50, order: "desc" });
    const allowCustomerRead = await canReadCustomers(ctx);
    const linkedCustomer =
      allowCustomerRead && record.customerId
        ? await ctx.tenantDb.get<Doc<"customers">>(
            "customers",
            record.customerId,
          )
        : null;
    const customerLinkAuditFields = new Set([
      "customerId",
      "customerLinkSource",
    ]);
    return {
      complete: history.isDone,
      items: history.page
        .filter(
          (event) =>
            event.action === "finishedGoods.jobScan.correct" &&
            event.outcome === "ALLOWED" &&
            event.warehouseId === args.warehouseId,
        )
        .map((event) => {
          const visibleChanges = allowCustomerRead
            ? (event.changes ?? [])
            : (event.changes ?? []).filter(
                (change) => !customerLinkAuditFields.has(change.field),
              );
          return {
            id: event._id,
            at: event.occurredAt,
            actorUserId: event.actorUserId,
            changes: visibleChanges,
          };
        })
        .filter((item) => item.changes.length > 0),
      // The correction editor's live baseline: the list row stops updating
      // once another session moves the record off the visible page.
      current: {
        version: record.version ?? 1,
        factoryOrder: record.factoryOrder,
        productBarcodeText: record.productBarcodeText,
        partName: record.partName,
        customer: record.customer,
        ...(allowCustomerRead && record.customerId !== undefined
          ? { customerId: record.customerId }
          : {}),
        ...(allowCustomerRead && record.customerLinkSource !== undefined
          ? { customerLinkSource: record.customerLinkSource }
          : {}),
        ...(allowCustomerRead && linkedCustomer?.name !== undefined
          ? { customerName: linkedCustomer.name }
          : {}),
        ...(allowCustomerRead && linkedCustomer?.code !== undefined
          ? { customerCode: linkedCustomer.code }
          : {}),
        deliveryDate: record.deliveryDate,
        manufacturingDate: record.manufacturingDate,
        quantity: record.quantity,
        factoryQuantity: record.factoryQuantity,
        customerQuantity: record.customerQuantity,
        storageFormat: record.storageFormat,
      },
    };
  },
});

export const assignJobScanLocation = mutationWithOrg({
  writer: inventoryWriter,
  args: {
    warehouseId: v.id("warehouses"),
    requestId: v.string(),
    ids: v.array(v.id("finishedGoodsJobScans")),
    // Optional only for clients predating the review step. New clients send
    // the complete reviewed selection, checked atomically before any write.
    expectedVersions: v.optional(
      v.array(
        v.object({ id: v.id("finishedGoodsJobScans"), version: v.number() }),
      ),
    ),
    location: mappedLocation,
  },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: TABLE },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) =>
    command(ctx, args, "finishedGoods.jobScan.assign", TABLE, async () => {
      const invalidSelection = await validateJobScanSelection(
        ctx,
        args.warehouseId,
        args.ids,
      );
      if (invalidSelection) return invalidSelection;
      if (args.expectedVersions) {
        const versions = new Map(
          args.expectedVersions.map((item) => [item.id, item.version]),
        );
        const selected = new Set(args.ids);
        if (
          versions.size !== selected.size ||
          versions.size !== args.expectedVersions.length
        )
          return failure("STALE_REVISION");
        for (const id of selected) {
          const expected = versions.get(id);
          const record = await ctx.tenantDb.get<Doc<"finishedGoodsJobScans">>(
            TABLE,
            id,
          );
          if (
            !record ||
            !Number.isSafeInteger(expected) ||
            expected !== (record.version ?? 1)
          )
            return failure("STALE_REVISION");
        }
      }
      const mapped = await mapLocation(ctx, args.warehouseId, args.location);
      if (!mapped) return failure("LOCATION_UNAVAILABLE");
      for (const id of new Set(args.ids)) {
        const before = await ctx.tenantDb.get<Doc<"finishedGoodsJobScans">>(
          TABLE,
          id,
        );
        if (!before) return failure("NOT_FOUND");
        await ctx.tenantDb.patch(TABLE, id, {
          mapped: true,
          zoneId: undefined,
          supportPositionId: undefined,
          floorId: undefined,
          ...mapped,
          ...stamp(ctx),
          version: (before.version ?? 1) + 1,
          updatedAt: Math.max(Date.now(), before.updatedAt + 1),
        });
      }
      return { documentId: args.ids[0]! };
    }),
});

export const deleteJobScans = mutationWithOrg({
  writer: inventoryWriter,
  args: {
    warehouseId: v.id("warehouses"),
    requestId: v.string(),
    ids: v.array(v.id("finishedGoodsJobScans")),
  },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: TABLE },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) =>
    command(ctx, args, "finishedGoods.jobScan.delete", TABLE, async () => {
      const invalidSelection = await validateJobScanSelection(
        ctx,
        args.warehouseId,
        args.ids,
      );
      if (invalidSelection) return invalidSelection;
      const ids = [...new Set(args.ids)];
      const affectedCustomers = new Set<Id<"customers">>();
      for (const id of ids) {
        const scan = await ctx.tenantDb.get<Doc<"finishedGoodsJobScans">>(
          TABLE,
          id,
        );
        if (scan?.customerId) affectedCustomers.add(scan.customerId);
        if (scan?.imageAssetId) {
          const asset = await ctx.tenantDb.get<Doc<"jobTicketAssets">>(
            "jobTicketAssets",
            scan.imageAssetId,
          );
          if (asset?.jobScanId === id)
            await ctx.tenantDb.patch("jobTicketAssets", asset._id, {
              state: "READY",
              jobScanId: undefined,
              expiresAt: Date.now() + ATTACHMENT_GRACE_MS,
            });
        }
        await ctx.tenantDb.delete(TABLE, id);
      }
      for (const customerId of affectedCustomers) {
        await refreshCustomerLatestJob(
          ctx.tenantDb,
          args.warehouseId,
          customerId,
        );
      }
      return { documentId: ids[0]! };
    }),
});

export const listJobScans = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    filter: v.union(
      v.literal("ALL"),
      v.literal("MAPPED"),
      v.literal("UNMAPPED"),
    ),
    search: v.optional(v.string()),
    cursor: v.optional(v.union(v.string(), v.null())),
    /**
     * Current clients opt into `scanning` progress. Without it each response
     * is a complete, possibly short page, as clients before this field expect.
     */
    progressive: v.optional(v.boolean()),
    /** Continuation of a page whose bounded scan has not filled it yet. */
    scanCursor: v.optional(v.string()),
    /** Client retry identity: a new value opens a fresh subscription. Ignored. */
    attempt: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  returns: v.any(),
  permissionCode: READ,
  target: { table: TABLE },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const reader =
      args.filter === "ALL"
        ? ctx.tenantDb.byIndex<Doc<"finishedGoodsJobScans">>(
            TABLE,
            "by_orgId_warehouseId_createdAt",
            [{ field: "warehouseId", value: args.warehouseId }],
          )
        : ctx.tenantDb.byIndex<Doc<"finishedGoodsJobScans">>(
            TABLE,
            "by_orgId_warehouseId_mapped_createdAt",
            [
              { field: "warehouseId", value: args.warehouseId },
              { field: "mapped", value: args.filter === "MAPPED" },
            ],
          );
    const pageSize = Math.min(
      Math.max(1, Math.floor(args.pageSize ?? 20)),
      100,
    );
    const needle = normalizeJobScanSearch(args.search ?? "");
    const allowCustomerRead = await canReadCustomers(ctx);
    // Parents are shared by many records: read each once per request.
    const cached = new Map<string, Promise<unknown>>();
    const parent = <T>(
      table:
        "storageZones" | "storageBuildings" | "storageFloors" | "customers",
      id: string | undefined,
    ): Promise<T | null> => {
      if (!id) return Promise.resolve(null);
      const key = `${table}:${id}`;
      if (!cached.has(key)) cached.set(key, ctx.tenantDb.get<never>(table, id));
      return cached.get(key) as Promise<T | null>;
    };
    const parents = async (scan: Doc<"finishedGoodsJobScans">) => {
      const zone = scan.buildingId
        ? null
        : await parent<Doc<"storageZones">>("storageZones", scan.zoneId);
      const [building, floor] = await Promise.all([
        parent<Doc<"storageBuildings">>(
          "storageBuildings",
          scan.buildingId ?? zone?.buildingId,
        ),
        parent<Doc<"storageFloors">>(
          "storageFloors",
          scan.floorId ?? zone?.floorId,
        ),
      ]);
      return {
        building: building?.warehouseId === args.warehouseId ? building : null,
        floor: floor?.warehouseId === args.warehouseId ? floor : null,
      };
    };
    const accept = async (scan: Doc<"finishedGoodsJobScans">) => {
      if (
        scan.warehouseId !== args.warehouseId ||
        (args.filter !== "ALL" && scan.mapped !== (args.filter === "MAPPED"))
      )
        return false;
      if (!needle) return true;
      if (jobScanTextMatches(scan, needle)) return true;
      const { building } = await parents(scan);
      return Boolean(building && jobScanNameMatches(building.name, needle));
    };
    const hydrate = (records: Doc<"finishedGoodsJobScans">[]) =>
      Promise.all(records.map(view));
    // Needles of 3+ code points: trigram postings propose candidates in
    // newest-first order; each is re-read and matched by `accept`, exactly as
    // the scan below would. Unready warehouses and short needles keep it.
    const index =
      needle && indexableNeedle(needle)
        ? await jobScanSearchIndex(ctx.tenantDb, args.warehouseId)
        : null;
    if (index)
      return searchJobScans(ctx, {
        warehouseId: args.warehouseId,
        readiness: index,
        filter: args.filter,
        needle,
        pageSize,
        cursor: args.cursor,
        scanCursor: args.scanCursor,
        progressive: args.progressive === true,
        accept,
        hydrate,
      });
    // Otherwise text search inspects history in bounded chunks with a stable
    // cursor instead of re-reading all of it.
    return boundedRecordPage(ctx, {
      scope: ["finishedGoodsJobScans", args.warehouseId, args.filter, needle],
      pageSize,
      cursor: args.cursor,
      scanCursor: args.scanCursor,
      filtering: Boolean(needle),
      acceptNativeCursor: true,
      progressive: args.progressive === true,
      read: (range, limit) =>
        reader.page({
          limit,
          order: "desc",
          ...(range.raw ? { cursor: range.raw } : {}),
          ...(range.end ? { endCursor: range.end } : {}),
        }),
      get: async (id) => {
        const scan = await ctx.tenantDb.get<Doc<"finishedGoodsJobScans">>(
          TABLE,
          id,
        );
        return scan ?? null;
      },
      accept,
      hydrate,
    });
    async function view(scan: Doc<"finishedGoodsJobScans">) {
      const [{ building, floor }, linkedCustomer] = await Promise.all([
        parents(scan),
        allowCustomerRead && scan.customerId
          ? parent<Doc<"customers">>("customers", scan.customerId)
          : Promise.resolve(null),
      ]);
      return {
        id: scan._id,
        factoryOrder: scan.factoryOrder,
        productBarcodeText: scan.productBarcodeText,
        partName: scan.partName,
        customer: scan.customer,
        ...(allowCustomerRead && scan.customerId !== undefined
          ? { customerId: scan.customerId }
          : {}),
        ...(allowCustomerRead && scan.customerLinkSource !== undefined
          ? { customerLinkSource: scan.customerLinkSource }
          : {}),
        ...(allowCustomerRead && linkedCustomer?.name !== undefined
          ? { customerName: linkedCustomer.name }
          : {}),
        ...(allowCustomerRead && linkedCustomer?.code !== undefined
          ? { customerCode: linkedCustomer.code }
          : {}),
        deliveryDate: scan.deliveryDate,
        manufacturingDate: scan.manufacturingDate,
        quantity: scan.quantity,
        factoryQuantity: scan.factoryQuantity,
        customerQuantity: scan.customerQuantity,
        source: scan.source,
        imageUrl: scan.imageUrl,
        locationText: scan.locationText,
        mapped: scan.mapped,
        storageFormat: scan.storageFormat,
        buildingName: building?.name,
        floorNumber: floor?.floorNumber,
        locationCode: scan.locationCode,
        locationName: scan.locationName,
        createdAt: scan.createdAt,
        updatedAt: scan.updatedAt,
        version: scan.version ?? 1,
      };
    }
  },
});

export { normalizeJobScanSearch, jobScanTextMatches };
