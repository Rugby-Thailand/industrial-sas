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

/**
 * Explicit bounds for the job-ticket provider call (BD-07). Every attempt,
 * including reading its response body, ends at `attemptTimeoutMs`; all
 * attempts together end at `totalDeadlineMs`. The only retry is one immediate
 * repeat after an HTTP 5xx answer, and only while a useful budget remains: the
 * extraction writes nothing, so a repeat cannot duplicate data, but it can
 * double provider cost. Timeouts, network errors, 4xx/429, oversized and
 * malformed answers are never retried. `maxRetries: 0` is a valid policy.
 */
export interface JobTicketProviderPolicy {
  readonly attemptTimeoutMs: number;
  readonly totalDeadlineMs: number;
  readonly maxRetries: number;
  readonly minRetryBudgetMs: number;
  readonly maxResponseBytes: number;
}

export const JOB_TICKET_PROVIDER_POLICY: JobTicketProviderPolicy =
  Object.freeze({
    attemptTimeoutMs: 40_000,
    totalDeadlineMs: 55_000,
    maxRetries: 1,
    minRetryBudgetMs: 10_000,
    maxResponseBytes: 256 * 1024,
  });

export type JobTicketProviderFailure =
  "timeout" | "network" | "status" | "too_large" | "malformed";

export type JobTicketProviderOutcome =
  | {
      readonly ok: true;
      readonly content: string;
      readonly attempts: number;
      readonly elapsedMs: number;
    }
  | {
      readonly ok: false;
      readonly reason: JobTicketProviderFailure;
      readonly status?: number;
      readonly attempts: number;
      readonly elapsedMs: number;
    };

const ABORTED = Symbol("aborted");
const TOO_LARGE = Symbol("too-large");

/** Settle with ABORTED as soon as `signal` aborts, even if `work` ignores it. */
function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T | typeof ABORTED> {
  if (signal.aborted) {
    work.catch(() => undefined);
    return Promise.resolve(ABORTED);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) resolve(ABORTED);
        else reject(error);
      },
    );
  });
}

function discardBody(response: Response) {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // Already consumed or locked; nothing else to release.
  }
}

/** Read at most `maxBytes` of the body before the attempt deadline. */
async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string | typeof ABORTED | typeof TOO_LARGE> {
  const declared = Number(response.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    discardBody(response);
    return TOO_LARGE;
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await untilAborted(reader.read(), signal);
    if (next === ABORTED) {
      void reader.cancel().catch(() => undefined);
      return ABORTED;
    }
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) {
      void reader.cancel().catch(() => undefined);
      return TOO_LARGE;
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** First choice's message content, "" when absent, or null if not JSON. */
function envelopeContent(text: string): string | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object") return null;
  const content = (body as { choices?: { message?: { content?: unknown } }[] })
    .choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

/**
 * Call the provider through `send` within {@link JobTicketProviderPolicy}.
 * Returns the model's message content or a static failure reason; it never
 * returns or throws the provider's response body.
 */
export async function requestJobTicketProvider(
  send: (signal: AbortSignal) => Promise<Response>,
  options: {
    readonly policy?: JobTicketProviderPolicy;
    readonly now?: () => number;
  } = {},
): Promise<JobTicketProviderOutcome> {
  const policy = options.policy ?? JOB_TICKET_PROVIDER_POLICY;
  const now = options.now ?? Date.now;
  const started = now();
  const elapsed = () => Math.max(0, now() - started);
  // The independent total timer is the hard bound. Wall-clock readings are
  // used only for diagnostics and conservative retry budgeting; clock rollback
  // must never extend the operation. Compose signals without assuming the
  // runtime implements AbortSignal.any.
  const totalController = new AbortController();
  const totalTimer = setTimeout(
    () => totalController.abort(),
    policy.totalDeadlineMs,
  );
  let attempts = 0;
  const fail = (
    reason: JobTicketProviderFailure,
    status?: number,
  ): JobTicketProviderOutcome => ({
    ok: false,
    reason,
    ...(status === undefined ? {} : { status }),
    attempts,
    elapsedMs: elapsed(),
  });
  try {
    for (;;) {
      const budget = Math.min(
        policy.attemptTimeoutMs,
        policy.totalDeadlineMs - elapsed(),
      );
      if (budget <= 0 || totalController.signal.aborted) return fail("timeout");
      attempts += 1;
      const controller = new AbortController();
      const abortAttempt = () => controller.abort();
      totalController.signal.addEventListener("abort", abortAttempt, {
        once: true,
      });
      const timer = setTimeout(() => controller.abort(), budget);
      try {
        let response: Response | typeof ABORTED;
        try {
          response = await untilAborted(
            send(controller.signal),
            controller.signal,
          );
        } catch {
          return fail("network");
        }
        if (response === ABORTED) return fail("timeout");
        if (!response.ok) {
          discardBody(response);
          const retry =
            !totalController.signal.aborted &&
            response.status >= 500 &&
            response.status <= 599 &&
            attempts <= policy.maxRetries &&
            policy.totalDeadlineMs - elapsed() >= policy.minRetryBudgetMs;
          if (retry) continue;
          return fail("status", response.status);
        }
        let text: string | typeof ABORTED | typeof TOO_LARGE;
        try {
          text = await readBoundedBody(
            response,
            policy.maxResponseBytes,
            controller.signal,
          );
        } catch {
          return fail("network");
        }
        if (text === ABORTED) return fail("timeout");
        if (text === TOO_LARGE) return fail("too_large");
        const content = envelopeContent(text);
        if (content === null) return fail("malformed");
        return { ok: true, content, attempts, elapsedMs: elapsed() };
      } finally {
        clearTimeout(timer);
        totalController.signal.removeEventListener("abort", abortAttempt);
      }
    }
  } finally {
    clearTimeout(totalTimer);
  }
}

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
    const send = (signal: AbortSignal) =>
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal,
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
    const outcome = await requestJobTicketProvider(send);
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
          supportPositionId: undefined,
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
