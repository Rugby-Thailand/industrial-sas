import { api } from "../../../convex/_generated/api";
import { clientRef, type RefValue } from "./clientRef";
export const batchManagementRefs = {
  get: clientRef(api.finishedGoods.batchManagement.get),
  repackAvailable: clientRef(api.finishedGoods.batchManagement.repackAvailable),
};
export type ManagedBatch = NonNullable<
  RefValue<typeof batchManagementRefs.get>
>;
