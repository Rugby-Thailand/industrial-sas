import { v } from "convex/values";
import { actionWithOrg } from "../lib/tenantFunctions";
import {
  imageProviderRequest,
  requestImageProvider,
  type ImageProviderOutcome,
} from "../lib/imageProvider";
import {
  LOCATION_LABEL_PROMPT,
  LOCATION_LABEL_SCHEMA,
  parseLocationLabel,
  validLocationImage,
  type LocationImageResult,
  type LocationLabelCandidate,
} from "../model/finishedGoods/locationImage";

export const LOCATION_IMAGE_RATE_LIMIT = Object.freeze({
  key: "finishedGoods.locationLabel.ai",
  limit: 20,
  windowMs: 10 * 60_000,
});

/** The validated candidates of model content, or null when unreadable. */
function readCandidates(content: string): LocationLabelCandidate[] | null {
  try {
    return parseLocationLabel(JSON.parse(content));
  } catch {
    return null;
  }
}

/** Read-only extraction, authorized before sending a photo to the paid provider. */
export const extractLocationLabel = actionWithOrg({
  rateLimit: LOCATION_IMAGE_RATE_LIMIT,
  args: { warehouseId: v.id("warehouses"), imageDataUrl: v.string() },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageZones" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args): Promise<LocationImageResult> => {
    if (!validLocationImage(args.imageDataUrl))
      return { ok: false, error: { code: "IMAGE_URL_INVALID" } };
    if (ctx.quota === undefined || !ctx.quota.allowed)
      return {
        ok: false,
        error: { code: "RATE_LIMITED" },
        retryAfterMs:
          ctx.quota?.retryAfterMs ?? LOCATION_IMAGE_RATE_LIMIT.windowMs,
      };
    const request = imageProviderRequest({
      prompt: LOCATION_LABEL_PROMPT,
      instruction: "Read the visible warehouse location labels in this photo.",
      imageUrl: args.imageDataUrl,
      name: "location_label",
      schema: LOCATION_LABEL_SCHEMA,
    });
    if (!request) return { ok: false, error: { code: "AI_UNAVAILABLE" } };
    let outcome: ImageProviderOutcome;
    try {
      // Its own feature in the shared ledger: billed whether or not the
      // labels are readable, and never linkable to a saved job ticket.
      outcome = await requestImageProvider(request.send, {
        adapter: request.adapter,
        tracking: {
          port: ctx.aiUsage,
          feature: "LOCATION_LABEL_SCAN",
          model: request.model,
        },
        validateContent: (content) => readCandidates(content) !== null,
      });
    } catch {
      // The durable usage record could not begin: no photo was sent.
      return { ok: false, error: { code: "AI_UNAVAILABLE" } };
    }
    if (!outcome.ok) {
      console.warn(
        JSON.stringify({
          event: "locationImage.provider.unavailable",
          reason: outcome.reason,
          attempts: outcome.attempts,
          elapsedMs: outcome.elapsedMs,
        }),
      );
      return { ok: false, error: { code: "AI_UNAVAILABLE" } };
    }
    const candidates = readCandidates(outcome.content);
    if (candidates === null) {
      console.warn(
        JSON.stringify({
          event: "locationImage.provider.unreadable",
          attempts: outcome.attempts,
          elapsedMs: outcome.elapsedMs,
        }),
      );
      return { ok: false, error: { code: "AI_UNREADABLE" } };
    }
    return { ok: true, candidates };
  },
});
