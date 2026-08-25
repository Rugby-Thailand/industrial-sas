import type { GenericId } from "convex/values";

export interface PrivateFileStoragePort {
  readonly inspect: (storageId: string) => Promise<PrivateFileMetadata | null>;
  readonly createDownloadUrl: (storageId: string) => Promise<string | null>;
  readonly delete: (storageId: string) => Promise<void>;
}

export interface PrivateFileMetadata {
  readonly sha256: string;
  readonly size: number;
  readonly contentType: string | null;
}

interface RawStorageReader {
  readonly getUrl: (storageId: GenericId<"_storage">) => Promise<string | null>;
  readonly getMetadata?: (
    storageId: GenericId<"_storage">,
  ) => Promise<PrivateFileMetadata | null>;
}

interface RawStorageWriter extends RawStorageReader {
  readonly delete: (storageId: GenericId<"_storage">) => Promise<void>;
}

export function createPrivateFileStorage(
  storage: RawStorageReader & Partial<RawStorageWriter>,
  inspectStoredFile?: (
    storageId: GenericId<"_storage">,
  ) => Promise<PrivateFileMetadata | null>,
): PrivateFileStoragePort {
  return Object.freeze({
    inspect: async (storageId: string) => {
      if (inspectStoredFile !== undefined) {
        return await inspectStoredFile(storageId as GenericId<"_storage">);
      }
      if (storage.getMetadata === undefined) {
        throw new Error("File metadata inspection is unavailable.");
      }
      return await storage.getMetadata(storageId as GenericId<"_storage">);
    },
    createDownloadUrl: async (storageId: string) =>
      await storage.getUrl(storageId as GenericId<"_storage">),
    delete: async (storageId: string) => {
      if (storage.delete === undefined) {
        throw new Error("File deletion requires a mutation context.");
      }
      await storage.delete(storageId as GenericId<"_storage">);
    },
  });
}
