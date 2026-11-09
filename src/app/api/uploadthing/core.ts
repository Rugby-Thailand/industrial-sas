import { auth } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError, UTFiles } from "uploadthing/server";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { signUploadReceipt } from "../../../../convex/lib/uploadReceipt";

const f = createUploadthing();
// Standard Schema keeps this boundary validated without adding a dependency.
const uploadInput = {
  "~standard": {
    version: 1 as const,
    vendor: "job-ticket-upload",
    validate(value: unknown) {
      if (
        value &&
        typeof value === "object" &&
        "warehouseId" in value &&
        typeof value.warehouseId === "string" &&
        value.warehouseId.length > 0 &&
        value.warehouseId.length <= 128
      )
        return { value: { warehouseId: value.warehouseId } };
      return { issues: [{ message: "Warehouse required" }] };
    },
  },
};
export const uploadRouter = {
  jobTicketImage: f(
    { image: { maxFileSize: "16MB", maxFileCount: 1 } },
    { awaitServerData: true },
  )
    .input<{ warehouseId: string }, { warehouseId: string }>(uploadInput)
    .middleware(async ({ input, files }) => {
      if (
        files.some(
          (file) =>
            !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
            file.size < 1,
        )
      )
        throw new UploadThingError("Unsupported photo");
      const session = await auth();
      if (!session.userId || !session.orgId)
        throw new UploadThingError("Unauthorized");
      const token = await session.getToken({ template: "convex" });
      if (!token) throw new UploadThingError("Unauthorized");
      const outcome = await fetchMutation(
        api.finishedGoods.attachments.createIntent,
        {
          // The registered validator, tenant resolver and permission gate validate this ID.
          warehouseId: input.warehouseId as Id<"warehouses">,
        },
        { token },
      );
      if (!outcome.ok || !outcome.value)
        throw new UploadThingError("Upload unavailable");
      const assetId = outcome.value.assetId;
      return {
        assetId,
        [UTFiles]: files.map((file) => ({ ...file, customId: assetId })),
      };
    })
    .onUploadComplete(async ({ file, metadata }) => {
      if (file.customId !== metadata.assetId)
        throw new Error("Upload identity mismatch");
      const receipt = {
        assetId: metadata.assetId,
        fileKey: file.key,
        url: file.ufsUrl,
        size: file.size,
        mimeType: file.type,
      };
      await fetchMutation(api.finishedGoods.attachments.finalizeUpload, {
        ...receipt,
        signature: await signUploadReceipt(receipt),
      });
      return { assetId: metadata.assetId, url: file.ufsUrl };
    }),
} satisfies FileRouter;
export type UploadRouter = typeof uploadRouter;
