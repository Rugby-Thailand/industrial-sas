/** Trusted internal registration of a verified UploadThing task object. */
import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";

export const MAX_TASK_FILE_BYTES = 64 * 1024 * 1024;

const DIGEST = /^[0-9a-f]{64}$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

/** Only the HMAC-gated HTTP callback calls this raw-database seam. */
export const completeUploadThingTaskUploadGrant = internalMutationGeneric({
  args: {
    grantId: v.id("operatorTaskUploadGrants"),
    providerKey: v.string(),
    uploaderClerkUserId: v.string(),
    contentDigest: v.string(),
    contentType: v.string(),
    byteSize: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const grant = await ctx.db.get(args.grantId);
    if (
      grant === null ||
      grant.authorizedClerkUserId !== args.uploaderClerkUserId ||
      grant.consumedUploadThingKey !== undefined ||
      grant.attachedAt !== undefined ||
      grant.expiresAt < Date.now() ||
      !DIGEST.test(args.contentDigest) ||
      !MEDIA_TYPE.test(args.contentType) ||
      !Number.isInteger(args.byteSize) ||
      args.byteSize <= 0 ||
      args.byteSize > MAX_TASK_FILE_BYTES ||
      args.providerKey.length === 0 ||
      args.providerKey.length > 512
    ) {
      return false;
    }
    await ctx.db.patch(grant._id, {
      consumedUploadThingKey: args.providerKey,
      consumedContentDigest: args.contentDigest,
      consumedContentType: args.contentType,
      consumedByteSize: args.byteSize,
      consumedAt: Date.now(),
    });
    return true;
  },
});
