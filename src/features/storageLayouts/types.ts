import type { StorageReservedBlockRow } from "@/lib/convex/storageLayoutApi";

export type EditableBlock = Omit<StorageReservedBlockRow, "blockId"> & {
  readonly id: string;
};
