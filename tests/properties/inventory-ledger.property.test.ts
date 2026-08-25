import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  applyPostings,
  applyPostingsChecked,
  balanceAt,
  balanceEntries,
  emptyBalanceSheet,
  projectBalances,
  reconcileBalances,
  type BalanceSheet,
  type LedgerPosting,
} from "../../convex/model/inventory/balanceProjection";
import {
  validateLedgerTransaction,
  type LedgerLineDraft,
  type LedgerTransactionDraft,
} from "../../convex/model/inventory/ledgerTransaction";
import {
  makeJobPage,
  makeJobPageRequest,
  nextJobPageRequest,
  MAX_JOB_PAGE_SIZE,
} from "../../convex/model/inventory/jobPage";
import {
  canonicalArgumentText,
  encodeRequestNamespace,
  validateRequestId,
} from "../../convex/model/inventory/requestIdentity";
import { planReversal } from "../../convex/model/inventory/reversal";
import {
  decodeBucketKey,
  encodeBucketKey,
  validateBucket,
  STOCK_STATUSES,
  type InventoryBucket,
  type StockStatus,
} from "../../convex/model/inventory/stockIdentity";
import { makeQuantity, type Quantity } from "../../convex/model/uom/quantity";

const UOM = "PCS";

const quantity = (minorUnits: number): Quantity => {
  const made = makeQuantity(minorUnits, UOM);
  if (!made.ok) throw new Error("generated quantity is out of range");
  return made.value;
};

const component = fc.stringMatching(/^[A-Za-z0-9_.-]{1,12}$/);

const stockStatus: fc.Arbitrary<StockStatus> = fc.constantFrom(
  ...STOCK_STATUSES,
);

const location = fc.oneof(
  component.map((locationId) => ({ kind: "PHYSICAL" as const, locationId })),
  fc
    .constantFrom(
      "SUPPLIER_RECEIPT",
      "CUSTOMER_RETURN",
      "CUSTOMER_SHIPMENT",
      "PRODUCTION_ISSUE",
      "PRODUCTION_RECEIPT",
      "INVENTORY_ADJUSTMENT",
      "SCRAP_DAMAGE",
      "RECONCILIATION",
      "TRANSFER_IN_TRANSIT",
    )
    .map((boundary) => ({
      kind: "VIRTUAL" as const,
      boundary: boundary as never,
    })),
);

const arbitraryBucket: fc.Arbitrary<InventoryBucket> = fc.record(
  {
    orgId: component,
    warehouseId: component,
    itemId: component,
    location,
    lotId: fc.option(component, { nil: undefined }),
    serialId: fc.option(component, { nil: undefined }),
    handlingUnitId: fc.option(component, { nil: undefined }),
    ownerId: fc.option(component, { nil: undefined }),
    stockStatus,
  },
  {
    requiredKeys: ["orgId", "warehouseId", "itemId", "location", "stockStatus"],
  },
);

const requestId = fc
  .tuple(
    fc.stringMatching(/^[0-9a-f]{12}$/),
    fc.stringMatching(/^[0-9a-f]{3}$/),
    fc.constantFrom("8", "9", "a", "b"),
    fc.stringMatching(/^[0-9a-f]{3}$/),
    fc.stringMatching(/^[0-9a-f]{12}$/),
  )
  .map(
    ([time, rest, variant, tail, node]) =>
      `${time.slice(0, 8)}-${time.slice(8)}-7${rest}-${variant}${tail}-${node}`,
  );

interface MovementPlan {
  readonly orgId: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly lotId: string | undefined;
  readonly source: InventoryBucket;
  readonly destinations: readonly { bucket: InventoryBucket; units: number }[];
}

