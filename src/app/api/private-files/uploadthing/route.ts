import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { NextResponse } from "next/server";
import { UTApi } from "uploadthing/server";

import type { TenantOutcome } from "@/lib/convex/ledgerApi";

const engineeringRedeemGrant = makeFunctionReference<
  "mutation",
  { readonly grantId: string },
  TenantOutcome<{
    readonly providerKey: string;
    readonly fileName: string;
  } | null>
>("engineering/files:redeemUploadThingMasterCardFileAccessGrant");

const productionRedeemGrant = makeFunctionReference<
  "mutation",
  { readonly grantId: string; readonly warehouseId: string },
  TenantOutcome<{
    readonly providerKey: string;
    readonly fileName: string;
  } | null>
>("engineering/files:redeemUploadThingFactoryPacketFileAccessGrant");

const unavailable = () =>
  new NextResponse("File access grant is unavailable.", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const grantId = url.searchParams.get("grantId");
    const productionWarehouseId = url.searchParams.get("warehouseId");
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
    if (grantId === null || grantId.length === 0 || convexUrl === undefined) {
      return unavailable();
    }

    const session = await auth();
    if (session.userId === null) return unavailable();
    const token =
      session.sessionClaims?.aud === "convex"
        ? await session.getToken()
        : await session.getToken({ template: "convex" });
    if (token === null) return unavailable();

    const client = new ConvexHttpClient(convexUrl);
    client.setAuth(token);
    const outcome =
      url.searchParams.get("scope") === "production"
        ? productionWarehouseId === null
          ? null
          : await client.mutation(productionRedeemGrant, {
              grantId,
              warehouseId: productionWarehouseId,
            })
        : await client.mutation(engineeringRedeemGrant, { grantId });
    if (outcome === null) return unavailable();
    if (!outcome.ok || outcome.value === null) return unavailable();

    const { ufsUrl } = await new UTApi().generateSignedURL(
      outcome.value.providerKey,
      { expiresIn: "1 minute" },
    );
    return NextResponse.redirect(ufsUrl, {
      status: 307,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(outcome.value.fileName)}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return unavailable();
  }
}
