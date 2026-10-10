import { describe, expect, it, vi } from "vitest";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionArgs } from "convex/server";
import {
  finishedGoodProduct,
  querySuccess,
} from "@tests/fixtures/finished-goods-ui";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { optimisticProductDetails } from "./optimisticProductDetails";

const payload: FunctionArgs<typeof fgRefs.saveProduct> = {
  warehouseId: "warehouse-a",
  productId: finishedGoodProduct._id,
  sku: finishedGoodProduct.sku,
  name: "New description",
  unit: finishedGoodProduct.unit,
  storageCondition: finishedGoodProduct.storageCondition,
  notes: "New note",
  draft: false,
  requestId: "safe-request",
};
function cache(value: unknown) {
  const setQuery = vi.fn();
  const store = {
    getQuery: () => value,
    setQuery,
    getAllQueries: () => [],
  } as OptimisticLocalStore;
  return { store, setQuery };
}
describe("descriptive product optimism", () => {
  it("copies only descriptions, preserving status and inventory fields", () => {
    const original = querySuccess({
      ...finishedGoodProduct,
      status: "ACTIVE" as const,
    });
    const { store, setQuery } = cache(original);
    optimisticProductDetails(store, payload);
    expect(setQuery).toHaveBeenCalledWith(
      fgRefs.getProduct,
      { warehouseId: payload.warehouseId, productId: payload.productId },
      expect.objectContaining({
        value: expect.objectContaining({
          name: payload.name,
          notes: payload.notes,
          status: "ACTIVE",
          defaultQuantity: finishedGoodProduct.defaultQuantity,
          storageFormat: finishedGoodProduct.storageFormat,
        }),
      }),
    );
    expect(original).toEqual(
      querySuccess({ ...finishedGoodProduct, status: "ACTIVE" as const }),
    );
    expect(setQuery).toHaveBeenCalledTimes(1);
  });
  it.each([
    { draft: true },
    { productId: undefined },
    { sku: "other" },
    { unit: "kg" },
    { storageCondition: "COOL" },
  ])("does not speculate on structural or status edits: %j", (patch) => {
    const { store, setQuery } = cache(
      querySuccess({ ...finishedGoodProduct, status: "ACTIVE" as const }),
    );
    optimisticProductDetails(store, { ...payload, ...patch } as FunctionArgs<
      typeof fgRefs.saveProduct
    >);
    expect(setQuery).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    { ok: false },
    querySuccess(null),
    querySuccess({ ...finishedGoodProduct, status: "DRAFT" as const }),
  ])("leaves unknown, denied and draft queries authoritative", (value) => {
    const { store, setQuery } = cache(value);
    optimisticProductDetails(store, payload);
    expect(setQuery).not.toHaveBeenCalled();
  });
});