const movement: fc.Arbitrary<MovementPlan> = fc
  .record({
    orgId: component,
    warehouseId: component,
    itemId: component,
    lotId: fc.option(component, { nil: undefined }),
    sourceLocation: component,
    splits: fc.array(
      fc.record({
        locationId: component,
        stockStatus,
        units: fc.integer({ min: 1, max: 1_000_000 }),
      }),
      { minLength: 1, maxLength: 5 },
    ),
  })
  .map(
    ({
      orgId,
      warehouseId,
      itemId,
      lotId,
      sourceLocation,
      splits,
    }): MovementPlan => {
      const base = {
        orgId,
        warehouseId,
        itemId,
        ...(lotId === undefined ? {} : { lotId }),
      };

      const seen = new Set<string>();
      const destinations: { bucket: InventoryBucket; units: number }[] = [];
      for (const split of splits) {
        const key = `${split.locationId}\u0000${split.stockStatus}`;
        if (key === `${sourceLocation}\u0000AVAILABLE` || seen.has(key))
          continue;
        seen.add(key);
        destinations.push({
          bucket: {
            ...base,
            location: { kind: "PHYSICAL", locationId: split.locationId },
            stockStatus: split.stockStatus,
          },
          units: split.units,
        });
      }
      return {
        orgId,
        warehouseId,
        itemId,
        lotId,
        source: {
          ...base,
          location: { kind: "VIRTUAL", boundary: "SUPPLIER_RECEIPT" as never },
          stockStatus: "AVAILABLE" as StockStatus,
        },
        destinations,
      };
    },
  )
  .filter((plan) => plan.destinations.length > 0);

const draftOf = (
  plan: MovementPlan,
  id: string,
  occurredAt: number,
): LedgerTransactionDraft => {
  const total = plan.destinations.reduce(
    (sum, destination) => sum + destination.units,
    0,
  );
  const lines: LedgerLineDraft[] = [
    { bucket: plan.source, quantity: quantity(-total) },
    ...plan.destinations.map((destination) => ({
      bucket: destination.bucket,
      quantity: quantity(destination.units),
    })),
  ];
  return {
    orgId: plan.orgId,
    warehouseId: plan.warehouseId,
    type: "RECEIPT",
    operation: "inventory.transaction.post",
    requestId: id,
    actorUserId: "user1",
    occurredAt,
    source: { type: "PURCHASE_ORDER", id: "po1" },
    lines,
  };
};

const keyOf = (bucket: InventoryBucket): string => {
  const encoded = encodeBucketKey(bucket);
  if (!encoded.ok) throw new Error("generated bucket is invalid");
  return encoded.value;
};

const sheetOrThrow = (
  result: ReturnType<typeof applyPostings>,
): BalanceSheet => {
  if (!result.ok) throw new Error(`unexpected refusal: ${result.error.code}`);
  return result.value;
};

describe("canonical bucket keys never alias", () => {
  it("decodes back to the bucket it encoded, for every valid bucket", () => {
    fc.assert(
      fc.property(arbitraryBucket, (bucket) => {
        const encoded = encodeBucketKey(bucket);
        expect(encoded.ok).toBe(true);
        if (!encoded.ok) return;
        const decoded = decodeBucketKey(encoded.value);
        expect(decoded.ok).toBe(true);
        if (!decoded.ok) return;
        const normalized = validateBucket(bucket);
        if (!normalized.ok) throw new Error("bucket should validate");
        expect(decoded.value).toEqual(normalized.value);
      }),
      { numRuns: 500 },
    );
  });

  it("gives two different buckets two different keys", () => {
    fc.assert(
      fc.property(arbitraryBucket, arbitraryBucket, (left, right) => {
        const leftKey = keyOf(left);
        const rightKey = keyOf(right);
        const leftNormal = validateBucket(left);
        const rightNormal = validateBucket(right);
        if (!leftNormal.ok || !rightNormal.ok) return;
        const same =
          JSON.stringify(leftNormal.value) ===
          JSON.stringify(rightNormal.value);
        expect(leftKey === rightKey).toBe(same);
      }),
      { numRuns: 500 },
    );
  });

  it("negative control: a delimiter-join over unrestricted components aliases", () => {
    const unrestricted = fc
      .array(fc.constantFrom("a", "b", "|"), { maxLength: 4 })
      .map((characters) => characters.join(""));
    const pair = fc.tuple(unrestricted, unrestricted);

    const joined = ([left, right]: readonly [string, string]): string =>
      `${left}|${right}`;
    const lengthPrefixed = ([left, right]: readonly [string, string]): string =>
      `${left.length}:${left}|${right.length}:${right}`;

    const joinIsInjective = (): void => {
      fc.assert(
        fc.property(pair, pair, (left, right) => {
          const same = left[0] === right[0] && left[1] === right[1];
          expect(joined(left) === joined(right)).toBe(same);
        }),
        { numRuns: 2_000, seed: 20260804 },
      );
    };
    expect(joinIsInjective).toThrow();

    fc.assert(
      fc.property(pair, pair, (left, right) => {
        const same = left[0] === right[0] && left[1] === right[1];
        expect(lengthPrefixed(left) === lengthPrefixed(right)).toBe(same);
      }),
      { numRuns: 2_000, seed: 20260804 },
    );
  });
});

