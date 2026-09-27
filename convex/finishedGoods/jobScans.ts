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
  source: v.union(v.literal("AI"), v.literal("BARCODE"), v.literal("MANUAL")),
  imageUrl: optionalText,
  aiRaw: optionalText,
});
const mappedLocation = v.object({
  zoneId: v.id("storageZones"),
  supportPositionId: v.optional(v.id("storagePositions")),
});

/** Zone (or one of its positions) in this warehouse, or null when unusable. */
async function mapLocation(
  ctx: TenantFunctionContext,
  warehouseId: Id<"warehouses">,
  location: { zoneId: string; supportPositionId?: string | undefined },
) {
  const zone = await ctx.tenantDb.get<Doc<"storageZones">>(
    "storageZones",
    location.zoneId,
  );
  if (!zone || zone.warehouseId !== warehouseId || zone.status !== "ACTIVE")
    return null;
  if (!location.supportPositionId)
    return {
      zoneId: zone._id,
      locationCode: zone.code,
      locationName: zone.label,
    };
  const position = await ctx.tenantDb.get<Doc<"storagePositions">>(
    "storagePositions",
    location.supportPositionId,
  );
  if (!position || position.zoneId !== zone._id || position.status !== "ACTIVE")
    return null;
  return {
    zoneId: zone._id,
    supportPositionId: position._id,
    locationCode: position.code,
    locationName: position.label,
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
  handler: async (_ctx, args) => {
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
    const request = () =>
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL,
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
    // OpenRouter occasionally answers 5xx under load; one retry clears most of them.
    let response = await request();
    if (response.status >= 500) response = await request();
    if (!response.ok) {
      console.error(
        "OpenRouter failed",
        response.status,
        (await response.text()).slice(0, 300),
      );
      return { ok: false as const, error: { code: "AI_UNAVAILABLE" } };
    }
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content ?? "";
    try {
      const json = JSON.parse(content.replace(/^```(?:json)?|```$/gm, ""));
      return {
        ok: true as const,
        mock: false,
        fields: parseJobTicket(json),
        raw: JSON.stringify(json),
      };
    } catch {
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
      if (!args.ids.length || args.ids.length > LIST_LIMIT)
        return failure("SCAN_GROUP_SIZE_INVALID");
      const mapped = await mapLocation(ctx, args.warehouseId, args.location);
      if (!mapped) return failure("LOCATION_UNAVAILABLE");
      for (const id of args.ids) {
        const scan = await ctx.tenantDb.get<Doc<"finishedGoodsJobScans">>(
          TABLE,
          id,
        );
        if (!scan || scan.warehouseId !== args.warehouseId)
          return failure("NOT_FOUND");
      }
      for (const id of args.ids)
        await ctx.tenantDb.patch(TABLE, id, {
          mapped: true,
          supportPositionId: undefined,
          ...mapped,
          ...stamp(ctx),
        });
      return { documentId: args.ids[0]! };
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
    const items = records.map((scan) => ({
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
      locationCode: scan.locationCode,
      locationName: scan.locationName,
      createdAt: scan.createdAt,
    }));
    return { items, continueCursor, isDone };
  },
});
