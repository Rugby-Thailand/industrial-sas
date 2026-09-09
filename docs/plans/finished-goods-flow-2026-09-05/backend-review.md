# Finished goods backend review

Reviewed against `flow.md` and `qa-matrix.md` during the autonomous implementation run. Review covers `convex/finishedGoods/workflow.ts`, `convex/model/finishedGoods/placement.ts`, planner occupancy guards, and the integration/model tests. Browser interaction remains with the root agent so this review did not disturb the running UI.

## Findings fixed

### Product requirements could invalidate physically stored goods

Before the fix, `saveProduct` accepted a different storage condition while one of that product's pallets was RESERVED or STORED. Zone requirements were protected, but changing the other side of the same compatibility rule could leave a stored pallet in an incompatible location.

The mutation now normalizes case and surrounding whitespace before comparing conditions, then refuses a semantic change with `LOCATION_OCCUPIED` while any associated physical pallet is RESERVED/STORED. Descriptive fields and equivalent condition text remain editable. After a hold is released, a condition change is allowed. Reads are tenant/warehouse scoped and bounded-complete; overflow produces an explicit capacity failure.

Added parameterized integration tests for both RESERVED and STORED, equivalent text, descriptive edits, and release followed by a requirement change.

### Exact-fit search could perform cubic obstacle work

The original algorithm generated every obstacle-edge X/Y pair, tested both orientations, and scanned all obstacles for every pair. An adversarial dense full-cover case with 1,001 blockers took approximately 4,034 ms locally.

The replacement sorts obstacles by X and sweeps forbidden horizontal intervals at each candidate Y edge. It keeps exact millimetres, both orientations, height filtering, support elevation, boundary contact behavior, and deterministic earliest-Y/earliest-X ordering. It does not truncate or ignore blockers. General worst-case work is quadratic rather than cubic.

Evidence on this host:

| Dense full-cover stress case | Original | New sweep |
|---|---:|---:|
| 1,001 blockers | ~4,034 ms | ~2 ms |
| 10,001 blockers | Not run (unnecessary prolonged cubic work) | ~4 ms |

These are local measurements of this fixture, not a general response-time guarantee. The full-cover obstacle lets the sorted sweep reject rows early. A deterministic blocker-read regression test avoids flaky wall-clock assertions. Another property test compares 300 randomized small layouts to exhaustive integer-coordinate search and requires the same first placement, including rotation.

### Storage-condition configuration needed persistence

Zone create/update now accepts a trimmed optional storage condition, rejects values longer than 100 characters, retains the existing value when an update omits it, and clears it when explicitly sent as an empty string. Catalogue responses expose the value. Changing occupied zone conditions uses the same `LOCATION_OCCUPIED` protection as geometry. A lifecycle integration test covers normalization, omission, clearing, limits, and occupied refusal.

## Reviewed invariants

| Requirement | Review result |
|---|---|
| Two-step creation | Product persistence and physical pallet creation are distinct. Measurement can be incomplete; incomplete pallets remain awaiting measurement. |
| Wrong dimensions | Positive integer millimetres are required; zero, negative, fractional, excessive and non-finite values are rejected. Quantity and optional weight have positive finite bounds. |
| Reserve replacement | New destination and occupancy are validated before inserting a replacement and releasing the old hold. The mutation commits atomically; a failed replacement leaves the old reservation unchanged. |
| Concurrent reservations | Complete occupancy reads participate in Convex transaction conflict detection. Existing race integration test admits only one overlapping hold. |
| Exact coordinates | Pallets use location-local coordinates. Explicit planner positions are converted from floor-relative coordinates. Z comes from a configured support, never arbitrary client input. |
| Rack clearance | Available height is bounded by the next overlapping supporting level and floor/location ceiling. Occupancy collision checks include vertical separation. |
| Physical confirmation | Reserving only creates a hold. Confirming storage requires a reserved pallet, a verified destination, the verifying operator, and a current valid destination. Final pallet/placement status changes are atomic. |
| Scan identity | Accepted QR or manually entered codes belong to the selected zone, selected support, or exact reservation. Wrong destination clears prior verification. Labels such as FG-1 are not accepted as globally unique identities. |
| Inactive destinations | Reserve, verify, and confirm resolve current active building/location/zone/support state. The planner QR resolver also now requires ACTIVE building state. |
| Idempotency | Commands fingerprint arguments and persist operation/request identity plus result ID/hash. Successful retry returns the persisted result ID; conflicting payload reuse is refused. |
| Tenant/warehouse scope | Tenant wrappers, permission codes, scoped indexed reads, and explicit warehouse checks are used. Integration tests cover anonymous, read-only, cross-tenant and wrong-warehouse access. |
| Planner structural edits | Held/stored pallets block geometry/archive changes, including generic confirmation override attempts. Label-only edits and adding floors remain available. |
| Capacity reads | `.all(10_000)` fails explicitly if its configured bound is exceeded. No truncated first page is treated as complete occupancy. Presence-only structural guards use indexed `first()` deliberately. |

## Remaining limits and handoff notes

- Unknown location storage conditions are displayed as UNKNOWN rather than a successful compatibility check. Product ANY means no specific condition requirement.
- No goods-on-goods stacking, pallet relocation after STORED, forklift route simulation, or unsupported weight-capacity assurance is introduced by this flow.
- The warehouse list currently returns bounded complete products and pallets. Server/client pagination is a future capacity task for very large catalogues. The product-name/SKU join was changed from two `products.find` calls per pallet to a Map lookup, removing avoidable quadratic join work.
- Current operator verification is persistent until changed or cancelled; there is no automatic reservation expiry policy in the accepted flow.
- End-to-end visual/mobile evidence and recording are handled by the root implementation pass.

## Validation

- `pnpm exec vitest run convex/model/finishedGoods/placement.test.ts tests/integration/finished-goods.integration.test.ts` — 22 tests passed.
- `pnpm exec vitest run tests/integration/storage-occupancy.integration.test.ts` — 9 tests passed after condition lifecycle coverage was added.
- Earlier combined planner integration/isolation run — 11 tests passed before the additional condition case.
- `pnpm typecheck` — passed.
- Targeted ESLint for workflow, geometry, planner condition changes, and affected tests — passed.

No commits or paid services were used. Files remain in the shared worktree for the root agent's full-flow validation.