describe("every valid transaction balances", () => {
  it("accepts a generated movement and reports zero for every group", () => {
    fc.assert(
      fc.property(movement, requestId, (plan, id) => {
        const validated = validateLedgerTransaction(draftOf(plan, id, 1_000));
        expect(validated.ok).toBe(true);
        if (!validated.ok) return;
        for (const total of validated.value.conservation) {
          expect(total.minorUnits).toBe(0);
        }
        // Deltas sum to zero across the whole transaction too, because there is
        // exactly one item and one lot in a generated movement.
        const sum = validated.value.deltas.reduce(
          (running, delta) => running + delta.quantity.minorUnits,
          0,
        );
        expect(sum).toBe(0);
      }),
      { numRuns: 300 },
    );
  });

  it("refuses the same movement with any single line perturbed", () => {
    fc.assert(
      fc.property(
        movement,
        requestId,
        fc.integer({ min: 1, max: 1_000 }),
        (plan, id, drift) => {
          const draft = draftOf(plan, id, 1_000);
          const perturbed: LedgerTransactionDraft = {
            ...draft,
            lines: draft.lines.map((line, index) =>
              index === 0
                ? {
                    ...line,
                    quantity: quantity(line.quantity.minorUnits + drift),
                  }
                : line,
            ),
          };
          const refused = validateLedgerTransaction(perturbed);
          expect(refused.ok).toBe(false);
          if (!refused.ok) {
            expect([
              "UNBALANCED_TRANSACTION",
              "BOUNDARY_DIRECTION_VIOLATION",
              "LINE_QUANTITY_INVALID",
              "CANONICALIZED_LINE_IS_ZERO",
            ]).toContain(refused.error.code);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("negative control: a validator that skips the balance check accepts a perturbation", () => {
    const weakened = (draft: LedgerTransactionDraft): boolean => {
      const validated = validateLedgerTransaction(draft);
      if (validated.ok) return true;
      return validated.error.code === "UNBALANCED_TRANSACTION";
    };
    const alwaysRefuses = (): void => {
      fc.assert(
        fc.property(movement, requestId, (plan, id) => {
          const draft = draftOf(plan, id, 1_000);
          const perturbed: LedgerTransactionDraft = {
            ...draft,
            lines: draft.lines.map((line, index) =>
              index === 1
                ? { ...line, quantity: quantity(line.quantity.minorUnits + 1) }
                : line,
            ),
          };
          expect(weakened(perturbed)).toBe(false);
        }),
        { numRuns: 200, seed: 20260804 },
      );
    };
    expect(alwaysRefuses).toThrow();
  });
});

/* Replay equals projection                                                   */

describe("replay equals the incrementally applied projection", () => {
  const sequence = fc.array(fc.tuple(movement, requestId), {
    minLength: 1,
    maxLength: 6,
  });

  it("holds for any sequence of valid transactions", () => {
    fc.assert(
      fc.property(sequence, (transactions) => {
        const postings: LedgerPosting[] = [];
        let incremental = emptyBalanceSheet();

        for (const [index, [plan, id]] of transactions.entries()) {
          const validated = validateLedgerTransaction(
            draftOf(plan, id, 1_000 + index),
          );
          if (!validated.ok) return;
          postings.push(...validated.value.deltas);
          incremental = sheetOrThrow(
            applyPostings(incremental, validated.value.deltas),
          );
        }

        const replayed = projectBalances(postings);
        expect(replayed.ok).toBe(true);
        if (!replayed.ok) return;
        expect(balanceEntries(incremental)).toEqual(
          balanceEntries(replayed.value),
        );

        const drift = reconcileBalances(replayed.value, incremental);
        expect(drift.ok).toBe(true);
        if (drift.ok) expect(drift.value).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("is order-independent, because integer addition is", () => {
    fc.assert(
      fc.property(sequence, (transactions) => {
        const postings: LedgerPosting[] = [];
        for (const [index, [plan, id]] of transactions.entries()) {
          const validated = validateLedgerTransaction(
            draftOf(plan, id, 1_000 + index),
          );
          if (!validated.ok) return;
          postings.push(...validated.value.deltas);
        }
        const forward = projectBalances(postings);
        const backward = projectBalances([...postings].reverse());
        expect(forward.ok && backward.ok).toBe(true);
        if (!forward.ok || !backward.ok) return;
        expect(balanceEntries(backward.value)).toEqual(
          balanceEntries(forward.value),
        );
      }),
      { numRuns: 200 },
    );
  });

  it("negative control: a projection that drops zero balances stops matching", () => {
    const pruned = (sheet: BalanceSheet): unknown =>
      balanceEntries(sheet).filter((entry) => entry.quantity.minorUnits !== 0);

    const stillMatches = (): void => {
      fc.assert(
        fc.property(movement, requestId, (plan, id) => {
          const validated = validateLedgerTransaction(draftOf(plan, id, 1_000));
          if (!validated.ok) return;

          const reversed = validated.value.deltas.map((delta) => ({
            ...delta,
            quantity: quantity(-delta.quantity.minorUnits),
          }));
          const full = sheetOrThrow(
            applyPostings(
              sheetOrThrow(
                applyPostings(emptyBalanceSheet(), validated.value.deltas),
              ),
              reversed,
            ),
          );
          expect(pruned(full)).toEqual(balanceEntries(full));
        }),
        { numRuns: 100, seed: 20260804 },
      );
    };
    expect(stillMatches).toThrow();
  });
});

describe("a reversal restores the exact prior projection", () => {
  it("returns every touched bucket to the balance it had before", () => {
    fc.assert(
      fc.property(movement, requestId, requestId, (plan, postId, reverseId) => {
        const posted = validateLedgerTransaction(draftOf(plan, postId, 1_000));
        if (!posted.ok) return;

        const before = emptyBalanceSheet();
        const after = sheetOrThrow(applyPostings(before, posted.value.deltas));

        const reversal = planReversal({
          orgId: plan.orgId,
          operation: "inventory.transaction.reverse",
          requestId: reverseId,
          actorUserId: "user2",
          occurredAt: 2_000,
          reasonCodeId: "reason1",
          original: {
            transactionId: "tx1",
            orgId: plan.orgId,
            warehouseId: plan.warehouseId,
            type: "RECEIPT",
            lines: posted.value.lines.map((line) => ({
              bucket: line.bucket,
              quantity: line.quantity,
            })),
          },
          existingReversalId: null,
        });
        expect(reversal.ok).toBe(true);
        if (!reversal.ok) return;

        const restored = sheetOrThrow(
          applyPostings(after, reversal.value.deltas),
        );
        for (const entry of balanceEntries(restored)) {
          const original = balanceAt(before, entry.bucketKey);
          expect(entry.quantity.minorUnits).toBe(
            original?.quantity.minorUnits ?? 0,
          );
        }
      }),
      { numRuns: 200 },
    );
  });

  it("restores a non-empty prior projection exactly", () => {
    fc.assert(
      fc.property(
        movement,
        requestId,
        requestId,
        requestId,
        (plan, firstId, secondId, reverseId) => {
          const first = validateLedgerTransaction(
            draftOf(plan, firstId, 1_000),
          );
          const second = validateLedgerTransaction(
            draftOf(plan, secondId, 1_001),
          );
          if (!first.ok || !second.ok) return;

          const before = sheetOrThrow(
            applyPostings(emptyBalanceSheet(), first.value.deltas),
          );
          const after = sheetOrThrow(
            applyPostings(before, second.value.deltas),
          );

          const reversal = planReversal({
            orgId: plan.orgId,
            operation: "inventory.transaction.reverse",
            requestId: reverseId,
            actorUserId: "user2",
            occurredAt: 2_000,
            reasonCodeId: "reason1",
            original: {
              transactionId: "tx2",
              orgId: plan.orgId,
              warehouseId: plan.warehouseId,
              type: "RECEIPT",
              lines: second.value.lines.map((line) => ({
                bucket: line.bucket,
                quantity: line.quantity,
              })),
            },
            existingReversalId: null,
          });
          if (!reversal.ok) return;

          const restored = sheetOrThrow(
            applyPostings(after, reversal.value.deltas),
          );
          expect(balanceEntries(restored)).toEqual(balanceEntries(before));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("negative control: an off-by-one compensation does not restore", () => {
    const restores = (): void => {
      fc.assert(
        fc.property(movement, requestId, (plan, postId) => {
          const posted = validateLedgerTransaction(
            draftOf(plan, postId, 1_000),
          );
          if (!posted.ok) return;
          const after = sheetOrThrow(
            applyPostings(emptyBalanceSheet(), posted.value.deltas),
          );
          const weakened = posted.value.deltas.map((delta, index) => ({
            ...delta,
            quantity: quantity(
              -delta.quantity.minorUnits + (index === 0 ? 1 : 0),
            ),
          }));
          const restored = sheetOrThrow(applyPostings(after, weakened));
          for (const entry of balanceEntries(restored)) {
            expect(entry.quantity.minorUnits).toBe(0);
          }
        }),
        { numRuns: 100, seed: 20260804 },
      );
    };
    expect(restores).toThrow();
  });
});

describe("request identity", () => {
  it("accepts a generated UUIDv7 and namespaces it per organization", () => {
    fc.assert(
      fc.property(component, requestId, (orgId, id) => {
        expect(validateRequestId(id).ok).toBe(true);
        const namespace = encodeRequestNamespace({
          orgId,
          operation: "inventory.transaction.post",
          requestId: id,
        });
        expect(namespace.ok).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("gives two organizations different namespaces for the same request ID", () => {
    fc.assert(
      fc.property(component, component, requestId, (left, right, id) => {
        const leftKey = encodeRequestNamespace({
          orgId: left,
          operation: "inventory.transaction.post",
          requestId: id,
        });
        const rightKey = encodeRequestNamespace({
          orgId: right,
          operation: "inventory.transaction.post",
          requestId: id,
        });
        if (!leftKey.ok || !rightKey.ok) return;
        expect(leftKey.value === rightKey.value).toBe(left === right);
      }),
      { numRuns: 300 },
    );
  });

  it("hashes a retry's arguments equal and a changed argument unequal", () => {
    fc.assert(
      fc.property(movement, requestId, (plan, id) => {
        const first = validateLedgerTransaction(draftOf(plan, id, 1_000));

        const draft = draftOf(plan, id, 9_999);
        const retry = validateLedgerTransaction({
          ...draft,
          lines: [...draft.lines].reverse(),
        });
        if (!first.ok || !retry.ok) return;

        const canonical = (transaction: typeof first.value): string => {
          const text = canonicalArgumentText({
            orgId: transaction.header.orgId,
            warehouseId: transaction.header.warehouseId,
            type: transaction.header.type,
            requestId: transaction.header.requestId,
            lines: transaction.lines.map((line) => ({
              bucketKey: line.bucketKey,
              minorUnits: line.quantity.minorUnits,
            })),
          });
          if (!text.ok) throw new Error("expected a canonical rendering");
          return text.value;
        };
        expect(canonical(retry.value)).toBe(canonical(first.value));

        const changed = validateLedgerTransaction(
          draftOf(
            {
              ...plan,
              destinations: plan.destinations.map((destination, index) =>
                index === 0
                  ? { ...destination, units: destination.units + 1 }
                  : destination,
              ),
            },
            id,
            1_000,
          ),
        );
        if (!changed.ok) return;
        expect(canonical(changed.value)).not.toBe(canonical(first.value));
      }),
      { numRuns: 200 },
    );
  });
});

describe("an invalid posting fails without a partial result", () => {
  it("leaves the balance sheet it was given untouched", () => {
    fc.assert(
      fc.property(
        movement,
        requestId,
        fc.integer({ min: 1, max: 1_000 }),
        (plan, id, drift) => {
          const valid = validateLedgerTransaction(draftOf(plan, id, 1_000));
          if (!valid.ok) return;
          const before = sheetOrThrow(
            applyPostings(emptyBalanceSheet(), valid.value.deltas),
          );
          const snapshot = balanceEntries(before);

          const overdraw = valid.value.deltas
            .filter((delta) => delta.bucket.location.kind === "PHYSICAL")
            .map((delta) => ({
              ...delta,
              quantity: quantity(-delta.quantity.minorUnits - drift),
            }));
          if (overdraw.length === 0) return;

          const refused = applyPostingsChecked(before, overdraw);
          expect(refused.ok).toBe(false);
          if (!refused.ok) {
            expect([
              "NEGATIVE_AVAILABLE_BALANCE",
              "NEGATIVE_PHYSICAL_BALANCE",
            ]).toContain(refused.error.code);
          }
          expect(balanceEntries(before)).toEqual(snapshot);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("refuses an out-of-range magnitude rather than wrapping it", () => {
    fc.assert(
      fc.property(
        arbitraryBucket,
        fc.integer({ min: 500_000_000_001, max: 1_000_000_000_000 }),
        (bucket, half) => {
          const key = keyOf(bucket);
          const posting: LedgerPosting = {
            bucketKey: key,
            bucket,
            quantity: quantity(half),
          };
          const refused = applyPostings(emptyBalanceSheet(), [
            posting,
            posting,
          ]);
          expect(refused.ok).toBe(false);
          if (!refused.ok) {
            expect(refused.error.code).toBe("BALANCE_ARITHMETIC");
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("refuses a cross-organization line, whatever else is valid", () => {
    fc.assert(
      fc.property(movement, requestId, component, (plan, id, foreignOrg) => {
        if (foreignOrg === plan.orgId) return;
        const draft = draftOf(plan, id, 1_000);
        const refused = validateLedgerTransaction({
          ...draft,
          lines: draft.lines.map((line, index) =>
            index === 0
              ? {
                  ...line,
                  bucket: { ...line.bucket, orgId: foreignOrg },
                }
              : line,
          ),
        });
        expect(refused.ok).toBe(false);
        if (!refused.ok) {
          expect(refused.error.code).toBe("LINE_ORG_MISMATCH");
        }
      }),
      { numRuns: 300 },
    );
  });

  it("refuses a cross-warehouse line, whatever else is valid", () => {
    fc.assert(
      fc.property(movement, requestId, component, (plan, id, foreign) => {
        if (foreign === plan.warehouseId) return;
        const draft = draftOf(plan, id, 1_000);
        const refused = validateLedgerTransaction({
          ...draft,
          lines: draft.lines.map((line, index) =>
            index === 0
              ? {
                  ...line,
                  bucket: { ...line.bucket, warehouseId: foreign },
                }
              : line,
          ),
        });
        expect(refused.ok).toBe(false);
        if (!refused.ok) {
          expect(refused.error.code).toBe("LINE_WAREHOUSE_MISMATCH");
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("bounded job pages", () => {
  it("walks any row count in bounded, deterministic, terminating pages", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { maxLength: 40 }),
        fc.integer({ min: 1, max: MAX_JOB_PAGE_SIZE }),
        (rows, size) => {
          const walk = (): { pages: number; items: string[] } => {
            const items: string[] = [];
            let pages = 0;
            const first = makeJobPageRequest({ maxPageSize: size });
            if (!first.ok) throw new Error("expected a request");
            let current = first.value;
            for (;;) {
              pages += 1;
              if (pages > rows.length + 2) throw new Error("did not terminate");
              const slice = rows.slice(items.length, items.length + size);
              const done = items.length + slice.length >= rows.length;
              const page = makeJobPage(current, slice, {
                isDone: done,
                ...(done
                  ? {}
                  : { cursor: `after:${items.length + slice.length}` }),
              });
              if (!page.ok) throw new Error(page.error.code);
              items.push(...page.value.items);
              expect(page.value.items.length).toBeLessThanOrEqual(size);
              const next = nextJobPageRequest(page.value);
              if (!next.ok) throw new Error(next.error.code);
              if (next.value === null) break;
              current = next.value;
            }
            return { pages, items };
          };

          const first = walk();
          const second = walk();
          expect(first.items).toEqual(rows);
          expect(second).toEqual(first);
          expect(first.pages).toBe(Math.max(1, Math.ceil(rows.length / size)));
        },
      ),
      { numRuns: 300 },
    );
  });

  it("refuses any size above the cap", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_JOB_PAGE_SIZE + 1, max: 100_000 }),
        (size) => {
          const refused = makeJobPageRequest({ maxPageSize: size });
          expect(refused.ok).toBe(false);
          if (!refused.ok) {
            expect(refused.error.code).toBe("PAGE_SIZE_TOO_LARGE");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("negative control: a clamping request builder accepts an over-large size", () => {
    const clamped = (size: number) => ({
      maxPageSize: Math.min(size, MAX_JOB_PAGE_SIZE),
      cursor: null,
    });
    const refuses = (): void => {
      fc.assert(
        fc.property(
          fc.integer({ min: MAX_JOB_PAGE_SIZE + 1, max: 100_000 }),
          (size) => {
            expect(clamped(size).maxPageSize).toBe(size);
          },
        ),
        { numRuns: 50, seed: 20260804 },
      );
    };
    expect(refuses).toThrow();
  });
});
