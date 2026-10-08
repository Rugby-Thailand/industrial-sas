# Production deployment failure — 2026-10-08

## Problem and evidence

Production deployment `dpl_nmU6DJve3FxySmaTXpPuZZseMwp7` at `ea8c020`
compiled the Next.js app and passed TypeScript, then failed in Convex 1.43.0:

```text
You do not have permission to perform this operation (deployment:data:view).
This is determined by the permissions granted to CONVEX_DEPLOY_KEY.
```

The current `main` commit, `4143790`, passes all GitHub quality jobs.
The corresponding preview is ready, but production still serves an older commit.

Initial hypotheses were a restricted production key, a wrong deployment target,
and stale credentials. The target is the expected `greedy-cardinal-537` deployment.
Convex's [1.46.0 release notes](https://ship.convex.dev/changelog/convex-v1-46-0)
identify the exact failure: the CLI queried table sizes when deleting indexes,
requiring data-view permission even though the key could deploy code.

## Reproduction

Use a temporary key for `greedy-cardinal-537` granting only `deployment:deploy`.
Store it outside the repository with mode 0600 and an expiry; revoke it afterward.
No production data or schema is changed by this command:

```sh
pnpm exec convex deploy --dry-run --typecheck disable --codegen disable \
  --env-file /path/to/temporary-deploy-only.env
```

Convex 1.43.0 exits 1 with `deployment:data:view`. This reproduces the original
production error without running the frontend build or applying a deployment.

After the CLI upgrade, the same command reached schema validation and failed on
an existing scan record's `version` field. The active production schema contains
optional metadata absent from `main` in nine tables: scan corrections/voids,
move and pallet recovery, product archives, membership revisions, building and
floor geometry, position heights, and warehouse update stamps. The declared
product status also includes `ARCHIVED`.

The metadata-only fixture `tests/fixtures/production-schema-2026-10-08.json`
captures those existing validators, without records or credentials. All nine
regression cases failed before restoring the fields and pass afterward.

## Fix and release plan

1. Pin `convex` to 1.46.0 and regenerate the pnpm lockfile. The updated CLI uses
   the schema evaluation response for table sizes. Keep the existing production
   deploy key and its permissions.
2. Restore the existing optional production fields and archived product status
   with their deployed validators. Run the same deploy-only dry run; it must
   pass schema validation with no data-view grant or document migration.
3. Run type checking, lint, the complete test suite, the production build, and
   the production dependency audit in a clean checkout. Local generated route
   files from removed pages are stale and must not be included in release checks.
4. Merge the verified fix and deploy the resulting `main` commit through Vercel
   using the existing production build command and environment.
5. Confirm Convex succeeds, Vercel reports Ready, and the production domain
   `https://app.thaipropertyai.com` responds and loads the authenticated catalogue.
6. Revoke the temporary key and remove temporary environment files.

This is an upstream CLI dependency fix. The production dry run is the regression
check because application unit tests do not exercise Convex CLI permissions.
Existing application tests cover compatibility with the updated client/server
library. The schema compatibility test protects the retained metadata contract.
These optional fields preserve production data while accepting existing fixtures
and normal writes. This release does not add the feature interfaces that first
wrote that metadata, and it does not alter existing records. The dry run confirms
the current production records satisfy the resulting schema. The indexes removed
by the current `main` schema are small enough to pass Convex's deletion checks.

A frontend rollback does not roll back Convex. Review backend compatibility
before reverting a production release.
