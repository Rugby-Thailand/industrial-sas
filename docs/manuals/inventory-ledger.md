# Inventory ledger manual

Status: **Backend surface; undeployed.** Six warehouse-scoped Convex functions are
implemented and tested: post, reverse, transaction detail, transaction history,
balance list, and bucket reconciliation. There is no deployed backend or operator UI.

## Who this is for

- Warehouse managers and inventory controllers
- Developers integrating inbound, QC, putaway, adjustment, or reporting workflows
- Auditors investigating immutable inventory history

## Permissions

| Operation                           | Permission                      |
| ----------------------------------- | ------------------------------- |
| Post a balanced transaction         | `inventory.transaction.post`    |
| Reverse a transaction               | `inventory.transaction.reverse` |
| Read a transaction or history       | `inventory.history.read`        |
| Read balances or reconcile a bucket | `inventory.balance.read`        |

Reversal also requires recent step-up, maker-checker separation from the original
poster, and threshold policy facts.

## Public functions

- `inventory/ledger:postTransaction`
- `inventory/ledger:reverseTransaction`
- `inventory/ledger:getTransaction`
- `inventory/ledger:listTransactions`
- `inventory/ledger:listBalances`
- `inventory/ledger:reconcileBucket`

The maximum list/reconciliation page is 100 rows; the default is 50.

## Post a transaction

Supply:

- `warehouseId`;
- a client-generated UUIDv7 `requestId`, stable across retries;
- transaction `type`;
- opaque source `{ type, id }`;
- optional reason code and installation ID;
- 2–200 signed ledger lines.

Each line supplies item, location kind, physical location or virtual boundary,
optional lot/HU/owner, stock status, and exact quantity `{ uom, minorUnits }`.
`minorUnits` is integer thousandths of the item's base UOM.

Do not supply organization, actor, server time, device document ID, serial ID, or a
balance. The server owns those values.

## Posting rules

1. Request identity is checked before writes. A replay with the same canonical
   arguments returns the original result with `replayed: true`; different arguments
   under the same ID are refused.
2. Every reference is tenant checked and relationship checked.
3. Lines are canonicalized and must balance within each conservation group.
4. Zero lines, invalid boundary direction, wrong UOM, and excessive magnitude fail.
5. Resulting physical `AVAILABLE` inventory cannot be negative.
6. Header, lines, balance projection, audit event, and idempotency record are written
   in one transaction.

Successful result:

```text
{ posted: true, replayed, transaction, balances }
```

Business refusal:

```text
{ posted: false, error: { code, ...diagnosticFields } }
```

Authorization denial is outside that domain envelope: `{ ok: false, denial }`.

## Transaction types

`RECEIPT`, `PUTAWAY`, `MOVE`, `STATUS_CHANGE`, `ADJUSTMENT`, `SCRAP`, `SHIPMENT`,
`PRODUCTION_ISSUE`, `PRODUCTION_RECEIPT`, and `REVERSAL`.

Adjustment, scrap, reversal, and status-change operations require appropriately
scoped reason codes.

## Reverse a transaction

1. Select the original transaction in the same authorized warehouse.
2. Generate a new UUIDv7 request ID.
3. Select a `REVERSAL` reason code.
4. Complete step-up authentication and maker-checker approval.
5. Call `reverseTransaction`.

The original remains unchanged. The reversal is a new exact compensating transaction.
A reversal cannot be reversed, an original cannot be reversed twice, and the same
person who posted the original cannot approve its reversal.

## Read balances and history

Use `listTransactions` and `listBalances` with `maxPageSize` and the opaque returned
cursor. Continue until `complete` is true. Do not infer completion from item count.

`getTransaction` returns its immutable lines plus the current balances of the touched
buckets. A foreign or out-of-warehouse transaction is reported without revealing
cross-tenant existence.

## Reconcile a bucket

Reconciliation replays ledger lines and reports drift; it never repairs balances.

1. Start with the bucket key, no cursor, and no carry values.
2. Call `reconcileBucket` with a page size of at most 100.
3. Pass `nextCursor`, `carryUom`, and `carryMinorUnits` unchanged into the next call.
4. Repeat until `complete` is true.
5. Read `drift` only from the final page.
6. If drift exists, follow the ledger-drift runbook. Never edit a balance directly.

Drift kinds are `MISSING_BALANCE`, `EXTRA_BALANCE`, `QUANTITY_MISMATCH`, and
`UOM_MISMATCH`.

## Troubleshooting

- `REQUEST_ARGUMENT_CONFLICT`: a request ID was reused for different arguments;
  generate a new ID for the new intent.
- `NEGATIVE_AVAILABLE_BALANCE`: correct the source quantity/location; do not bypass
  by writing the balance.
- `TRANSACTION_OUT_OF_WAREHOUSE_SCOPE` or `BUCKET_OUT_OF_WAREHOUSE_SCOPE`: use the
  selected warehouse and membership assignment.
- `PAGE_SIZE_TOO_LARGE`: reduce the requested page to 100 or less.
- Reconciliation drift: stop corrective automation and execute the documented
  incident/runbook process.

## Implementation references

- `convex/inventory/ledger.ts`
- `convex/lib/inventoryLedgerStore.ts`
- `convex/model/inventory/ledgerTransaction.ts`
- `convex/model/inventory/balanceProjection.ts`
- `convex/model/inventory/reversal.ts`
- [Append-only ledger ADR](../adr/0003-append-only-inventory-ledger.md)
- [Ledger drift runbook](../runbooks/ledger-drift.md)
