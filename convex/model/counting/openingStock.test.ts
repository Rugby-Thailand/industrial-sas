import { describe, expect, it } from "vitest";

import { makeItemUomProfile } from "../uom/itemUom";
import { makeRatio } from "../uom/ratio";
import {
  buildOpeningStockTransactionChunk,
  decideOpeningStockApproval,
  decideOpeningStockPosted,
  decideOpeningStockRejection,
  decideOpeningStockSubmission,
  makeOpeningStockBatch,
} from "./openingStock";

const NOW = 1_700_000_000_000;
const HASH = "A".repeat(64);
const REQUEST_ID = "0192f0a0-1111-7abc-8def-0123456789ab";

function expectOk<T>(result: { ok: true; value: T } | { ok: false }): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected success");
  return result.value;
}

const validBatch = () =>
  expectOk(
    makeOpeningStockBatch({
      createdByUserId: "user_maker",
      sourceHash: HASH,
      cutoffAt: NOW,
      rowCount: 3,
      validRowCount: 3,
      validationErrorCount: 0,
    }),
  );

describe("opening-stock lifecycle", () => {
  it("normalizes source identity and requires a clean validation summary", () => {
    const batch = validBatch();
    expect(batch.sourceHash).toBe(HASH.toLowerCase());
    expect(batch.status).toBe("DRAFT");

    const invalid = expectOk(
      makeOpeningStockBatch({
        createdByUserId: "user_maker",
        sourceHash: HASH,
        cutoffAt: NOW,
        rowCount: 3,
        validRowCount: 2,
        validationErrorCount: 1,
      }),
    );
    const submitted = decideOpeningStockSubmission({
      state: invalid,
      actorUserId: "user_maker",
      now: NOW + 1,
    });
    expect(!submitted.ok && submitted.error.code).toBe(
      "VALIDATION_ERRORS_REMAIN",
    );
  });

  it("enforces maker-checker before an irreversible post", () => {
    const review = expectOk(
      decideOpeningStockSubmission({
        state: validBatch(),
        actorUserId: "user_maker",
        now: NOW + 1,
      }),
    );
    const selfApproval = decideOpeningStockApproval({
      state: review,
      actorUserId: "user_maker",
      now: NOW + 2,
    });
    expect(!selfApproval.ok && selfApproval.error.code).toBe(
      "MAKER_CHECKER_REQUIRED",
    );

    const approved = expectOk(
      decideOpeningStockApproval({
        state: review,
        actorUserId: "user_checker",
        now: NOW + 2,
      }),
    );
    const posted = expectOk(
      decideOpeningStockPosted({
        state: approved,
        actorUserId: "user_checker",
        transactionIds: ["tx_1", "tx_2"],
        now: NOW + 3,
      }),
    );
    expect(posted.status).toBe("POSTED");
    expect(posted.transactionIds).toEqual(["tx_1", "tx_2"]);
    expect(Object.isFrozen(posted.transactionIds)).toBe(true);
  });

  it("requires a bounded rejection reason", () => {
    const review = expectOk(
      decideOpeningStockSubmission({
        state: validBatch(),
        actorUserId: "user_maker",
        now: NOW + 1,
      }),
    );
    const rejected = expectOk(
      decideOpeningStockRejection({
        state: review,
        actorUserId: "user_checker",
        reason: " wrong warehouse ",
        now: NOW + 2,
      }),
    );
    expect(rejected).toMatchObject({
      status: "REJECTED",
      rejectionReason: "wrong warehouse",
    });
  });
});

describe("opening-stock ledger planning", () => {
  const profile = expectOk(
    makeItemUomProfile({
      itemKey: "item_1",
      baseUom: "PCS",
      alternates: [{ uom: "CASE", toBase: expectOk(makeRatio(12, 1)) }],
    }),
  );

  const bucket = {
    orgId: "org_1",
    warehouseId: "warehouse_1",
    itemId: "item_1",
    location: { kind: "PHYSICAL" as const, locationId: "location_1" },
    stockStatus: "AVAILABLE" as const,
  };

  it("converts entry UOM exactly and produces a balanced adjustment pair", () => {
    const draft = expectOk(
      buildOpeningStockTransactionChunk({
        orgId: "org_1",
        warehouseId: "warehouse_1",
        batchId: "batch_1",
        requestId: REQUEST_ID,
        actorUserId: "user_checker",
        occurredAt: NOW,
        reasonCodeId: "OPENING_BALANCE",
        rows: [
          {
            bucket,
            profile,
            entryUom: "CASE",
            entryMinorUnits: 2_000,
          },
        ],
      }),
    );
    expect(draft.type).toBe("ADJUSTMENT");
    expect(draft.source).toEqual({
      type: "OPENING_STOCK_BATCH",
      id: "batch_1",
    });
    expect(draft.lines).toHaveLength(2);
    expect(
      draft.lines.map((line) => line.quantity.minorUnits).sort((a, b) => a - b),
    ).toEqual([-24_000, 24_000]);
    expect(
      draft.lines.some((line) => line.bucket.location.kind === "VIRTUAL"),
    ).toBe(true);
  });

  it("rejects a non-physical opening row", () => {
    const result = buildOpeningStockTransactionChunk({
      orgId: "org_1",
      warehouseId: "warehouse_1",
      batchId: "batch_1",
      requestId: REQUEST_ID,
      actorUserId: "user_checker",
      occurredAt: NOW,
      reasonCodeId: "OPENING_BALANCE",
      rows: [
        {
          bucket: {
            ...bucket,
            location: {
              kind: "VIRTUAL" as const,
              boundary: "RECONCILIATION" as const,
            },
          },
          profile,
          entryUom: "PCS",
          entryMinorUnits: 1_000,
        },
      ],
    });
    expect(!result.ok && result.error.code).toBe("ROW_LOCATION_NOT_PHYSICAL");
  });
});
