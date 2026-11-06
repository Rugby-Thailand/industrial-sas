# Building route IDs reach the existing not-found response

Malformed route text previously failed the public `v.id` validator before the tenant accessor could normalize it. The three building read endpoints now accept string input for `buildingId` and let the existing tenant-scoped accessor return the same not-found response used for missing or inaccessible buildings. Warehouse validation, permission checks, authentication, mutations and the shared mutation argument definition remain unchanged.

The public-boundary regression invokes all three queries through Convex test references. Each checks empty and malformed strings, a foreign-table ID, a deleted building, other-warehouse and other-tenant buildings, an accessible building, and the existing anonymous rejection. All three parameterized cases pass. Another 38 existing storage-layout and caller cases pass; pinned Bun typecheck passes for 1,203 files. Changed-file ESLint, formatting and diff checks pass.

[Evidence and retained attempts](shared-building-route-id-evidence/receipt.json) include the initial validator failures and the corrected anonymous protocol assertion. This commit has not been deployed to the shared local backend. Live malformed-link UI and Back behavior still require fresh runtime evidence after a coordinated deployment; old frozen captures remain unchanged.

## CI follow-up

CI found the reviewed public validator snapshot still described ID arguments. The three implementations also expose `getStorageBuildingReview` as an existing alias of `getStorageBuilding`, so four registered names widen their argument to string. Only those four snapshot fields are updated; result shapes and other validators are unchanged. The public-boundary regression now includes the alias. Existing clients supplying valid building IDs remain accepted, and the contract compatibility test remains enforced without a breaking-change override. The original three-case result above describes the initial verification; the follow-up covers four names.
