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

Run `pnpm check`, `pnpm build`, and `pnpm audit:prod` before releasing.
`pnpm format:check` checks formatting. Physical camera scanning still requires
a device check.

## Production

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
