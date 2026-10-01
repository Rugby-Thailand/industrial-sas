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

Vercel's existing Git integration deploys previews and `main` to production.
`vercel.json` skips deployments when only `docs/`, `.github/`, `README.md` or
`AGENTS.md` changed since that branch's last successful deployment. All other
changes build. Missing history and same-commit redeployments also build; set
`FORCE_VERCEL_BUILD=1` in Vercel to bypass the optimization. Keep deployable app
assets outside those documentation directories. CI still validates every PR.
See [Vercel's ignored build step](https://vercel.com/docs/project-configuration/vercel-json#ignorecommand)
and [previous-deployment SHA](https://vercel.com/docs/environment-variables/system-environment-variables#vercel_git_previous_sha).

### Deployment configuration

Vercel project: `rugbykritsakorn-9882s-projects/industrial-sas`.
Convex project: `trustera/industrial-sas`; production deployment:
`greedy-cardinal-537`. At preparation time it has no deployed code or environment
variables. The old Vercel Preview variables point to a different backend and
must not be copied wholesale into Production.

Vercel's build command is:

```sh
pnpm exec convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd 'pnpm build'
```

Set `CONVEX_DEPLOY_KEY` to this production deployment's key in Vercel Production.
The build injects its corresponding `NEXT_PUBLIC_CONVEX_URL`. Set the production
Clerk publishable/secret keys, `NEXT_PUBLIC_APP_URL`, sign-in route, and
`NEXT_PUBLIC_CONVEX_SITE_URL=https://greedy-cardinal-537.convex.site` in Vercel.
Set `CLERK_JWT_ISSUER_DOMAIN` and `CLERK_WEBHOOK_SIGNING_SECRET` in Convex.
Configure the Clerk webhook at
`https://greedy-cardinal-537.convex.site/webhooks/clerk` and production sign-in
domains. This smaller app does not require UploadThing. Never set the developer
`CONVEX_DEPLOYMENT` in Vercel or commit credentials.

After configuration and release review, deploy using `npx vercel --prod`.
Verify sign-in, organization/warehouse access, layout editing, and a
finished-goods placement using a designated test record. A frontend rollback
does not roll back Convex code or data; assess backend compatibility separately.

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
