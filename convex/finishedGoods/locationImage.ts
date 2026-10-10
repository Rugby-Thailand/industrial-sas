import { v } from "convex/values";
import { actionWithOrg } from "../lib/tenantFunctions";
import { requestImageProvider } from "../lib/imageProvider";
import {
  LOCATION_LABEL_PROMPT,
  LOCATION_LABEL_SCHEMA,
  parseLocationLabel,
  validLocationImage,
  type LocationImageResult,
} from "../model/finishedGoods/locationImage";

/** Read-only extraction, authorized before sending a photo to the paid provider. */
export const extractLocationLabel = actionWithOrg({
  args: { warehouseId: v.id("warehouses"), imageDataUrl: v.string() },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageZones" },
  warehouseId: (args) => args.warehouseId,
  handler: async (_ctx, args): Promise<LocationImageResult> => {
    if (!validLocationImage(args.imageDataUrl))
      return { ok: false, error: { code: "IMAGE_URL_INVALID" } };
    const key = process.env.OPENROUTER_API_KEY?.trim();
    if (!key) return { ok: false, error: { code: "AI_UNAVAILABLE" } };
    const outcome = await requestImageProvider((signal) =>
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-6-luna",
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
      }),
    );
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
    try {
      return {
        ok: true,
        candidates: parseLocationLabel(JSON.parse(outcome.content)),
      };
    } catch {
      console.warn(
        JSON.stringify({
          event: "locationImage.provider.unreadable",
          attempts: outcome.attempts,
          elapsedMs: outcome.elapsedMs,
        }),
      );
      return { ok: false, error: { code: "AI_UNREADABLE" } };
    }
  },
});
