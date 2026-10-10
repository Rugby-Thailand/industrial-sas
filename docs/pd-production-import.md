# Approved PD import: 2026-09-27

This revision changes only the existing PD building in Top Gold / TG-OPT.
It does not run automatically during deployment. Deploy compatible code, then
run preflight, inspect the private backup, and explicitly apply.

- Geometry source: `convex/model/storageLayout/pdApprovedPlan.ts`.
- Target deployment: `greedy-cardinal-537`.
- Building: `n57c2n3sjmdpkjncn9jf0a19gh8ey9h5`.
- Warehouse: `p17ckfaqgw6dprz8d3tfv1tkhd8ez4e6`.
- Revision: `PD-61500-11960-2026-09-27-r1`.
- Building: 61,500 × 11,960 mm; preserve existing height and status.
- Lower spans include their right-hand 300 mm aisles: 6 × 9,420 = 56,520 mm.
- Stair/side clear area excludes the stair projection: 20,457,000 mm².
- Preserve all 198 zone/location/position IDs, codes, QR values, and history.
- Preserve the user-approved 12 inactive PD-L1–PD-L12 groups and their locations/positions unchanged. Include them and associated job-scan references in the backup and transaction digest. Unexpected inactive codes or active positions inside these groups still block import.

## Execute

Use Node 24. Keep the credential file at 0600, untracked and gitignored; never
print it. Create a private 0700 artifact directory outside the repository.
The script refuses existing artifact names and never retries a mutation.
The environment file must define only the reviewed production URL and its
`CONVEX_ADMIN_KEY` credential context; `CONVEX_DEPLOY_KEY` and other deployment
selectors must be absent. Follow the [operator guards](operations/release-runbook.md#operator-data-repairs)
and avoid running an import while a production release holds the shared lock.

```sh
node --env-file=/absolute/private/env.convex-admin scripts/import-pd-production.mjs --mode preflight --directory /absolute/private/run-directory
node --env-file=/absolute/private/env.convex-admin scripts/import-pd-production.mjs --mode apply --directory /absolute/private/run-directory --backup /absolute/private/run-directory/preflight.json --backup-sha256 <sha256-printed-by-preflight> --confirm-deployment greedy-cardinal-537
node --env-file=/absolute/private/env.convex-admin scripts/import-pd-production.mjs --mode verify --directory /absolute/private/run-directory --backup /absolute/private/run-directory/preflight.json --backup-sha256 <sha256-printed-by-preflight>
```

Preflight includes the full affected records, stock/history relationships,
versions, canonical snapshot digest, and unmodified-building baselines. Stop for
blocked occupancy, schema/code-set mismatch, a changed digest, or denied access.
The apply function recomputes the snapshot and stock/move checks inside one
transaction, and records the imported revision on the original building.

On a timeout, do not repeat `apply`. Query `storageLayouts/pdImport:preflight`
and inspect `backup.building.pdImport` and the saved intent/result. The read-only
`verify` mode can verify a completed transaction whose client response was lost.

## Guarded rollback

Only roll back when explicitly required and there has been no subsequent data
change. Use `storageLayouts/pdImport:rollback` with the same `warehouseId` and
`buildingId`, `expectedAfterDigest` from `apply-result.json`, and `backup` equal
to the **backup property** of `preflight.json`. Do not pass the entire wrapper.

The server verifies the original backup against its stored before-digest, the
current complete snapshot against the after-digest, and absence of stock or
active moves. It restores the original rows and removes only reserved blocks
created by this import, in one transaction. A conflict must be investigated;
never substitute the latest digest to force a rollback over later activity.

Rollback leaves its audit event intact. FG1 and F1 + F2 are never migration
targets. UI verification should include 2D overview, zoom, individual location
selection, and 3D platform/stair footprints with visible orange aisles.
