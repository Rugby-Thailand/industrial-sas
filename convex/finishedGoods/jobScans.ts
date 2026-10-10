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
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  actionWithOrg,
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { command, created, failure, rows, stamp } from "./workflow";
import {
  JOB_TICKET_JSON_SCHEMA,
  JOB_TICKET_PROMPT,
  jobTicketError,
  parseJobTicket,
} from "../model/finishedGoods/jobScans";

import { jobLocationReader } from "./jobScanLocations";
const batchFormat = v.union(
  v.literal("PALLET"),
  v.literal("BOX"),
  v.literal("OTHER"),
);

const READ = "masterData.storageLayout.read";
const MANAGE = "masterData.storageLayout.manage";
const TABLE = "finishedGoodsJobScans";
const DEFAULT_MODEL = "openai/gpt-6-luna";
const MAX_ITEMS = 50;
const LIST_LIMIT = 300;
const LOCATION_PAGE_SIZE = 10;

const optionalText = v.optional(v.string());
const optionalNumber = v.optional(v.number());
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

export const searchLocations = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    text: v.string(),
    page: v.optional(v.number()),
  },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "storageZones" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const needle = args.text.trim().toUpperCase();
    const zones = await rows<Doc<"storageZones">>(
      ctx,
      "storageZones",
      "by_orgId_warehouseId_code",
      [{ field: "warehouseId", value: args.warehouseId }],
    );
    const matches = zones.filter(
      (zone) =>
        zone.status === "ACTIVE" &&
        (!needle ||
          zone.code.toUpperCase().includes(needle) ||
          zone.label.toUpperCase().includes(needle)),
    );
    const pages = Math.max(1, Math.ceil(matches.length / LOCATION_PAGE_SIZE));
    const page = Math.min(Math.max(1, Math.floor(args.page ?? 1)), pages);
    return {
      page,
      pages,
      total: matches.length,
      items: matches
        .slice((page - 1) * LOCATION_PAGE_SIZE, page * LOCATION_PAGE_SIZE)
        .map((zone) => ({
          zoneId: zone._id,
          code: zone.code,
          name: zone.label,
        })),
    };
  },
});

/** Reads a job ticket photo with OpenRouter. Sample extraction requires explicit local opt-in. */
export const extractJobTicket = actionWithOrg({
  args: { warehouseId: v.id("warehouses"), imageUrl: v.string() },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: TABLE },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    // An uploaded https URL, or the photo itself as a JPEG data URL (≈1 MB after client resize).
    if (
      !/^(https:\/\/|data:image\/(jpeg|png|webp);base64,)/i.test(
        args.imageUrl,
      ) ||
      args.imageUrl.length > 4_000_000
    )
      return { ok: false as const, error: { code: "IMAGE_URL_INVALID" } };
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
        usage: ctx.aiUsage,
        model,
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
  args: {
    warehouseId: v.id("warehouses"),
    requestId: v.string(),
    locationText: v.string(),
    location: v.optional(mappedLocation),
    items: v.array(ticketItem),
  },
  returns: v.any(),
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
      for (const item of args.items) {
        const id = await ctx.tenantDb.insert(TABLE, {
          ...item,
          factoryOrder: item.factoryOrder.trim(),
          productBarcodeText: item.productBarcodeText.trim(),
          warehouseId: args.warehouseId,
          locationText,
          mapped: Boolean(mapped),
          ...(mapped ?? {}),
          ...created(ctx),
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

export const assignJobScanLocation = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    requestId: v.string(),
    ids: v.array(v.id("finishedGoodsJobScans")),
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
      const mapped = await mapLocation(ctx, args.warehouseId, args.location);
      if (!mapped) return failure("LOCATION_UNAVAILABLE");
      for (const id of new Set(args.ids))
        await ctx.tenantDb.patch(TABLE, id, {
          mapped: true,
          zoneId: undefined,
          supportPositionId: undefined,
          floorId: undefined,
          ...mapped,
          ...stamp(ctx),
        });
      return { documentId: args.ids[0]! };
    }),
});

export const deleteJobScans = mutationWithOrg({
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
      for (const id of ids) await ctx.tenantDb.delete(TABLE, id);
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
    const needle = args.search?.trim().toUpperCase();
    let records: readonly Doc<"finishedGoodsJobScans">[];
    let continueCursor = "";
    let isDone = true;
    if (needle) {
      // No text index yet: search scans the warehouse history (≤10k rows) and pages by offset.
      const matches = [...(await reader.all(10_000))]
        .reverse()
        .filter((scan) =>
          [
            scan.factoryOrder,
            scan.productBarcodeText,
            scan.partName,
            scan.locationText,
            scan.locationCode,
          ].some((value) => value?.toUpperCase().includes(needle)),
        );
      const offset = Math.max(0, Number(args.cursor ?? 0) || 0);
      records = matches.slice(offset, offset + pageSize);
      isDone = offset + pageSize >= matches.length;
      continueCursor = isDone ? "" : String(offset + pageSize);
    } else {
      const page = await reader.page({
        limit: pageSize,
        order: "desc",
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      records = page.page;
      isDone = page.isDone;
      continueCursor = page.continueCursor;
    }
    const items = await Promise.all(
      records.map(async (scan) => {
        const zone =
          !scan.buildingId && scan.zoneId
            ? await ctx.tenantDb.get<Doc<"storageZones">>(
                "storageZones",
                scan.zoneId,
              )
            : null;
        const buildingId = scan.buildingId ?? zone?.buildingId;
        const floorId = scan.floorId ?? zone?.floorId;
        const building = buildingId
          ? await ctx.tenantDb.get<Doc<"storageBuildings">>(
              "storageBuildings",
              buildingId,
            )
          : null;
        const floor = floorId
          ? await ctx.tenantDb.get<Doc<"storageFloors">>(
              "storageFloors",
              floorId,
            )
          : null;
        return {
          id: scan._id,
          factoryOrder: scan.factoryOrder,
          productBarcodeText: scan.productBarcodeText,
          partName: scan.partName,
          customer: scan.customer,
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
        };
      }),
    );
    return { items, continueCursor, isDone };
  },
});
