/**
 * Integration tier — reversal under retry, over `convex-test`.
 *
 * Scope: the one place where two refusals compete. `reverseLedgerTransaction`
 * reads `by_orgId_reversalOfTransactionId` before it posts, and a transaction
 * that already carries a reversal is `REVERSAL_ALREADY_EXISTS`. But a client
 * that retries the *same* request ID after a lost response is not asking for a
 * second reversal — it is asking for the answer it did not receive, and
 * `ADR-0003` says a duplicate `requestId` is a no-op returning the original
 * result (`RG-025`). These three cases fix which refusal wins:
 *
 * - the exact retry replays,
 * - the same request ID with a changed payload is `REQUEST_ARGUMENT_CONFLICT`,
 * - a genuinely different request reversing the same original is
 *   `REVERSAL_ALREADY_EXISTS` (`INV-0003-08`).
 *
 * All data is synthetic (`tests/fixtures/README.md`).
 */
import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import {
  postTransaction,
  reverseTransaction,
} from "../../convex/inventory/ledger";
import type { DataModel } from "../../convex/schema";
import {
  createConvexInventoryWorld,
  FIXTURE_UOM,
  type ConvexInventoryWorld,
} from "../fixtures/convex-inventory-world";
import {
  recordStepUp,
  seedSecondActorForOrgA,
} from "../fixtures/convex-tenant-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const run = (value: unknown) => value as RuntimeFunction;

const identity = (subject: string) => ({ subject, org_id: "org_fixture_a" });

/** The maker posts; the checker reverses. Maker-checker denies self-approval. */
const MAKER = "user_fixture_a";
const CHECKER = "user_fixture_a2";

async function call(
  world: ConvexInventoryWorld,
  subject: string,
  fn: unknown,
  args: unknown,
): Promise<Record<string, unknown>> {
  return (await world.t
    .withIdentity(identity(subject))
    .run(async (ctx) =>
      run(fn)._handler(ctx as GenericMutationCtx<DataModel>, args),
    )) as Record<string, unknown>;
}

/**
 * A world whose second actor may reverse what the first actor posted.
 *
 * `inventory.transaction.reverse` carries maker-checker and step-up, so the
 * checker is a different person and carries a fresh reverification. Neither is
 * what these cases are about — they are the cost of reaching the store at all.
 */
async function createWorld(): Promise<ConvexInventoryWorld> {
  const world = await createConvexInventoryWorld();
  const second = await seedSecondActorForOrgA(world, "WAREHOUSE_MANAGER");
  const now = Date.now();
  await recordStepUp(world, {
    orgId: world.orgA,
    userId: second.userId,
    occurredAt: now,
    reverifiedAt: now,
  });
  return world;
}

function value(outcome: Record<string, unknown>): Record<string, unknown> {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
}

/** One receipt, so there is something real to reverse. */
async function postReceipt(
  world: ConvexInventoryWorld,
  requestId: string,
): Promise<string> {
  const outcome = value(
    await call(world, MAKER, postTransaction, {
      warehouseId: world.warehouses.alphaA,
      requestId,
      type: "RECEIPT",
      source: { type: "TEST", id: requestId },
      lines: [
        {
          itemId: world.a.untrackedItem,
          locationKind: "PHYSICAL",
          locationId: world.a.rack,
          stockStatus: "AVAILABLE",
          quantity: { uom: FIXTURE_UOM, minorUnits: 5000 },
        },
        {
          itemId: world.a.untrackedItem,
          locationKind: "VIRTUAL",
          virtualBoundary: "SUPPLIER_RECEIPT",
          stockStatus: "AVAILABLE",
          quantity: { uom: FIXTURE_UOM, minorUnits: -5000 },
        },
      ],
    }),
  );
  expect(outcome["posted"], JSON.stringify(outcome)).toBe(true);
  const transaction = outcome["transaction"] as Record<string, unknown>;
  return transaction["transactionId"] as string;
}

async function reverse(
  world: ConvexInventoryWorld,
  input: {
    readonly originalTransactionId: string;
    readonly requestId: string;
    readonly reasonCodeId?: string;
  },
): Promise<Record<string, unknown>> {
  return value(
    await call(world, CHECKER, reverseTransaction, {
      warehouseId: world.warehouses.alphaA,
      originalTransactionId: input.originalTransactionId,
      requestId: input.requestId,
      reasonCodeId: input.reasonCodeId ?? world.a.reversalReason,
    }),
  );
}

const FIRST = "0193f2c1-0000-7000-8000-00000000f001";
const REVERSE_ID = "0193f2c1-0000-7000-8000-00000000f002";
const OTHER_REVERSE_ID = "0193f2c1-0000-7000-8000-00000000f003";
const SECOND = "0193f2c1-0000-7000-8000-00000000f004";

describe("reverseTransaction under retry", () => {
  it("replays the original reversal for an exact retry of the same request", async () => {
    const world = await createWorld();
    const original = await postReceipt(world, FIRST);

    const first = await reverse(world, {
      originalTransactionId: original,
      requestId: REVERSE_ID,
    });
    expect(first["posted"], JSON.stringify(first)).toBe(true);
    expect(first["replayed"]).toBe(false);

    const retry = await reverse(world, {
      originalTransactionId: original,
      requestId: REVERSE_ID,
    });
    expect(retry["posted"], JSON.stringify(retry)).toBe(true);
    expect(retry["replayed"]).toBe(true);
    expect(retry["transaction"]).toStrictEqual(first["transaction"]);
  });

  it("refuses a reused request ID whose payload changed", async () => {
    const world = await createWorld();
    const original = await postReceipt(world, FIRST);

    const first = await reverse(world, {
      originalTransactionId: original,
      requestId: REVERSE_ID,
    });
    expect(first["posted"], JSON.stringify(first)).toBe(true);

    // Same request ID, different reason: not the retry it claims to be.
    const conflict = await reverse(world, {
      originalTransactionId: original,
      requestId: REVERSE_ID,
      reasonCodeId: world.a.adjustmentReason,
    });
    expect(conflict["posted"], JSON.stringify(conflict)).toBe(false);
    expect((conflict["error"] as Record<string, unknown>)["code"]).toBe(
      "REQUEST_ARGUMENT_CONFLICT",
    );
  });

  it("refuses a second, genuinely different reversal of the same original", async () => {
    const world = await createWorld();
    const original = await postReceipt(world, FIRST);

    const first = await reverse(world, {
      originalTransactionId: original,
      requestId: REVERSE_ID,
    });
    expect(first["posted"], JSON.stringify(first)).toBe(true);

    const second = await reverse(world, {
      originalTransactionId: original,
      requestId: OTHER_REVERSE_ID,
    });
    expect(second["posted"], JSON.stringify(second)).toBe(false);
    expect((second["error"] as Record<string, unknown>)["code"]).toBe(
      "REVERSAL_ALREADY_EXISTS",
    );
  });

  it("refuses a request ID reused against a different original", async () => {
    const world = await createWorld();
    const original = await postReceipt(world, FIRST);
    const other = await postReceipt(world, SECOND);

    const first = await reverse(world, {
      originalTransactionId: original,
      requestId: REVERSE_ID,
    });
    expect(first["posted"], JSON.stringify(first)).toBe(true);

    const conflict = await reverse(world, {
      originalTransactionId: other,
      requestId: REVERSE_ID,
    });
    expect(conflict["posted"], JSON.stringify(conflict)).toBe(false);
    expect((conflict["error"] as Record<string, unknown>)["code"]).toBe(
      "REQUEST_ARGUMENT_CONFLICT",
    );
  });
});
