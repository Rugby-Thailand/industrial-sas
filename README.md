# Storage Planner

An authenticated building and storage-location planner with a finished-goods workflow: create a product, measure a physical pallet, recommend an exact position inside a location, reserve it, verify the destination, and confirm storage.

The app retains Clerk sign-in, organizations, warehouse authorization, English/Thai UI, building and floor setup, excluded areas, location/support geometry, QR addresses, and layout activation. Reserved and stored pallet footprints appear in the planner and protect occupied geometry from incompatible edits.

This is the `codex/storage-planner` extraction from Industrial SAS. Unrelated sales, purchasing, production, shipping, reporting, handheld, and upload workflows were removed. The current schema has 25 planner, authentication, workspace, and finished-goods tables. Finished-goods placements are included; a full inventory transaction ledger is outside this app.

## Run

Use Node.js 24 and pnpm 10.33.2. With this worktree's local configuration already present:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

| Service                   | Address               |
| ------------------------- | --------------------- |
| App                       | http://localhost:3100 |
| Local Convex              | http://127.0.0.1:3320 |
| Local Convex HTTP actions | http://127.0.0.1:3321 |

`pnpm dev` starts both servers and Ctrl+C stops both. `PORT=3101 pnpm dev` changes the web port. The runner accepts only a local/anonymous Convex deployment, protecting the original application's cloud deployment from an accidental development launch.

Sign in with an authorized Clerk development account and select a warehouse. This worktree uses its own local Convex database and an initial copy of planner/workspace/identity data. Original inventory, orders, and stock placements were not imported. New finished-goods records and reservations are created in this local database.

For a fresh checkout, authentication setup, commands, and troubleshooting, see the [developer guide](docs/development-setup.md).

## Workflow and implementation

- [Current click-by-click flow and diagram](docs/plans/finished-goods-flow-2026-09-05/flow.md).
- [Implementation decisions and supported constraints](docs/plans/finished-goods-flow-2026-09-05/implementation-notes.md).
- [Original proposal and generated mockups](docs/plans/finished-goods-flow-2026-09-05/design-proposal.md), retained as design history.
- [QA matrix](docs/plans/finished-goods-flow-2026-09-05/qa-matrix.md) and [work log](docs/plans/finished-goods-flow-2026-09-05/work-log.md). These distinguish automated checks and recorded browser evidence; generated mockups are not test evidence.

## Verify

```sh
pnpm check
pnpm build
```

The test suites cover planner geometry, finished-goods drafts and lifecycle, authoritative occupancy, competing reservations, command retries, destination verification, authorization/isolation, UI states, and accessibility. Physical camera scanning requires a device check; automated scanner tests exercise mocked camera/decoder behavior.

## Main code

| Area                            | Entry point                                            |
| ------------------------------- | ------------------------------------------------------ |
| Finished-goods screens          | `src/features/finishedGoods/`                          |
| Interactive pallet view         | `src/features/finishedGoods/PalletScene.tsx`           |
| Finished-goods API bindings     | `src/lib/convex/finishedGoodsApi.ts`                   |
| Finished-goods backend          | `convex/finishedGoods/workflow.ts`                     |
| Placement geometry              | `convex/model/finishedGoods/placement.ts`              |
| Building/floor/location screens | `src/features/storageLayouts/StorageLayoutScreens.tsx` |
| Planner backend                 | `convex/storageLayouts/`                               |
| Tenant/permission enforcement   | `convex/lib/tenantFunctions.ts`                        |
