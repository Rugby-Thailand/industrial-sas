import {
  httpActionGeneric,
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";

type ConsumeArgs = { readonly grantId: string };
type ConsumeResult = {
  readonly storageId: string;
  readonly fileName: string;
} | null;

const consumeGrant = makeFunctionReference<
  "mutation",
  ConsumeArgs,
  ConsumeResult
>(
  "engineering/files:consumeMasterCardFileAccessGrant",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  ConsumeArgs,
  ConsumeResult
>;

const unavailable = () =>
  new Response("File access grant is missing, expired, or already used.", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });

/**
 * Redeem one audited, five-minute, one-use file capability.
 *
 * The underlying Convex storage URL never leaves this server response. Every
 * browser download therefore begins with a fresh permission-checked grant, and
 * a copied gateway URL stops working after its first use or expiry.
 */
export const privateMasterCardFileDownload = httpActionGeneric(
  async (ctx, request) => {
    const grantId = new URL(request.url).searchParams.get("grantId");
    if (grantId === null || grantId.length === 0) return unavailable();

    try {
      const redeemed = await ctx.runMutation(consumeGrant, { grantId });
      if (redeemed === null) return unavailable();
      const storageUrl = await ctx.storage.getUrl(redeemed.storageId as never);
      if (storageUrl === null) return unavailable();
      const stored = await fetch(storageUrl, { redirect: "error" });
      if (!stored.ok || stored.body === null) return unavailable();
      return new Response(stored.body, {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Type":
            stored.headers.get("content-type") ?? "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(redeemed.fileName)}`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return unavailable();
    }
  },
);
