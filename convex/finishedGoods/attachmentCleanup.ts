"use node";
import { v } from "convex/values";
import { UTApi } from "uploadthing/server";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

/** At most 60 objects per org per hourly run. Failed provider deletions retain their
 * DELETING rows for retry; the database never forgets an unconfirmed deletion.
 * customId finds uploads whose callback never reached Convex.
 */
export const cleanup = internalAction({
  args: { orgId: v.id("organizations") },
  returns: v.object({ deleted: v.number(), failed: v.number() }),
  handler: async (ctx, args) => {
    if (!process.env.UPLOADTHING_TOKEN)
      throw new Error("Attachment cleanup unavailable");
    const provider = new UTApi({
      fetch: (input, init) => {
        const signal = init && "signal" in init ? init.signal : undefined;
        return fetch(input, {
          ...init,
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
            : AbortSignal.timeout(5000),
        });
      },
    });
    const assets = await ctx.runMutation(
      internal.finishedGoods.attachments.claimExpired,
      args,
    );
    let deleted = 0;
    let failed = 0;
    for (const asset of assets) {
      try {
        const result = asset.fileKey
          ? await provider.deleteFiles(asset.fileKey)
          : await provider.deleteFiles(asset.assetId, { keyType: "customId" });
        if (!result.success) throw new Error("Attachment deletion unconfirmed");
        await ctx.runMutation(
          internal.finishedGoods.attachments.finishDeletion,
          {
            assetId: asset.assetId,
          },
        );
        deleted++;
      } catch {
        failed++;
      }
    }
    if (failed)
      console.warn(
        JSON.stringify({ event: "jobTicketAssets.cleanup.retry", failed }),
      );
    return { deleted, failed };
  },
});
