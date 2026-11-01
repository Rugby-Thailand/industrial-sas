# Finished goods lane implementation status

Implemented in the prepared isolated worktree; no production migrations or
browser acceptance were run. Parent owns current-main integration and acceptance.

- Product requirement edits use exact tenant/product/status existence ranges.
  RESERVED/STORED behavior and transactional occupancy protection are preserved.
- The live ProductBatches catalogue was already paged and is retained. Removed
  the unused unpaged API; migrated actual backend test callers to current detail.
  Lazy revision history now has bounded cursor pages. Current batch units use an
  active-unit index so retired replacement history cannot overflow detail reads.
  Active move lookups use exact status probes, never full movement history.
- Corrected placement uniqueness semantics: group position labels are shared;
  active pallet holds and assignment/sequence identities have conditional rules.
  Added supported SKU/building/zone/floor/frozen employee-day contracts and a
  bounded internal candidate audit. Writer regressions exercise duplicate SKU,
  duplicate building keys, concurrent zone allocation, shared LOCATION_ONLY
  labels, duplicate assignments and repeated period closure.
- Ordinary replay keys are reusable at/after their 30-day expiry, consistently
  before and after sweeping. Permanent HR cancellation fences remain permanent.
  Added bounded, resumable internal tenant sweeps with dry-run metrics for replay
  cache records and access tickets. Grants transition to EXPIRED and retain their
  approval/history rows. No business, audit or source-ledger deletion is included.
- Generation invalidation and warehouse counters remain synchronous and intact.
  Added concurrent occupancy/identity tests and recorded local bounded-read/load
  evidence, including fixtures above the old 10,000-row failure boundary.

See [migration and retention procedure](finished-goods-migration.md) for explicit
public-contract rationale, supported audit keys, deploy ordering, operator cursor
tracking and rollback limits. See [scale evidence](finished-goods-scale-evidence.md)
for measured read bounds, local timings and production evidence limitations.

Validation: broad affected suite passed 485 tests across 28 files; subsequent
focused tests passed with the corrected employee/day contract and new expiry
boundary case. Normal full ESLint, check:navigation (68 Node fixtures plus the
inventory), pinned Bun 1.4.3 checker, changed-file formatting, production schema
compatibility, public-function contract and credential-free codegen verification
passed. The original warehouse-scan writer failed the new >10,000 regression;
the indexed writer passed. No test failures were suppressed.

Remaining operational work belongs to deployment/integration: reconcile shared
schema/generated/snapshot files with the HR lane; run integrated browser
acceptance; perform operator dry runs and record real tenant sweep/audit progress;
measure backend retry/byte/subscription metrics before claiming production
capacity. There are no known unfinished implementation items in this lane.
