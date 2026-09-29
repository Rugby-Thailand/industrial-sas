# Convex database I/O optimization

Implemented 2026-09-29 after the account upgrade restored production queries.

## Baseline

The September team dashboard showed 4.23 GB database I/O, with 3.45 GB attributed to `storageLayouts/catalogue:getStorageBuilding`. Production's PD building read 323,099 bytes / 436 documents per uncached execution; FG1 read 38,458 bytes / 61 documents. Both measurements came from Convex execution `usageStats`, not response size. These buildings had no active placements at measurement time.

## Changes

- Ordinary authorized queries no longer read the wall clock just to mint a request ID. Query IDs are UUIDv4; audited writes retain timestamped UUIDv7 IDs.
- For a membership effective by its server-generated creation timestamp and with no expiry, authorization uses that timestamp as a trusted lower bound on the current time. This has the same authorization verdict at all later times and lets Convex reuse cached results. Future-effective memberships, expiring memberships, step-up permissions, custom policies, mutations and actions retain the current-time check. Membership, role, warehouse and permission reads remain reactive dependencies; revocation still invalidates cached results.
- Building, floor-editor, review and on-demand space-details views use independently cached layout and inventory queries. Inventory refreshes read the building's held/stored placements via the existing building/status index, then their pallets/products. They do not read floors, zones, positions or reserved blocks. Layout reads never access placements, products, pallets or moves.
- Move lookups are scoped to the unique pallets in the building, using the existing pallet/status index. Pallet and product joins are memoized within each query execution, including duplicate source/target holds.
- The location-map query resolves its floor once instead of twice.
- The UI waits for both query results before enabling the loaded view. It uses Convex's authenticated reactive cache; there is no persistent browser inventory cache, polling loop, or retained subscription for a closed space-details dialog.
- The legacy full-building query remains compatible with already deployed clients. No schema changes, indexes, migration or inventory writes are needed.

## Verification

- Full `pnpm check`: 122 test files, 1,016 tests passed.
- `pnpm build`: passed. `pnpm audit:prod`: no known vulnerabilities.
- The regression fixture with 101 zones verifies inventory refreshes read less than 25% of the full response's document count and serialized document bytes. Those local byte estimates are a regression guard, not a production billing estimate.
- Exact response parity covers geometric move source/target holds, deduplicated pallet counts, footprint union, position assignments, and unmeasured location-only packages.
- Tests cover cache-friendly ordinary reads, future/expired/revoked membership denial, tenant/warehouse isolation, loading without false empty inventory, permission loss and unsubscribing on dialog close.

## Release and follow-up

Vercel's production build deploys Convex before promoting the frontend. After merge, verify the deployment status, load PD and FG1, and check per-execution cache hits and database I/O. Compare the next seven days of production and preview usage with the September baseline. Cache hits have no database I/O charge, but initial cold geometry loads still read the building's full layout.

Selected-floor geometry, a lightweight building shell, and summary-only review data remain possible follow-up work if cold-load I/O becomes material. This release preserves whole-building structural-edit warnings and prioritizes eliminating repeated reads of the large, mostly static layouts. It does not promise that the total team usage fits the Free allowance.
