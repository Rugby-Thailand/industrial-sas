# Storage Planner

Authenticated building, floor, and storage-location planning with finished-goods
products, batches, packing, pallet placement, stacking, and moves. Includes Clerk
organizations, warehouse authorization, Thai/English UI, QR addresses, and shared
2D/3D storage scenes.

Application source: `codex/storage-planner-release-2026-09-09` at `a29e299`.
Historical documents and generated review artifacts are excluded. Tests remain
part of the application. This app does not include the former ERP modules or
full inventory transaction ledger.

## Development and checks

Use Node.js 24 and pnpm 10.33.2. Install with
`pnpm install --frozen-lockfile`. Configure `.env.local` from `.env.example`.
`pnpm dev` requires an isolated local Convex deployment and serves port 3100;
it refuses the original application's cloud development deployment.
For the seeded local browser fixture, set `ALLOW_LOCAL_TEST_SEED=true` in
`.env.local`, then run `pnpm dev:seed`. Run `pnpm dev:login` to open the direct
local Clerk ticket route for the test account.

`ALLOW_LOCAL_TEST_SEED=true pnpm dev:seed --storage-ui` adds the local UI B
review profile without replacing existing records. `UI-B-DEMO` has four floors,
34 locations, 15 grouped positions, reserved areas, and 10 pallets (stored,
reserved, and unmeasured). Floor 3 is empty; floor 4 has a smaller footprint.
`UI-B-NO-FLOORS` and `UI-B-ARCHIVED` cover empty and read-only buildings.
`UI-B-REFERENCE` adds a 12.26 × 29.93 m floor with 15 locations and 24 stored
pallets for comparison with the canvas reference; its ID is
`storageUiProfile.referenceBuildingId`.
The profile is repeatable and requires the enabled loopback Convex backend.
Building IDs are written to `output/local-test-data.json` under
`storageUiProfile`. After `pnpm dev:login`, open the building from the catalogue
or `/th/master-data/storage-layouts/<buildingId>`.

Run `pnpm check`, `pnpm build`, and `pnpm audit:prod` before releasing.
`pnpm format:check` checks formatting. Physical camera scanning still requires
a device check.

## Production

### CI/CD

`Planner quality` runs once per pull request update and on pushes to `main`.
Use its manual GitHub Actions trigger to check a branch before opening a PR.
Type checking, lint and the production dependency audit run alongside two test
shards and the production build. Every Vitest project remains included. The
`check` job passes only when all jobs pass; use it as the required merge check.
Superseded PR runs are cancelled, while production-branch checks finish.

The shared setup action installs the frozen lockfile and caches the pnpm store.
The build also caches `.next/cache`, scoped by runner platform, lockfile and
Node version, with a fresh entry per commit. Action versions are pinned by SHA
and maintained by Dependabot.

Native Vercel Git builds are disabled for both previews and `main`
(`vercel.json`: `git.deploymentEnabled=false`, no ignored-build-step shortcut).
A secret-bearing build couples a Convex backend push to the frontend build, so
it must wait for trusted CI. Pull requests run credential-free local browser
checks instead of native previews. The disabled Git trigger takes effect only
when this configuration reaches `main` as part of the coordinated cutover in the
[release runbook](docs/operations/release-runbook.md).

### Automatic production release

Production releases automatically, with no manual approval, after `Planner
quality` passes on the exact `main` commit. The gated release jobs then:

1. deploy that commit to the isolated staging project/backend and run its
   authenticated browser checks with per-run synthetic identities;
2. take the shared `industrial-sas-production-release` lock (also used by the
   daily `Production backup` workflow), reject a stale `main` SHA, an
   in-flight or unreconciled production build, and refuse without a fresh,
   completed native Convex snapshot that includes storage and expires at least
   24 hours later;
3. build the exact commit with the pinned Vercel CLI (`tools/release`) as a
   production-target deployment without domain assignment. The build command
   validates its environment before `convex deploy` pushes the backend;
4. check that deployment on the candidate host, promote the same deployment ID,
   and verify the live domain.

