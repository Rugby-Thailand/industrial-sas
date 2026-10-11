import { v } from "convex/values";
import { actionWithOrg } from "../lib/tenantFunctions";
import {
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

const DEFAULT_MODEL = "openai/gpt-6-luna";

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
  args: { warehouseId: v.id("warehouses"), imageDataUrl: v.string() },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageZones" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args): Promise<LocationImageResult> => {
    if (!validLocationImage(args.imageDataUrl))
      return { ok: false, error: { code: "IMAGE_URL_INVALID" } };
    const key = process.env.OPENROUTER_API_KEY?.trim();
    if (!key) return { ok: false, error: { code: "AI_UNAVAILABLE" } };
    const model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
    const send = (signal: AbortSignal) =>
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: "system", content: LOCATION_LABEL_PROMPT },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Read the visible warehouse location labels in this photo.",
                },
                { type: "image_url", image_url: { url: args.imageDataUrl } },
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "location_label",
              strict: true,
              schema: LOCATION_LABEL_SCHEMA,
            },
          },
        }),
      });
    let outcome: ImageProviderOutcome;
    try {
      // Its own feature in the shared ledger: billed whether or not the
      // labels are readable, and never linkable to a saved job ticket.
      outcome = await requestImageProvider(send, {
        tracking: { port: ctx.aiUsage, feature: "LOCATION_LABEL_SCAN", model },
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
