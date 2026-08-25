import {
  httpActionGeneric,
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";

const MAX_UPLOAD_BYTE_SIZE = 512 * 1024 * 1024;

type ClaimArgs = { readonly grantId: string };
type ClaimResult =
  | { readonly kind: "CLAIMED" }
  | { readonly kind: "COMPLETE"; readonly storageId: string }
  | null;
type CompleteArgs = { readonly grantId: string; readonly storageId: string };

const claimGrant = makeFunctionReference<"mutation", ClaimArgs, ClaimResult>(
  "engineering/files:claimMasterCardUploadGrant",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  ClaimArgs,
  ClaimResult
>;

const releaseGrant = makeFunctionReference<"mutation", ClaimArgs, boolean>(
  "engineering/files:releaseMasterCardUploadGrant",
) as unknown as FunctionReference<"mutation", "internal", ClaimArgs, boolean>;

const completeGrant = makeFunctionReference<"mutation", CompleteArgs, boolean>(
  "engineering/files:completeMasterCardUploadGrant",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  CompleteArgs,
  boolean
>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Content-Length",
  "Cache-Control": "private, no-store",
} as const;

const unavailable = () =>
  new Response("Upload grant is missing, expired, or already used.", {
    status: 404,
    headers: corsHeaders,
  });

const invalidPayload = () =>
  new Response(
    "Upload payload must contain one non-empty file within the limit.",
    {
      status: 413,
      headers: corsHeaders,
    },
  );

export const privateMasterCardFileUploadOptions = httpActionGeneric(
  async () => new Response(null, { status: 204, headers: corsHeaders }),
);

export const privateMasterCardFileUpload = httpActionGeneric(
  async (ctx, request) => {
    const grantId = new URL(request.url).searchParams.get("grantId");
    if (grantId === null || grantId.length === 0) return unavailable();

    const contentLength = request.headers.get("content-length");
    const declaredLength =
      contentLength === null ? undefined : Number(contentLength);
    if (
      declaredLength !== undefined &&
      Number.isFinite(declaredLength) &&
      (declaredLength <= 0 || declaredLength > MAX_UPLOAD_BYTE_SIZE)
    ) {
      return invalidPayload();
    }

    let storageId: string | undefined;
    let bound = false;
    let claimed = false;
    try {
      const claim = await ctx.runMutation(claimGrant, { grantId });
      if (claim === null) return unavailable();
      if (claim.kind === "COMPLETE") {
        return Response.json(
          { storageId: claim.storageId },
          { status: 200, headers: corsHeaders },
        );
      }
      claimed = true;

      const blob = await request.blob();
      if (blob.size <= 0 || blob.size > MAX_UPLOAD_BYTE_SIZE) {
        await ctx.runMutation(releaseGrant, { grantId });
        return invalidPayload();
      }

      storageId = await ctx.storage.store(blob);
      bound = await ctx.runMutation(completeGrant, {
        grantId,
        storageId,
      });
      if (!bound) {
        await ctx.storage.delete(storageId);
        await ctx.runMutation(releaseGrant, { grantId });
        return unavailable();
      }
      return Response.json(
        { storageId },
        { status: 201, headers: corsHeaders },
      );
    } catch {
      if (storageId !== undefined && !bound) {
        await ctx.storage.delete(storageId).catch(() => undefined);
      }
      if (claimed && !bound) {
        await ctx.runMutation(releaseGrant, { grantId }).catch(() => false);
      }
      return unavailable();
    }
  },
);
