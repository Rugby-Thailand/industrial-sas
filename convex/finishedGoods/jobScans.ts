import { customerLinkArg } from "../customers/validators";
import type {
  ImageProviderOutcome as JobTicketProviderOutcome,
  ImageProviderPolicy,
} from "../lib/imageProvider";
import {
  imageProviderRequest,
  requestImageProvider as requestJobTicketProvider,
  strictOpenRouterChatAdapter,
} from "../lib/imageProvider";
import { OPENROUTER_CHAT_URL } from "../lib/searchProvider";
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
  type TenantActionFunctionContext,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { inventoryWriter } from "../lib/inventoryWriter";
import { normalizeCode } from "../model/identifiers/normalization";
import { writeOutcomeValidator } from "../lib/writeEnvelope";
import { command, created, failure, stamp } from "./commands";
import { ATTACHMENT_GRACE_MS } from "./attachments";
import {
  MAX_JOB_SCAN_AI_CONTENT_LENGTH,
  MAX_JOB_SCAN_ITEMS,
  JOB_TICKET_JSON_SCHEMA,
  JOB_TICKET_PROMPT,
  isSavedFactoryOrderCode,
  isSavedLocationAddress,
  jobScanEditRequestBody,
  jobScanSearchRequestBody,
  jobTicketError,
  jobTicketDetailError,
  parseJobScanEditContent,
  parseJobScanSearchContent,
  parseJobTicket,
  validJobScanAiPrompt,
  type JobScanInterpretResult,
} from "../model/finishedGoods/jobScans";

import {
  jobLocationReader,
  normalizeJobLocationCode,
} from "./jobScanLocations";
import { boundedRecordPage } from "../lib/boundedRecordPage";
import {
  indexableNeedle,
  jobScanExactCodeMatches,
  normalizeJobScanLocationScan,
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
const MAX_ITEMS = MAX_JOB_SCAN_ITEMS;
const LIST_LIMIT = 300;

const optionalText = v.optional(v.string());
const optionalNumber = v.optional(v.number());
// Ticket fields do not carry location or provenance. A reviewed destination,
// if supplied, is resolved separately inside the same correction command.
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
  // Keep the legacy outcome in client types for backend rollbacks.
  v.object({
    ok: v.literal(false),
    error: v.object({ code: v.literal("RATE_LIMITED") }),
    retryAfterMs: v.number(),
  }),
);

export const JOB_SCAN_AI_PROVIDER_POLICY: ImageProviderPolicy = Object.freeze({
  attemptTimeoutMs: 12_000,
  totalDeadlineMs: 12_000,
  maxRetries: 0,
  minRetryBudgetMs: 0,
  maxResponseBytes: 64 * 1024,
});

export const JOB_SCAN_SEARCH_AI_RATE_LIMIT = Object.freeze({
  key: "finishedGoods.jobScanSearch.ai",
  limit: 30,
  windowMs: 10 * 60_000,
});

export const JOB_SCAN_EDIT_AI_RATE_LIMIT = Object.freeze({
  key: "finishedGoods.jobScanEdit.ai",
  limit: 30,
  windowMs: 10 * 60_000,
});

const jobScanFilter = v.union(
  v.literal("ALL"),
  v.literal("UNMAPPED"),
  v.literal("MAPPED"),
);

const jobScanSearchField = v.union(
  v.literal("location"),
  v.literal("factoryOrder"),
  v.literal("productBarcodeText"),
  v.literal("partName"),
  v.literal("customer"),
);

const jobScanSearchFacets = v.object({
  building: optionalText,
  floor: optionalNumber,
  storageFormat: v.optional(batchFormat),
});

const jobScanSearchIntentValue = v.object({
  filter: jobScanFilter,
  search: v.string(),
  searchField: v.optional(jobScanSearchField),
  facets: v.optional(jobScanSearchFacets),
});

