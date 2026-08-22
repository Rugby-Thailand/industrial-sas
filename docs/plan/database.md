# Database

## Aim

Preserve truth, keep reads fast, and scale without global locks.

## Principles

1. Normalize source data.
2. Denormalize named read models.
3. Index frequent filters and sorts only.
4. Use distributed IDs; never auto-increment.
5. Bound every list, job, and export.
6. Measure before adding cost.

## IDs

- Convex document IDs: internal references.
- UUIDv7/GUID: requests, events, and integrations.
- Provider ID: stored separately.
- Human code: normalized and unique within its tenant scope.
- No global mutable counter.

## Source tables

Normalize:

- Organizations, users, memberships, roles.
- Warehouses, locations, items, UOMs, partners.
- Orders, receipts, QC, tasks, handling units.
- Customers, master cards, revisions, design requests, packets.
- Ledger, audit, idempotency, outbox.

## Read models

Denormalize only for proven reads:

- Stock balance buckets.
- Dashboard rollups.
- Occupancy maps.
- Search and list rows.
- Export snapshots.

Copied names and labels are display data, never authority. Record their source and refresh rule.

## Indexes

- Start each tenant index with `orgId`.
- Add `warehouseId` next when warehouse-scoped.
- Order remaining fields by equality, range, then sort use.
- Use indexes for pagination; avoid full scans and post-page filters.
- Remove unused indexes after measurement.

Example:

`orgId → warehouseId → status → updatedAt`

## Write path

- Append ledger and audit facts.
- Update balance projections in the same transaction.
- Reject duplicate idempotency keys.
- Reverse; never edit posted facts.
- Use an outbox for external effects.

The local provider-neutral outbox separates three facts:

- `integrationAdapters` names an approved server-side configuration reference and
  health state; it never stores credentials.
- `integrationOutboxMessages` owns the stable event key, schema version, payload
  digest, lease, retry/backoff, and terminal state.
- `integrationDeliveryAttempts` is immutable evidence for each provider attempt;
  response bodies and tenant payloads are excluded.

The source mutation and outbox append must share one Convex transaction. A future
worker may claim and deliver the event, but it may not reconstruct or rewrite the
already-committed source business fact.

### Customer demand routing

- `fulfillmentOrders` owns the aggregate route (`AVAILABLE_STOCK`, `PRODUCTION`, or
  `MIXED`) and a monotonic route version.
- `fulfillmentLines` is the one demand row per customer-order line. It records the
  ATP-backed available-stock plan, exact production shortage, route decision/time,
  and conserved execution quantities.
- `factoryPackets.fulfillmentLineId` proves that production handoff followed routing.
- `productionOrders.fulfillmentLineId` and `planningSource` explain whether the run
  target came from routed shortage or a legacy packet. Multiple completed runs may
  share a packet, while the application refuses overlapping active runs.
- `by_orgId_warehouseId_itemId_routedAt` supports a bounded sum of unallocated stock
  commitments so two draft lines cannot claim the same ATP.

## Contention

Partition balance rows by:

`tenant + warehouse + item + location + lot + status + owner + handling unit`

Avoid hot tenant-wide rows. Use partitioned rollups, aggregate trees, and chunked jobs.

## Limits

- Cursor pagination for all lists.
- Explicit page and batch caps.
- Resumable jobs with checkpoints.
- Time and row budgets for exports.
- Archive policy from legal and product needs.

## Measure

- Rows and bytes per tenant.
- Read/write latency.
- Conflicts and retries.
- Index, storage, and bandwidth cost.
- Job lag and failure rate.
- Projection drift.

## Change

Use `expand → migrate → verify → contract`.

1. Add fields and indexes before readers.
2. Backfill in bounded, resumable batches.
3. Reconcile source and projections.
4. Switch readers.
5. Remove old paths after proof.

Restore tests and tenant exports are launch gates, not optional work.
