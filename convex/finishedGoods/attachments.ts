import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { mutation, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { mutationWithOrg } from "../lib/tenantFunctions";
import { consumeActionQuota } from "../lib/actionQuota";
import { verifyUploadReceipt } from "../lib/uploadReceipt";

export const ATTACHMENT_GRACE_MS = 7 * 86_400_000;

/** Called by upload middleware with the user's Convex JWT, before a provider URL is issued. */
export const createIntent = mutationWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.union(v.object({ assetId: v.id("jobTicketAssets") }), v.null()),
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "jobTicketAssets" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    // Fail closed before any provider registration when the callback bridge isn't configured.
    if (!process.env.UPLOADTHING_TOKEN) return null;
    const quota = await consumeActionQuota(
      ctx.tenantDb,
      ctx.tenant.actor._id,
      {
        key: "finishedGoods.ticketUpload",
        limit: 100,
        windowMs: 86_400_000,
      },
      Date.now(),
    );
    if (!quota.allowed) return null;
    const id = await ctx.tenantDb.insert("jobTicketAssets", {
      warehouseId: args.warehouseId,
      createdByUserId: ctx.tenant.actor._id,
      state: "PENDING",
      expiresAt: Date.now() + ATTACHMENT_GRACE_MS,
    });
    const assetId = id as Id<"jobTicketAssets">;
    return { assetId };
  },
});

/** Integration ingress: no session cookie is present in a provider callback.
 * The Next SDK verifies the provider signature first; this second HMAC authenticates
 * the exact callback fields across the Next -> Convex trust boundary. Never trust
 * browser serverData, a URL, or possession of an asset ID as proof of upload.
 */
export const finalizeUpload = mutation({
  args: {
    assetId: v.id("jobTicketAssets"),
    fileKey: v.string(),
    url: v.string(),
    size: v.number(),
    mimeType: v.string(),
    signature: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!(await verifyUploadReceipt(args, args.signature)))
      throw new Error("Upload receipt invalid");
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.state === "DELETING" || asset.expiresAt <= Date.now())
      throw new Error("Upload intent expired");
    if (
      !/^[a-zA-Z0-9._-]{1,256}$/.test(args.fileKey) ||
      !["image/jpeg", "image/png", "image/webp"].includes(args.mimeType) ||
      !Number.isSafeInteger(args.size) ||
      args.size < 1 ||
      args.size > 16 * 1024 * 1024
    )
      throw new Error("Upload metadata invalid");
    const url = new URL(args.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== `/f/${args.fileKey}` ||
      url.search ||
      url.hash ||
      !(url.hostname.endsWith(".ufs.sh") || url.hostname === "utfs.io")
    )
      throw new Error("Upload URL invalid");
    if (asset.state !== "PENDING") {
      if (
        asset.fileKey !== args.fileKey ||
        asset.url !== args.url ||
        asset.size !== args.size ||
        asset.mimeType !== args.mimeType
      )
        throw new Error("Upload already finalized");
      return null;
    }
    await ctx.db.patch(asset._id, {
      state: "READY",
      fileKey: args.fileKey,
      url: args.url,
      size: args.size,
      mimeType: args.mimeType,
    });
    return null;
  },
});

/** Tenant-indexed bounded claim; ATTACHED rows are never eligible. */
export const claimExpired = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const expired = [];
    for (const state of ["DELETING", "PENDING", "READY"] as const) {
      const rows = await ctx.db
        .query("jobTicketAssets")
        .withIndex("by_orgId_state_expiresAt", (q) =>
          q
            .eq("orgId", args.orgId)
            .eq("state", state)
            .lte("expiresAt", Date.now()),
        )
        .take(20);
      for (const row of rows) {
        await ctx.db.patch(row._id, { state: "DELETING" });
        expired.push({ assetId: row._id, fileKey: row.fileKey ?? null });
      }
    }
    return expired;
  },
});
export const finishDeletion = internalMutation({
  args: { assetId: v.id("jobTicketAssets") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.assetId);
    if (row?.state === "DELETING") await ctx.db.delete(row._id);
  },
});
export const dispatchCleanup = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args): Promise<null> => {
    const page = await ctx.db
      .query("organizations")
      .paginate({ cursor: args.cursor ?? null, numItems: 20 });
    for (const org of page.page)
      await ctx.scheduler.runAfter(
        0,
        internal.finishedGoods.attachmentCleanup.cleanup,
        { orgId: org._id },
      );
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        1000,
        internal.finishedGoods.attachments.dispatchCleanup,
        { cursor: page.continueCursor },
      );
    return null;
  },
});
