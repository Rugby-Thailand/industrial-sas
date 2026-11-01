# Finished goods and temporary retention migration v1

Scope: no current users; intentionally retire the unused unpaged product-batch
endpoint. No pallet, batch, revision, ledger, payroll, audit or grant record is
removed by this migration. This document supersedes the initial partial lane status.

## Public contract decision

`finishedGoods/batches:listProductBatches` is removed. Production ProductBatches
already uses `pageProductBatches` and `pageLegacyUnits`, and resolves edit targets
independently of the current page. The remaining actual integration callers now
use `getBatch` to test unit editability. Old string names in UI fixture adapters
are mock dataset labels, not public API references or live calls.

`getBatch` no longer returns `history`; its result validator was `v.any()` but this
is still an intentional semantic migration. Current unit details remain available.
The lazy BatchHistory disclosure now calls `pageBatchRevisions` with 20 rows per
page (server permits 1..25). Immutable descending revisions use database cursors.
All revisions remain reachable; current-state reads never load revision history.
The product and legacy list cursors, locale, correction URL, editor drafts and
Back/Close owners remain unchanged. Revision pagination only changes inline
supporting content; the exact presentation targets were re-audited in inventory.

The public-function snapshot is deliberately edited to remove this single
obsolete contract, then refreshed for the added paged and internal functions.
No blanket breaking-change acceptance flag is used. Deploy frontend and backend
in a maintenance release with no active sessions. If supporting old clients
becomes necessary, retain an explicit compatibility backend until those sessions
expire; do not point old clients at a silently truncated replacement.

## Expand, verify, contract

1. Deploy additive indexes: pallets product/status and batch/retiredAt;
   placements assignment/sequence; payslip tickets tenant/expiry.
2. Deploy writers/readers and internal operations. No required document fields,
   backfill, business-record rewrite or history deletion is needed. Missing
   retiredAt includes legacy current units; current batch size is capped at 50,
   with explicit overflow failure rather than partial occupancy. Retired unit
   replacements remain reachable through revision pallet IDs.
3. Run duplicate audits in dry/read-only mode and review candidate findings.
   Deployment does not assume duplicate candidates are corruption. Repair only
   with domain-specific forward migrations and preserved history.
4. Record operator run metadata below, verify paged results and sweep dry-run
   counts, then run bounded cleanup. Never roll back to code that gives expired
   request IDs permanent replay semantics after cleanup has started.

## Uniqueness meaning

- Nonempty SKU: organization + warehouse + normalized SKU. Empty draft SKU is
  intentionally reusable. The product writer checks duplicates including edits.
- Buildings/zones: organization + warehouse + code. Building duplicate attempts
  are rejected; generated zone ordinals probe existing zone/location identities.
- Floors: organization + building + floor number; get-or-create/update retains
  one row, never appends another floor revision as a separate current floor.
- Frozen period rows: organization + version + employee + business date. This records the
  existing close writer's one row per employee/day behavior, with no HR close change.
- Placements: one live hold per pallet and status (RESERVED or STORED). A move
  intentionally retains a STORED source and RESERVED destination simultaneously. Released placements are
  history. LOCATION_ONLY members intentionally share positionCode and are
  distinguished by assignment + sequence. That latter key applies only when both
  fields exist. Geometric historical position labels are not globally unique.

`operations/duplicateAudit:page` is internal, read-only and tenant scoped. Pass
`orgId`, stable `contract` key below, `limit` (1..50), then returned `cursor` until
`isDone`. Each call scans at most 50 source rows plus at most two exact-key matches per
source row. Candidate IDs can repeat across pages. This is an online observation,
not a frozen full-tenant certification; rerun under a write pause for migration
sign-off. It never deletes or repairs data.

Supported contract keys:

- `finishedGoodsProducts.warehouseId+sku`
- `storageBuildings.warehouseId+code`
- `storageZones.warehouseId+code`
- `storageFloors.buildingId+floorNumber`
- `hrPeriodRows.versionId+employeeId+businessDate`
- `finishedGoodsPlacements.palletId+status`
- `finishedGoodsPlacements.assignmentId+sequence`

## Temporary retention and replay policy

Ordinary idempotency answers expire exactly at `expiresAt` (creation + 30 days).
Before that boundary the same arguments replay and different arguments conflict.
At/after it the key is fresh, even if cleanup has not run; a new successful write
atomically replaces its expired record. Domain constraints, revision checks and
authorization still apply. Reusing a key after 30 days can create a new business
operation. Clients must reconcile uncertainty within the window; the replay cache
is not a permanent business ledger. No old business result is deleted with it.
The direct zone-create receipt pre-read and HR reconciliation follow the same
boundary. HR reconciliation of an expired/unresolved command creates a permanent
cancellation fence; delayed commands remain rejected.

`Number.MAX_SAFE_INTEGER` idempotency expiries are permanent HR cancellation
markers. They remain live and are excluded from sweeps, including at the upper
cutoff boundary. Audit, payroll imports/rows, attendance events, leave ledgers,
scans, revisions and business history have **no deletion policy** in this change.

Payslip access tickets are temporary credentials: expiry is inclusive for cleanup.
Deleting an expired ticket leaves its payroll row/import untouched. Existing
session/employee authorization still guards documents.

Expired support grants are **not deleted**: audit events reference their IDs and
approval facts are history. Sweeps transition expired REQUESTED/APPROVED/ACTIVE
grants to EXPIRED; terminal REVOKED/REJECTED/EXPIRED facts remain unchanged.
Authorization already checks expiry, so this materializes state for operations.

## Operator procedure and tracking

Invoke internal `operations/temporaryRetention:sweep` for one `orgId` and one of
`idempotencyRecords`, `hrPayslipTickets`, `supportGrants`. Supply a fixed past
`cutoff` timestamp, `limit` 1..100, and `dryRun:true` initially. Follow the returned
cursor with the **same tenant/table/cutoff** until `isDone`. Dry run performs no
writes. Start the destructive pass from the beginning (`cursor` omitted), with
`dryRun:false`; do not reuse a completed dry-run cursor. Each page is atomic.
Resume a failed page with its last committed cursor. Repeating a run is safe.
Run at a scheduled operator cadence per tenant; no global cross-tenant cron scan
or unbounded automatic drain is introduced.

Persist an operator run record outside the swept tables: migration version 1,
tenant, table/contract, cutoff, dry-run mode, start/end timestamps, last committed
cursor, scanned/eligible/deleted/expired/retained totals, findings, and completion
verification. `expired` counts eligible grant transitions in dry runs and writes
in live runs; `retained` counts already terminal grants. Per-page output supplies
these metrics. Never sum dry-run and live deletions as one total. Dry runs are
point-in-time observations; concurrent new expired rows may require another pass.
Operators should compare repeated dry-run counts, sweep latency and backend read/
conflict metrics before increasing cadence. No production run has been performed.

Rollback: additive indexes may remain unused. Disable operator cleanup first.
Restore old cache records only if explicitly required from a backup; do not
restore expired credential validity. Forward-fix business outcomes using retained
source ledgers. Retention cannot recover removed replay-cache answers, and no
claim is made that it can.

`eligible` is the number of expired rows in the indexed page, including retained
terminal grant history; it is not a promise that every row will be deleted.
