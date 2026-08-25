import { describe, expectTypeOf, it } from "vitest";

import type {
  ImportPreviewOutcome,
  PurchaseOrderRow,
  PurchaseOrderStatus,
  RankedLocation,
} from "./inboundApi";

describe("generated client contracts", () => {
  it("derives inbound models from backend validators", () => {
    expectTypeOf<PurchaseOrderRow["purchaseOrderId"]>().toEqualTypeOf<string>();
    expectTypeOf<
      PurchaseOrderRow["status"]
    >().toEqualTypeOf<PurchaseOrderStatus>();
    expectTypeOf<RankedLocation["locationId"]>().toEqualTypeOf<string>();
    expectTypeOf<ImportPreviewOutcome>().toHaveProperty("ok");
  });
});
