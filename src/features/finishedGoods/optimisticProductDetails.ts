import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionArgs } from "convex/server";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";

/** Only existing active products with purely descriptive edits qualify. */
export function optimisticProductDetails(
  store: OptimisticLocalStore,
  args: FunctionArgs<typeof fgRefs.saveProduct>,
) {
  if (!args.productId || args.draft) return;
  const query = { warehouseId: args.warehouseId, productId: args.productId };
  const result = store.getQuery(fgRefs.getProduct, query);
  const product = result?.ok ? result.value : undefined;
  if (
    !result?.ok ||
    !product ||
    product.status !== "ACTIVE" ||
    product.updatedAt !== args.expectedUpdatedAt ||
    product.sku !== args.sku ||
    product.unit !== args.unit ||
    product.storageCondition !== args.storageCondition
  )
    return;
  store.setQuery(fgRefs.getProduct, query, {
    ...result,
    value: {
      ...product,
      name: args.name,
      notes: args.notes ?? "",
      customerReference: args.customerReference ?? "",
      productReference: args.productReference ?? "",
    },
  });
}
