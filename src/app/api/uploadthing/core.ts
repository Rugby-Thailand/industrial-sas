import { auth } from "@clerk/nextjs/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UTApi, UTFiles, UploadThingError } from "uploadthing/server";

import { signUploadThingCompletion } from "@/server/files/uploadThingReceipt";

const f = createUploadthing();
const utapi = new UTApi();

const input = z.object({
  grantId: z.string().min(1).max(256),
  contentDigest: z.string().regex(/^[0-9a-f]{64}$/),
});

const hashPrivateObject = async (
  providerKey: string,
): Promise<{ readonly digest: string; readonly byteSize: number }> => {
  const { ufsUrl } = await utapi.generateSignedURL(providerKey, {
    expiresIn: "1 minute",
  });
  const response = await fetch(ufsUrl, {
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok || response.body === null) {
    throw new UploadThingError("Uploaded file could not be verified");
  }
  const reader = response.body.getReader();
  const hash = createHash("sha256");
  let byteSize = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    byteSize += chunk.value.byteLength;
    hash.update(chunk.value);
  }
  return { digest: hash.digest("hex"), byteSize };
};

const registerWithConvex = async (payload: {
  readonly scope: "MASTER_CARD" | "OPERATOR_TASK" | "TRANSPORT";
  readonly grantId: string;
  readonly providerKey: string;
  readonly uploaderClerkUserId: string;
  readonly contentDigest: string;
  readonly contentType: string;
  readonly byteSize: number;
}): Promise<void> => {
  const siteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  const secret = process.env.UPLOADTHING_TOKEN?.trim();
  if (siteUrl === undefined || secret === undefined) {
    throw new UploadThingError("Private file registration is not configured");
  }
  const body = JSON.stringify(payload);
  const signature = await signUploadThingCompletion(body, secret);
  const response = await fetch(
    `${siteUrl.replace(/\/$/, "")}/internal/uploadthing/complete`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-industrial-file-signature": signature,
      },
      body,
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new UploadThingError("Private file registration was refused");
  }
};

export const uploadRouter = {
  masterCardFile: f(
    {
      // `blob` is UploadThing's catch-all route key. Keeping one key gives
      // engineering formats, PDFs, and optimized photos the same explicit cap.
      blob: {
        maxFileSize: "64MB",
        maxFileCount: 1,
        acl: "private",
        contentDisposition: "attachment",
      },
    },
    { awaitServerData: true },
  )
    .input(input)
    .middleware(async ({ files, input: routeInput }) => {
      const session = await auth();
      if (session.userId === null) {
        throw new UploadThingError("You must sign in before uploading a file");
      }
      return {
        userId: session.userId,
        grantId: routeInput.grantId,
        contentDigest: routeInput.contentDigest,
        [UTFiles]: files.map((file) => ({
          ...file,
          customId: `master-card-${routeInput.grantId}`,
        })),
      };
    })
    .onUploadComplete(async ({ file, metadata }) => {
      try {
        const verified = await hashPrivateObject(file.key);
        if (
          verified.byteSize !== file.size ||
          verified.digest !== metadata.contentDigest
        ) {
          throw new UploadThingError("Uploaded file verification failed");
        }
        const contentType = file.type || "application/octet-stream";
        await registerWithConvex({
          scope: "MASTER_CARD",
          grantId: metadata.grantId,
          providerKey: file.key,
          uploaderClerkUserId: metadata.userId,
          contentDigest: verified.digest,
          contentType,
          byteSize: verified.byteSize,
        });
        return {
          providerKey: file.key,
          contentDigest: verified.digest,
          contentType,
          byteSize: verified.byteSize,
        };
      } catch (error) {
        await utapi.deleteFiles(file.key).catch(() => undefined);
        if (error instanceof UploadThingError) throw error;
        throw new UploadThingError("Uploaded file verification failed");
      }
    }),
  operatorTaskFile: f(
    {
      blob: {
        maxFileSize: "64MB",
        maxFileCount: 1,
        acl: "private",
        contentDisposition: "attachment",
      },
    },
    { awaitServerData: true },
  )
    .input(input)
    .middleware(async ({ files, input: routeInput }) => {
      const session = await auth();
      if (session.userId === null) {
        throw new UploadThingError("You must sign in before uploading a file");
      }
      return {
        userId: session.userId,
        grantId: routeInput.grantId,
        contentDigest: routeInput.contentDigest,
        [UTFiles]: files.map((file) => ({
          ...file,
          customId: `operator-task-${routeInput.grantId}`,
        })),
      };
    })
    .onUploadComplete(async ({ file, metadata }) => {
      try {
        const verified = await hashPrivateObject(file.key);
        if (
          verified.byteSize !== file.size ||
          verified.digest !== metadata.contentDigest
        ) {
          throw new UploadThingError("Uploaded file verification failed");
        }
        const contentType = file.type || "application/octet-stream";
        await registerWithConvex({
          scope: "OPERATOR_TASK",
          grantId: metadata.grantId,
          providerKey: file.key,
          uploaderClerkUserId: metadata.userId,
          contentDigest: verified.digest,
          contentType,
          byteSize: verified.byteSize,
        });
        return {
          providerKey: file.key,
          contentDigest: verified.digest,
          contentType,
          byteSize: verified.byteSize,
        };
      } catch (error) {
        await utapi.deleteFiles(file.key).catch(() => undefined);
        if (error instanceof UploadThingError) throw error;
        throw new UploadThingError("Uploaded file verification failed");
      }
    }),
  transportFile: f(
    {
      blob: {
        maxFileSize: "64MB",
        maxFileCount: 1,
        acl: "private",
        contentDisposition: "attachment",
      },
    },
    { awaitServerData: true },
  )
    .input(input)
    .middleware(async ({ files, input: routeInput }) => {
      const session = await auth();
      if (session.userId === null) {
        throw new UploadThingError("You must sign in before uploading a file");
      }
      return {
        userId: session.userId,
        grantId: routeInput.grantId,
        contentDigest: routeInput.contentDigest,
        [UTFiles]: files.map((file) => ({
          ...file,
          customId: `transport-${routeInput.grantId}`,
        })),
      };
    })
    .onUploadComplete(async ({ file, metadata }) => {
      try {
        const verified = await hashPrivateObject(file.key);
        if (
          verified.byteSize !== file.size ||
          verified.digest !== metadata.contentDigest
        ) {
          throw new UploadThingError("Uploaded file verification failed");
        }
        const contentType = file.type || "application/octet-stream";
        await registerWithConvex({
          scope: "TRANSPORT",
          grantId: metadata.grantId,
          providerKey: file.key,
          uploaderClerkUserId: metadata.userId,
          contentDigest: verified.digest,
          contentType,
          byteSize: verified.byteSize,
        });
        return {
          providerKey: file.key,
          contentDigest: verified.digest,
          contentType,
          byteSize: verified.byteSize,
        };
      } catch (error) {
        await utapi.deleteFiles(file.key).catch(() => undefined);
        if (error instanceof UploadThingError) throw error;
        throw new UploadThingError("Uploaded file verification failed");
      }
    }),
} satisfies FileRouter;

export type UploadRouter = typeof uploadRouter;
