import type { GenericId } from "convex/values";
import { describe, expect, it, vi } from "vitest";

import { createPrivateFileStorage } from "../../convex/lib/privateFileStorage";

describe("private file storage adapter", () => {
  it("resolves only stored objects without exposing raw upload grants", async () => {
    const getUrl = vi.fn(async (id: GenericId<"_storage">) =>
      String(id) === "stored_1" ? "https://private.invalid/stored_1" : null,
    );
    const remove = vi.fn(async () => undefined);
    const getMetadata = vi.fn(async (id: GenericId<"_storage">) =>
      String(id) === "stored_1"
        ? {
            sha256: "a".repeat(64),
            size: 42,
            contentType: "application/pdf",
          }
        : null,
    );
    const storage = createPrivateFileStorage({
      getUrl,
      getMetadata,
      delete: remove,
    });

    await expect(storage.createDownloadUrl("stored_1")).resolves.toBe(
      "https://private.invalid/stored_1",
    );
    await expect(storage.createDownloadUrl("missing")).resolves.toBeNull();
    await expect(storage.inspect("stored_1")).resolves.toEqual({
      sha256: "a".repeat(64),
      size: 42,
      contentType: "application/pdf",
    });
    await storage.delete("stored_1");
    expect(remove).toHaveBeenCalledOnce();
  });

  it("refuses write operations from a read-only context", async () => {
    const storage = createPrivateFileStorage({
      getUrl: async () => null,
    });
    await expect(storage.delete("stored_1")).rejects.toThrow(
      "requires a mutation context",
    );
  });
});