const jobScanSearchInterpretOutcome = v.union(
  v.object({
    ok: v.literal(true),
    value: jobScanSearchIntentValue,
  }),
  v.object({
    ok: v.literal(false),
    error: v.object({
      code: v.literal("UNSUPPORTED"),
      fallback: v.literal("MANUAL_SEARCH"),
    }),
  }),
  v.object({
    ok: v.literal(false),
    error: v.object({
      code: v.union(
        v.literal("PROMPT_INVALID"),
        v.literal("AI_UNAVAILABLE"),
        v.literal("AI_TIMEOUT"),
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

const jobScanEditFields = v.object({
  factoryOrder: optionalText,
  productBarcodeText: optionalText,
  deliveryDate: optionalText,
  partName: optionalText,
  customer: optionalText,
  manufacturingDate: optionalText,
  quantity: optionalNumber,
  factoryQuantity: optionalNumber,
  customerQuantity: optionalNumber,
  storageFormat: v.optional(batchFormat),
});

const jobScanEditProposalValue = v.object({
  locationCode: optionalText,
  fields: v.optional(jobScanEditFields),
});

const jobScanEditProposalOutcome = v.union(
  v.object({
    ok: v.literal(true),
    value: jobScanEditProposalValue,
  }),
  v.object({
    ok: v.literal(false),
    error: v.object({
      code: v.literal("UNSUPPORTED"),
      fallback: v.literal("MANUAL_EDIT"),
    }),
  }),
  v.object({
    ok: v.literal(false),
    error: v.object({
      code: v.union(
        v.literal("PROMPT_INVALID"),
        v.literal("AI_UNAVAILABLE"),
        v.literal("AI_TIMEOUT"),
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

const STRICT_CHAT_ADAPTER = strictOpenRouterChatAdapter(
  MAX_JOB_SCAN_AI_CONTENT_LENGTH,
);

function openRouterTextConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model =
    process.env.OPENROUTER_SEARCH_MODEL?.trim() ||
    process.env.OPENROUTER_MODEL?.trim() ||
    "openai/gpt-6-luna";
  return apiKey ? { apiKey, model } : null;
}

async function runJobScanStructuredAi<T, Fallback extends string>(
  ctx: TenantActionFunctionContext,
  options: {
    readonly eventPrefix: string;
    readonly fallback: Fallback;
    readonly rateLimitWindowMs: number;
    readonly prompt: string;
    readonly buildBody: (model: string) => object;
    readonly parse: (content: string) => JobScanInterpretResult<T>;
  },
): Promise<
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "UNSUPPORTED";
        readonly fallback: Fallback;
      };
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          "PROMPT_INVALID" | "AI_UNAVAILABLE" | "AI_TIMEOUT" | "AI_UNREADABLE";
      };
    }
  | {
      readonly ok: false;
      readonly error: { readonly code: "RATE_LIMITED" };
      readonly retryAfterMs: number;
    }
> {
  if (!validJobScanAiPrompt(options.prompt))
    return { ok: false as const, error: { code: "PROMPT_INVALID" as const } };
  if (ctx.quota === undefined || !ctx.quota.allowed)
    return {
      ok: false as const,
      error: { code: "RATE_LIMITED" as const },
      retryAfterMs: ctx.quota?.retryAfterMs ?? options.rateLimitWindowMs,
    };
  const config = openRouterTextConfig();
  if (!config)
    return { ok: false as const, error: { code: "AI_UNAVAILABLE" as const } };

  const body = JSON.stringify(options.buildBody(config.model));
  const send = (signal: AbortSignal) =>
    fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body,
    });
  let outcome: JobTicketProviderOutcome;
  try {
    outcome = await requestJobTicketProvider(send, {
      adapter: STRICT_CHAT_ADAPTER,
      policy: JOB_SCAN_AI_PROVIDER_POLICY,
      tracking: {
        port: ctx.aiUsage,
        feature: "AI_SEARCH",
        model: config.model,
      },
      validateContent: (content) =>
        options.parse(content).kind !== "UNREADABLE",
    });
  } catch {
    return { ok: false as const, error: { code: "AI_UNAVAILABLE" as const } };
  }
  if (!outcome.ok) {
    // Static fields only: never the prompt, provider body, model text or key.
    console.warn(
      JSON.stringify({
        event: `${options.eventPrefix}.provider.failed`,
        reason: outcome.reason,
        ...(outcome.status === undefined ? {} : { status: outcome.status }),
        attempts: outcome.attempts,
        elapsedMs: outcome.elapsedMs,
      }),
    );
    const code =
      outcome.reason === "timeout"
        ? ("AI_TIMEOUT" as const)
        : outcome.reason === "too_large" || outcome.reason === "malformed"
          ? ("AI_UNREADABLE" as const)
          : ("AI_UNAVAILABLE" as const);
    return { ok: false as const, error: { code } };
  }
  const parsed = options.parse(outcome.content);
  if (parsed.kind === "OK") return { ok: true as const, value: parsed.value };
  if (parsed.kind === "UNSUPPORTED")
    return {
      ok: false as const,
      error: { code: "UNSUPPORTED" as const, fallback: options.fallback },
    };
  console.warn(
    JSON.stringify({
      event: `${options.eventPrefix}.provider.unreadable`,
      attempts: outcome.attempts,
      elapsedMs: outcome.elapsedMs,
    }),
  );
  return { ok: false as const, error: { code: "AI_UNREADABLE" as const } };
}

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

/** Reads a job ticket photo with the configured image provider. Sample extraction requires explicit local opt-in. */
export const extractJobTicket = actionWithOrg({
  args: { warehouseId: v.id("warehouses"), imageUrl: v.string() },
  returns: extractionOutcome,
  permissionCode: MANAGE,
  target: { table: TABLE },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args): Promise<Infer<typeof extractionOutcome>> => {
    // An uploaded HTTPS URL or a downscaled photo as a data URL.
    if (
      !/^(https:\/\/|data:image\/(jpeg|png|webp);base64,)/i.test(
        args.imageUrl,
      ) ||
      args.imageUrl.length > 4_000_000
    )
      return { ok: false as const, error: { code: "IMAGE_URL_INVALID" } };
    const request = imageProviderRequest({
      prompt: JOB_TICKET_PROMPT,
      instruction: "Extract information from this image",
      imageUrl: args.imageUrl,
      name: "job_ticket",
      schema: JOB_TICKET_JSON_SCHEMA,
    });
    if (!request) {
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
    let outcome: JobTicketProviderOutcome;
    try {
      outcome = await requestJobTicketProvider(request.send, {
        adapter: request.adapter,
        tracking: {
          port: ctx.aiUsage,
          feature: "JOB_TICKET_SCAN",
          model: request.model,
        },
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

/** Interprets a natural-language job-scan search prompt without reading or writing records. */
export const interpretJobScanSearch = actionWithOrg({
  args: { warehouseId: v.id("warehouses"), prompt: v.string() },
  returns: jobScanSearchInterpretOutcome,
  permissionCode: READ,
  target: { table: TABLE },
  warehouseId: (args) => args.warehouseId,
  rateLimit: JOB_SCAN_SEARCH_AI_RATE_LIMIT,
  handler: async (
    ctx,
    args,
  ): Promise<Infer<typeof jobScanSearchInterpretOutcome>> =>
    runJobScanStructuredAi(ctx, {
      eventPrefix: "jobScan.searchAi",
      fallback: "MANUAL_SEARCH",
      rateLimitWindowMs: JOB_SCAN_SEARCH_AI_RATE_LIMIT.windowMs,
      prompt: args.prompt,
      buildBody: (model) =>
        jobScanSearchRequestBody({ model, prompt: args.prompt }),
      parse: (content) => parseJobScanSearchContent(content, args.prompt),
    }),
});

/** Proposes explicitly requested job-scan edits for client-side review; performs no writes. */
export const proposeJobScanEdit = actionWithOrg({
  args: { warehouseId: v.id("warehouses"), prompt: v.string() },
  returns: jobScanEditProposalOutcome,
  permissionCode: MANAGE,
  target: { table: TABLE },
  warehouseId: (args) => args.warehouseId,
  rateLimit: JOB_SCAN_EDIT_AI_RATE_LIMIT,
  handler: async (
    ctx,
    args,
  ): Promise<Infer<typeof jobScanEditProposalOutcome>> =>
    runJobScanStructuredAi(ctx, {
      eventPrefix: "jobScan.editAi",
      fallback: "MANUAL_EDIT",
      rateLimitWindowMs: JOB_SCAN_EDIT_AI_RATE_LIMIT.windowMs,
      prompt: args.prompt,
      buildBody: (model) =>
        jobScanEditRequestBody({ model, prompt: args.prompt }),
      parse: (content) => parseJobScanEditContent(content, args.prompt),
    }),
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
    fields: v.optional(correctionFields),
    ticketPatch: v.optional(jobScanEditFields),
    customerLink: v.optional(customerLinkArg),
    location: v.optional(mappedLocation),
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
      if (
        (args.fields && args.ticketPatch) ||
        (!args.fields && args.customerLink) ||
        (!args.fields &&
          !args.location &&
          !Object.keys(args.ticketPatch ?? {}).length)
      )
        return failure("FIELD_INVALID");
      const submitted = args.fields ?? args.ticketPatch ?? {};
      const factoryOrder = submitted.factoryOrder ?? before.factoryOrder;
      const productBarcodeText =
        submitted.productBarcodeText ?? before.productBarcodeText;
      const error = jobTicketError({ factoryOrder, productBarcodeText });
      if (error) return failure(error);
      const detailError = jobTicketDetailError(submitted);
      if (detailError) return failure(detailError.code, detailError.field);
      if (
        args.ticketPatch?.customer !== undefined &&
        !(await canReadCustomers(ctx))
      )
        return failure("CUSTOMER_LINK_REVIEW_REQUIRED", "customer");
      // A reviewed ticket correction can include a location. Resolve it before
      // applying any ticket changes, using the same warehouse lookup as remapping.
      const destination = args.location
        ? await mapLocation(ctx, args.warehouseId, args.location)
        : null;
      if (args.location && !destination) return failure("LOCATION_UNAVAILABLE");
      const locationPatch = destination
        ? {
            mapped: true,
            zoneId: undefined,
            supportPositionId: undefined,
            floorId: undefined,
            ...destination,
          }
        : undefined;
      const reviewCustomer = Boolean(
        args.fields || args.ticketPatch?.customer !== undefined,
      );
      const submittedCustomerText = reviewCustomer
        ? submitted.customer
        : before.customer;
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
      if (
        args.ticketPatch?.customer !== undefined &&
        (nextCustomerId !== before.customerId ||
          nextCustomerLinkSource !== before.customerLinkSource)
      )
        return failure("CUSTOMER_LINK_REVIEW_REQUIRED", "customer");
      const nextReviewPending = reviewCustomer
        ? customerReviewState({
            voided: before.voided,
            customer: nextCustomerText,
            customerId: nextCustomerId,
            customerLinkSource: nextCustomerLinkSource,
          })
        : before.customerReviewPending;
      const normalized = {
        factoryOrder: factoryOrder.trim(),
        productBarcodeText: productBarcodeText.trim(),
        partName: submitted.partName?.trim() || undefined,
        customer: nextCustomerText,
        customerId: nextCustomerId,
        customerLinkSource: nextCustomerLinkSource,
        deliveryDate: submitted.deliveryDate?.trim() || undefined,
        manufacturingDate: submitted.manufacturingDate?.trim() || undefined,
        quantity: submitted.quantity,
        factoryQuantity: submitted.factoryQuantity,
        customerQuantity: submitted.customerQuantity,
        storageFormat: submitted.storageFormat,
      };
      // Full edits can explicitly clear old values. A reviewed patch only
      // writes its listed fields, leaving legacy values byte-for-byte intact.
      const fields: {
        [Field in keyof typeof normalized]?:
          (typeof normalized)[Field] | undefined;
      } = args.fields
        ? normalized
        : {
            ...Object.fromEntries(
              (Object.keys(submitted) as (keyof typeof submitted)[]).map(
                (field) => [field, normalized[field]],
              ),
            ),
          };
      const changes = [...diffFields(before, fields)];
      if (locationPatch && diffFields(before, locationPatch).length) {
        changes.push({
          field: "location",
          from: before.locationCode ?? before.locationText,
          to: locationPatch.locationCode,
        });
      }
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
          ...locationPatch,
          ...(reviewCustomer
            ? { customerReviewPending: nextReviewPending }
            : {}),
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
            (fields.factoryOrder !== undefined &&
              before.factoryOrder !== fields.factoryOrder))
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
    filter: jobScanFilter,
    search: v.optional(v.string()),
    /** Match a whole job number, barcode, or current location (captured text only without a current code). */
    exactCode: v.optional(v.boolean()),
    searchField: v.optional(jobScanSearchField),
    /** A resolved storage QR searches current assignments by identity. */
    locationId: optionalText,
    /** Optional structured filters applied alongside status and text search. */
    facets: v.optional(jobScanSearchFacets),
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
    const requestedNeedle =
      args.locationId === undefined
        ? normalizeJobScanSearch(args.search ?? "")
        : "";
    const location =
      args.locationId && args.locationId.length <= 100
        ? await jobLocationReader(ctx, args.warehouseId).byId({
            locationId: args.locationId,
          })
        : null;
    // Older scans can carry only their layout references. Resolve both aliases
    // of the ledger identity, including a retired default position of an active area.
    const [legacyZone, legacyPosition] = location?.zoneId
      ? await Promise.all([
          ctx.tenantDb.get<Doc<"storageZones">>(
            "storageZones",
            location.zoneId,
          ),
          ctx.tenantDb
            .byIndex<Doc<"storagePositions">>(
              "storagePositions",
              "by_orgId_locationId",
              [{ field: "locationId", value: location.locationId }],
            )
            .first(),
        ])
      : [null, null];
    const searchField = requestedNeedle ? args.searchField : undefined;
    const exactFactoryOrder =
      searchField === "factoryOrder" &&
      isSavedFactoryOrderCode(requestedNeedle);
    const locationCode =
      searchField === "location"
        ? normalizeJobLocationCode(args.search ?? "")
        : null;
    // Registered codes may be any human label. Use the registration index
    // to distinguish a complete code from a partial location search.
    const registeredLocation = locationCode
      ? await ctx.tenantDb
          .byIndex<Doc<"locations">>("locations", "by_orgId_warehouseId_code", [
            { field: "warehouseId", value: args.warehouseId },
            { field: "code", value: locationCode },
          ])
          .first()
      : null;
    const needle = registeredLocation
      ? normalizeJobScanSearch(registeredLocation.code)
      : requestedNeedle;
    const exactLocationAddress =
      searchField === "location" && isSavedLocationAddress(needle);
    const exact = Boolean(needle) && !searchField && args.exactCode === true;
    const scannedLocationCode = exact
      ? normalizeJobScanLocationScan(args.search ?? "")
      : "";
    const buildingNeedle =
      args.facets?.building !== undefined
        ? normalizeJobScanSearch(args.facets.building)
        : "";
    const removeBuildingLabel = (name: string) =>
      name.replace(/^(?:building\s+|อาคาร\s*)(?=\S)/u, "");
    const buildingOperand = removeBuildingLabel(buildingNeedle);
    // A known code identifies one building, even if another name contains it.
    // The AI can return either the code or the complete "Building <code>" label.
    const findBuildingByCode = async (operand: string) => {
      if (!operand) return null;
      const code = normalizeCode(operand, {
        maxLength: 64,
        caseFolding: "UPPERCASE",
      });
      if (!code.ok) return null;
      return ctx.tenantDb
        .byIndex<Doc<"storageBuildings">>(
          "storageBuildings",
          "by_orgId_warehouseId_code",
          [
            { field: "warehouseId", value: args.warehouseId },
            { field: "code", value: code.value },
          ],
        )
        .first();
    };
    const exactBuilding =
      (await findBuildingByCode(buildingNeedle)) ??
      (buildingOperand === buildingNeedle
        ? null
        : await findBuildingByCode(buildingOperand));
    const rawFloor = args.facets?.floor;
    const floorInvalid =
      rawFloor !== undefined &&
      (!Number.isSafeInteger(rawFloor) || rawFloor < 0);
    const floorFacet =
      rawFloor !== undefined && !floorInvalid ? rawFloor : undefined;
    const storageFormatFacet = args.facets?.storageFormat;
    const hasFacets =
      Boolean(buildingNeedle) ||
      floorFacet !== undefined ||
      floorInvalid ||
      storageFormatFacet !== undefined;
    // Bind the full predicate to the cursor while retaining existing cursor scopes.
    const criteriaScope =
      exact || searchField || hasFacets || args.locationId !== undefined
        ? {
            ...(exact ? { exactCode: true, scannedLocationCode } : {}),
            ...(searchField ? { searchField } : {}),
            ...(registeredLocation
              ? { registeredLocationId: registeredLocation._id }
              : exactLocationAddress
                ? { exactLocationAddress: true }
                : {}),
            ...(args.locationId !== undefined
              ? { locationId: location?.locationId ?? "invalid" }
              : {}),
            ...(buildingNeedle ? { building: buildingNeedle } : {}),
            ...(exactBuilding ? { buildingId: exactBuilding._id } : {}),
            ...(floorInvalid
              ? { floor: "invalid" }
              : floorFacet !== undefined
                ? { floor: floorFacet }
                : {}),
            ...(storageFormatFacet !== undefined
              ? { storageFormat: storageFormatFacet }
              : {}),
          }
        : undefined;
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
      const zone =
        scan.buildingId && scan.floorId
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
      if (args.locationId !== undefined) {
        if (!location || !scan.mapped) return false;
        if (scan.locationId) {
          if (scan.locationId !== location.locationId) return false;
        } else if (
          !location.zoneId ||
          scan.zoneId !== location.zoneId ||
          (scan.supportPositionId
            ? scan.supportPositionId !== legacyPosition?._id ||
              legacyPosition.zoneId !== location.zoneId ||
              legacyPosition.warehouseId !== args.warehouseId
            : legacyZone?.locationId !== location.locationId)
        ) {
          return false;
        }
      }
      if (floorInvalid) return false;
      if (
        storageFormatFacet !== undefined &&
        scan.storageFormat !== storageFormatFacet
      )
        return false;
      if (exact && !jobScanExactCodeMatches(scan, needle, scannedLocationCode))
        return false;
      let resolvedParents: Awaited<ReturnType<typeof parents>> | undefined;
      const getParents = async () => (resolvedParents ??= await parents(scan));
      if (buildingNeedle || floorFacet !== undefined) {
        const { building, floor } = await getParents();
        if (
          buildingNeedle &&
          !(
            building &&
            (exactBuilding
              ? building._id === exactBuilding._id
              : [buildingNeedle, buildingOperand].includes(
                  normalizeJobScanSearch(building.code),
                ) ||
                removeBuildingLabel(
                  normalizeJobScanSearch(building.name),
                ).includes(buildingOperand))
          )
        )
          return false;
        if (floorFacet !== undefined && floor?.floorNumber !== floorFacet)
          return false;
      }
      if (!needle || exact) return true;
      if (exactFactoryOrder)
        return normalizeJobScanSearch(scan.factoryOrder) === needle;
      if (searchField === "location") {
        const code = scan.locationCode || scan.locationText;
        if (registeredLocation) {
          // Folded text only generates index candidates. Compare the code
          // just as registration does, and honor any stored location ID.
          return (
            (!scan.locationId || scan.locationId === registeredLocation._id) &&
            normalizeJobLocationCode(code ?? "") === registeredLocation.code
          );
        }
        if (exactLocationAddress)
          return [code, scan.locationName].some(
            (value) => value && normalizeJobScanSearch(value) === needle,
          );
        return (
          jobScanNameMatches(code, needle) ||
          jobScanNameMatches(scan.locationName, needle)
        );
      }
      if (searchField) return jobScanNameMatches(scan[searchField], needle);
      if (jobScanTextMatches(scan, needle)) return true;
      const { building } = await getParents();
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
        exactCode: exact,
        ...(criteriaScope !== undefined ? { scopeExtra: criteriaScope } : {}),
        pageSize,
        cursor: args.cursor,
        scanCursor: args.scanCursor,
        progressive: args.progressive === true,
        accept,
        hydrate,
      });
    // Otherwise text search or facet filtering inspects history in bounded
    // chunks with a stable cursor instead of re-reading all of it.
    const boundedScope: unknown[] = [
      "finishedGoodsJobScans",
      args.warehouseId,
      args.filter,
      needle,
    ];
    if (criteriaScope !== undefined) boundedScope.push(criteriaScope);
    return boundedRecordPage(ctx, {
      scope: boundedScope,
      pageSize,
      cursor: args.cursor,
      scanCursor: args.scanCursor,
      filtering: Boolean(needle) || hasFacets || args.locationId !== undefined,
      acceptNativeCursor:
        args.locationId === undefined && searchField === undefined,
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

export { normalizeJobScanSearch, jobScanTextMatches, jobScanExactCodeMatches };
