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