Re-run a release with a `workflow_dispatch` of `Planner quality` on `main`: it
runs fresh CI for the current `main` commit before any release step and cannot
release another SHA. Dispatching on any other branch runs CI only. A passing
staging check is verification, not a production release. Never run
`vercel --prod`, `vercel deploy`, a dashboard **Redeploy** or a deploy hook for
production: they bypass the lock and can push Convex code outside CI.

Recovery is not symmetric. `vercel rollback` restores a previously serving
frontend artifact only, and only when it is compatible with the current
backend. It does not revert Convex functions, schema or data. A backend defect
gets a reviewed forward fix through the same pipeline. Data restore from a
snapshot is a separate, deliberate operator decision. The runbook's failure
table maps each release outcome to its action.

### Deployment configuration

Vercel project: `rugbykritsakorn-9882s-projects/industrial-sas`.
Convex project: `trustera/industrial-sas`; production deployment:
`greedy-cardinal-537`. Staging uses the separate `industrial-sas-staging`
project and `preview/ci-staging` backend. Reviewed public identifiers are in
`scripts/release/targets.json` and
[platform evidence](docs/operations/ci-cd-platform-evidence.md).

The committed build command runs `scripts/release/assert-deploy-env.mjs`
before and inside `convex deploy`. A build that lacks the release SHA/run, runs
in the wrong project or target, or has a mismatched Convex, Clerk or app URL
fails before the backend push. Only variable names are printed. The
[release runbook](docs/operations/release-runbook.md) lists every frontend
and backend variable and where it belongs, including the backend-only
`OPENROUTER_API_KEY` and the external UploadThing file store. Never set the
developer `CONVEX_DEPLOYMENT`, an admin key or a backup key in Vercel, and
never commit credentials.

After each release, the live checks are read-only. Do not seed or edit
production business records for verification.

Production data repairs (`scripts/*-production.mjs`) are separate operator
actions and never part of a release. They read only `CONVEX_ADMIN_KEY` from a
private `--env-file`, refuse if the deploy-key slot is present, default to
read-only preflight, and never retry a mutation. See the runbook's operator
section before running one.

Telemetry has no durable destination yet: `NEXT_PUBLIC_OBSERVABILITY_SINK`
accepts `none` or `console` (the user's browser console), and events carry
only allowlisted dimensions. Central error delivery and alerting are not
configured; the runbook records the setup decision and owner.

### Local pagination fixtures and summary migration

`pnpm dev:seed --pagination` adds an optional idempotent pagination profile to
our local demo warehouse: 121 products, 121 buildings, 363 locations, 360 storage
units, and 121 draft batches on `PAGINATION-0000`. The last records include Thai
names, searchable codes and a lot containing `NEEDLE`; repeated timestamps
exercise equal sort values. Each internal seed call processes at most 25 fixture
records. The existing local deployment, loopback URL and `ALLOW_LOCAL_TEST_SEED`
guards still apply. The default `pnpm dev:seed` retains its original sample data.
Both profiles invalidate and rebuild product summaries after raw seed writes.

For an existing deployment, an operator can resume the internal migration with
`pnpm exec convex run staging/summaryBackfill:run '{"warehouseId":"<id>"}'`
until `ready` is true. The authenticated application also exposes bounded
summary preparation to storage-layout managers. A missing projection is shown
as unavailable while preparation runs, never as a zero warehouse total.
Backfill and normal mutations reconcile an idempotent per-unit ledger, so
retries and concurrent edits do not double-count quantities.

Catalogue pages contain 20, 50 or 100 records. Indexed pages use cursor
boundaries; residual substring matching and complex sorting can require several
bounded scan requests before the page is ready. Sparse searches may therefore
read many candidates overall even though each request is bounded. Building
occupancy is a separate per-building query; location placements load only when
the row is expanded. Occupancy retains the geometric-union calculation and
fails explicitly at scoped capacity limits rather than displaying a partial
footprint. Scene reads remain independent of list pagination.
