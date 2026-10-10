# Release and recovery runbook

Production releases automatically after CI passes on the exact `main` commit.
There is no manual release approval. A maintainer may merge their own PR once
the required automated checks pass; human and code-owner reviews are optional.
Main still requires PRs, up-to-date CI/security checks and resolved conversations.
After merge, the gates below decide whether a release goes ahead.
This runbook covers what the pipeline does, which configuration it needs,
and what an operator does when a gate fails. Platform facts are in
[platform evidence](ci-cd-platform-evidence.md). The per-practice status is
in [implementation status](ci-cd-implementation-status.md).

Owners: the CODEOWNERS maintainers (`@Narungsih @Ruckth @VarongWiriyawit
@giftchennissa-creator`) own release, backup/restore and security triage until
the team names individual owners. Rotate the CI credentials below before
**2027-01-07 UTC**.

## Verified local checks

- Final coordinator shards passed **189 files / 2,139 tests**, with **0 failures
  and 0 retries**. Full-tree lint, formatting and production-mode build checks
  exited **0**. Workflow validation/actionlint verified **8 pinned actions,
  5 workflows and 1 composite action**. Runtime and guarded application/tool
  dependency audits exited **0**; the documented narrow unpatched exception
  remains in force. The clean-tree check awaits the final committed checkout.
- The production-mode anonymous browser suite passed all **70 checks** with
  zero retries. All **16 workspace width/locale/theme combinations** passed,
  and the default harness passed **three consecutive zero-retry runs**.
- All **five privacy regressions** passed, including real browser/API redirect
  scoping and an intentionally failing child suite that checked sanitized
  output and the absence of sensitive artifacts.
- Frozen-main comparison found all **87 registered public argument/return
  validators unchanged**. The representative runtime suite passed **95 checks**
  covering **18 of 87 functions across all 14 public modules**; the remaining
  69 functions and broad nested `v.any` payload schemas are coverage limits.
- **26 fresh-codegen isolation/lifecycle/checksum checks** passed. An actual
  fresh credential-free loopback run exited **0** and matched generated output.
- Final Operations verification passed **56 checks**, plus full TypeScript,
  scoped lint and formatting: telemetry privacy, provider hard deadlines,
  operator refusals and the workspace telemetry call site.
- The focused identity/tenant run passed **425 checks**, and the **11-case
  signed registered HTTP suite** also passed. These suites overlap; their
  counts are not added. They verify signed source clocks, stale/replay and
  delete ordering, signature/freshness rejection and tenant boundaries locally.

These results do not establish a native staging Clerk/JWT/webhook smoke run,
candidate/live production smoke, or GitHub post-merge execution. Those proofs
remain pending coordinator evidence. UploadThing file-byte recovery, business
RPO/RTO and durable telemetry/alert delivery remain unresolved below.

## Release path

PR and push checks run every Vitest project across three shards and upload
native JUnit reports. Browser smoke and the workspace subset run in parallel;
smoke also verifies the production build and owns its `.next/cache` cache.
This avoids a second build and a separate report-merging job. Informational
full-suite coverage runs weekly or by dispatching `Workspace matrix`, alongside
the existing full browser matrix. Coverage instrumentation gets a 15-second
test timeout there; ordinary quality tests retain their default timeout.

`.github/workflows/quality.yml` runs one pipeline on `push` to `main` and on a
`workflow_dispatch` of `main`:

1. `check` aggregates every mandatory quality job. A failed, cancelled or
   unexpectedly skipped job fails it.
2. `staging` (environment `staging`, lock `industrial-sas-staging-release`)
   deploys the same SHA to `industrial-sas-staging` / `befitting-stoat-208`.
   It then runs the authenticated staging browser suite.
3. `release` (environment `production-release`, lock
   `industrial-sas-production-release`) runs `scripts/release/run.mjs
--target=production`:
   - preflight: repository, `refs/heads/main`, exact SHA, the cutover
     `vercel.json`, the current `main` head, the project identity, and no
     in-flight or unreconciled production deployment;
   - backup: a new native Convex snapshot that includes storage. It must
     complete and expire at least 24 hours later. Otherwise the run is
     refused;
   - a second `main` head check, then a pinned `tools/release` Vercel CLI
     source deploy with `--prod --skip-domain` and release SHA/run metadata;
   - wait for READY, bind `https://ci-candidate.thaipropertyai.com` to that
     deployment ID, and run read-only candidate smoke;
   - promote the same deployment ID and run read-only live smoke on
     `https://app.thaipropertyai.com`.

The staging and production job conditions include `!cancelled()` as well as
explicit successful prerequisite results. GitHub otherwise adds an implicit
`success()` condition that can suppress releases after the PR-only dependency
review job is deliberately skipped on `main`. Production remains automatic
after successful quality and staging checks, with no manual release approval.

The daily `Production backup` workflow uses the same lock group. A backup and
a release therefore never overlap. Queued runs wait (`queue: max`) and are not
cancelled. A queued release whose SHA is no longer `main` ends as
`SUPERSEDED` without deploying.

To re-run a release, dispatch `Planner quality` on `main`. Fresh CI runs
first, and the release can only use the current `main` SHA. Dispatching
another branch runs CI only. A passing staging job is verification, not a
production release.

Do not use these for production: `vercel --prod`, `vercel deploy`, dashboard
**Redeploy**, deploy hooks, or a manual `convex deploy`. They bypass the lock
and backup gate. Every build command except the CLI's runs `convex deploy`, so
any of them can push backend code outside CI. The build validator refuses a
build that lacks the release SHA/run (`RELEASE_SHA`, `RELEASE_RUN_ID`), or
that runs in the wrong project or target. Treat that refusal as a backstop,
not as permission to try.

## Configuration inventory

Names only. Values stay in the platform stores listed. The build validator
(`scripts/release/lib/env-contract.mjs`) prints names only.

### Vercel build environment (frontend and build-time backend push)

| Variable                                                 | Production project (`industrial-sas`, Production target) | Staging project (`industrial-sas-staging`)               |
| -------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| `RELEASE_ENVIRONMENT`                                    | `production` (public label, set)                         | `staging`                                                |
| `CONVEX_DEPLOY_KEY`                                      | deployment key `prod:greedy-cardinal-537`                | deployment key `dev:befitting-stoat-208`                 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | live instance, `clerk.thaipropertyai.com`                | test instance, `creative-doberman-56.clerk.accounts.dev` |
| `CLERK_JWT_ISSUER_DOMAIN`                                | `https://clerk.thaipropertyai.com`                       | `https://creative-doberman-56.clerk.accounts.dev`        |
| `NEXT_PUBLIC_APP_URL`                                    | `https://app.thaipropertyai.com`                         | `https://industrial-sas-staging.vercel.app`              |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`                          | `/th/sign-in` or `/en/sign-in`                           | same                                                     |
| `NEXT_PUBLIC_CONVEX_SITE_URL`                            | `https://greedy-cardinal-537.convex.site`                | `https://befitting-stoat-208.convex.site`                |
| `NEXT_PUBLIC_CONVEX_URL`                                 | injected by `convex deploy`                              | injected                                                 |
| `UPLOADTHING_TOKEN`                                      | optional; sensitive Production entry exists              | absent: uploads are unavailable on staging               |
| `NEXT_PUBLIC_OBSERVABILITY_SINK`                         | optional `none`/`console`                                | optional                                                 |
| `RELEASE_SHA`, `RELEASE_RUN_ID`                          | injected per deployment by `--build-env`                 | injected                                                 |

The validator refuses `CONVEX_DEPLOYMENT`, `CONVEX_ADMIN_KEY`,
`CONVEX_BACKUP_ADMIN_KEY` and `CONVEX_SELF_HOSTED_*` in a build. It also
refuses a mismatched `VERCEL_PROJECT_ID`, `VERCEL_TARGET_ENV` or
`VERCEL_GIT_COMMIT_SHA` (system variables are exposed on both projects).
Staging builds use the staging project's Production target. `VERCEL_ENV`
alone therefore never selects live resources.

### Convex backend environment (set with `convex env`, not in Vercel)

| Variable                                    | Production `greedy-cardinal-537`                                                                                    | Staging `befitting-stoat-208`                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `CLERK_JWT_ISSUER_DOMAIN`                   | live issuer (readback matched)                                                                                      | test issuer (readback matched)                                    |
| `CLERK_WEBHOOK_SIGNING_SECRET`              | production Clerk endpoint secret                                                                                    | dedicated CI endpoint secret (installed)                          |
| `OPENROUTER_API_KEY`                        | **backend only**. Never in Vercel, never `NEXT_PUBLIC_*`. If absent, job-ticket extraction returns `AI_UNAVAILABLE` | normally absent                                                   |
| `OPENROUTER_MODEL`                          | optional model override                                                                                             | optional                                                          |
| `E2E_FIXTURE_TARGET`                        | must be **absent**                                                                                                  | `befitting-stoat-208` (staging fixture marker; readback verified) |
| `JOB_SCAN_DEMO_AI`, `ALLOW_LOCAL_TEST_SEED` | absent (local development only)                                                                                     | absent                                                            |

Convex backups exclude code and environment variables. Record any change to
this table in a reviewed PR.

### GitHub environments

- `production-release` (main only, no reviewers): `VERCEL_TOKEN`
  (project-restricted, expires 2027-01-07) and `CONVEX_BACKUP_ADMIN_KEY`
  (`backups:create`/`backups:view` only, expires 2027-01-07). The backup key
  goes only to the runner step. It never goes to Vercel.
- `staging` (main only): `VERCEL_TOKEN`, `CONVEX_DEPLOY_KEY`,
  `CLERK_SECRET_KEY` (test instance).
- Repository variable `RELEASE_ACKNOWLEDGED_DEPLOYMENTS`: comma-separated
  Vercel deployment IDs that an operator has reconciled (see below).

### External file store

Job-ticket photos are uploaded to UploadThing (`src/app/api/uploadthing`). The
app stores only the returned URL in Convex. Neither Convex snapshot type copies
those bytes. The production UploadThing app has **not** been independently
identified. The empty `industrial` dashboard app and the app behind a local
token are not proof of the production store. Don't treat either as production,
and don't overwrite the production token. Until the association, retention and
an archive procedure exist, a data restore can return photo URLs whose files
have changed or disappeared.

## Native Git cutover

`vercel.json` now commits `git.deploymentEnabled=false`, the gated build
command and no `ignoreCommand`. The production controller refuses to run
until the committed file has exactly this shape. The production project is
still linked to Git with deployments enabled. The disabled trigger takes
effect when this configuration reaches `main`. Perform the cutover as one
coordinated change:

1. Before merge: confirm no production build is `QUEUED`, `INITIALIZING` or
   `BUILDING` in the production project. Wait for or cancel any that are, and
   reconcile their backend effect.
2. Inventory deploy hooks and any external automation in the production
   project. Remove them or record them for removal in the same window. Remove
   any bypass of the committed build command, such as a dashboard override
   that a CLI deploy would ignore anyway.
3. Merge. Verify that Vercel created **no** native Git deployment for the
   merge SHA. A native build there would run `convex deploy` with the
   production key, outside the lock.
4. The `staging` and then `release` jobs run for that SHA. Treat the first
   release as the cutover verification and watch it.

Status: the configuration and controller check are implemented. Steps 1–4 have
not been executed; this task only prepares the PR.

## Identity webhook and clock migration

Webhook ordering now uses the signed Clerk source clock. The additive schema
fields are explained in
[clerk-webhook-clock-migration.md](clerk-webhook-clock-migration.md). The
dedicated staging Clerk endpoint may be enabled only after the reviewed handler
is deployed to staging. Enable only that endpoint and verify delivery with
the per-run synthetic identities. A frontend rollback does not revert this
backend change, and reverting to delivery-clock ordering would reopen the bug.
Fix forward instead.

## Staging fixtures

Every staging run creates its own Clerk organizations (`CI E2E <runId>
primary` / `other`) and user, plus Convex fixtures through the internal
`convex/staging/e2eFixture.ts` functions. Those functions refuse production
(`greedy-cardinal-537`) and any deployment other than the marked staging one.
Teardown cleans Convex in bounded batches (at most 200 documents per call)
before deleting the Clerk identities. It keeps signed mirror watermarks so that
real deletion events still apply. After verifying the recorded membership ID,
organization, user, and parent ownership, teardown explicitly deletes that
membership before either parent. Normal cleanup waits for the genuine
membership deletion and exact-owned terminal parent mirrors, then repeats
backend cleanup before removing the private ownership ledger.

For a previously deleted parent cascade that omitted `membership.deleted`,
cleanup can settle the unchanged historical membership only when its own
source clock is verified and both exact-owned organization and user have
verified terminal source clocks at least as recent. This recovery does not
change membership status or any source clock. Missing or legacy clocks stay
pending; ambiguous current memberships and foreign associations are refused.
Partial failures retain the ledger for exact-ID recovery. `staleRuns` checks
the age of one supplied owned run (at least an hour); it does not sweep shared
tenants. There are no shared persistent CI actors and no production seeds.
Live staging delivery/readback/cleanup proof remains pending.

## Bounded timeouts and orphaned builds

| Bound                                    | Value                                                |
| ---------------------------------------- | ---------------------------------------------------- |
| CLI upload/creation (`--no-wait`)        | 10 minutes                                           |
| Build READY wait                         | 30 minutes                                           |
| Candidate alias / promotion verification | 5 minutes each                                       |
| Browser smoke per phase                  | 20 minutes                                           |
| Job timeouts                             | staging 60, production 90 minutes; backup 25 minutes |

A timeout means the release is uncertain, not that nothing happened. A remote
Vercel build continues after the runner stops, and it can still push Convex.
The next release refuses with `BLOCKED_IN_FLIGHT` while a production build is
running. It refuses with `BLOCKED_UNRECONCILED` when a production-target
deployment newer than the serving one has not been acknowledged. To reconcile:

1. Find the deployment ID in the run's `production-release-*` manifest (it is
   written as soon as it exists) or in the Vercel project.
2. Wait for it to finish or cancel it. Determine whether its `convex deploy`
   ran (Vercel build log and Convex deployment history), and record the
   backend function/schema version that is now live.
3. If the live backend is compatible, add that deployment ID to
   `RELEASE_ACKNOWLEDGED_DEPLOYMENTS`, then dispatch `Planner quality` on
   `main`. If it is not compatible, fix forward first.

## Failure decision table

Each outcome is a `code` in the release manifest. "Mutation" is the most the
run could have changed.

| Outcome                                                    | Mutation          | Serving frontend                        | Action                                                                                                                                                                 |
| ---------------------------------------------------------- | ----------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPERSEDED`                                               | none              | unchanged                               | None. The newer `main` run releases.                                                                                                                                   |
| `NOT_READY`                                                | none              | unchanged                               | Fix the configuration, cutover or identity mismatch it names. Dispatch again.                                                                                          |
| `BACKUP_FAILED`                                            | none              | unchanged                               | Check the backup key's expiry and Convex status. Re-run the backup workflow, then dispatch. Never bypass the gate.                                                     |
| `BLOCKED_IN_FLIGHT` / `BLOCKED_UNRECONCILED`               | none              | unchanged                               | Reconcile as above, then dispatch.                                                                                                                                     |
| `DEPLOY_COMMAND_FAILED` / `BUILD_FAILED` / `BUILD_TIMEOUT` | backend possible  | unchanged                               | Treat the backend as possibly pushed. Reconcile the deployment. If the live backend is incompatible with the serving frontend, fix the backend forward.                |
| `VERIFY_FAILED` / `CANDIDATE_FAILED`                       | backend           | unchanged (old frontend on new backend) | Confirm the old frontend still works against the new backend. If not, fix forward urgently. Do not promote by hand.                                                    |
| `CONFLICT`                                                 | backend           | changed by something outside this run   | The serving deployment changed during the release. Find and remove the bypass path (dashboard, hook, manual CLI), then handle it like `CANDIDATE_FAILED`.              |
| `PROMOTE_FAILED` / `PROMOTE_TIMEOUT`                       | frontend possible | unknown                                 | Check which deployment serves the domains. Then use the `LIVE_FAILED` or reconcile row.                                                                                |
| `LIVE_FAILED`                                              | frontend          | new                                     | If the fault is frontend-only and the previous artifact is compatible with the current backend, run `vercel rollback <previous deployment ID>`. Otherwise fix forward. |
| `STAGING_FAILED`                                           | staging only      | production unchanged                    | Fix on a PR. Production was not touched.                                                                                                                               |

Recovery rules:

- **Frontend rollback** (`vercel rollback`) reassigns a previously serving
  artifact. Only do it if that artifact works with the backend that is live
  now. It does not change Convex functions, schema or data. Never use
  **Redeploy**: it rebuilds and pushes old backend code.
- **Backend fix** goes forward through a reviewed PR and this pipeline. There
  is no supported backend rollback command. Keep schema changes
  expand/migrate/contract.
- **Data restore** is a separate operator decision, used only for data loss or
  corruption. It is never part of a release. Restore into a disposable target
  first. The last rehearsal is described below.

## Backup and recovery evidence

- Pre-release and daily native snapshots (`scripts/release/backup.mjs`,
  `scripts/release/lib/convex-backup.mjs`) require `includeStorage=true`,
  fresh completion, and at least 24 hours of remaining recovery window. The
  helper was verified live in about 3.5 s, and its 55 focused tests passed.
  Scheduled workflow execution is not yet observed.
- Cloud snapshot `1708272` was restored server-side into disposable preview
  `precise-rabbit-956`. The import completed with 3296 documents in a
  measured 94.9 s. That run had zero `_storage` objects. It was a data-import
  rehearsal. It was not an application recovery, a file-byte recovery or an
  UploadThing backup.
- The technical cadence is at least one daily snapshot plus one before each
  release, so the snapshot interval is ≤ 24 hours once the schedule runs.
  That is not an approved business recovery point objective. **Business RPO/RTO
  targets are not set.** No timed full-application recovery exists to compare
  against them. Native snapshots are kept until their returned expiry (source
  default fourteen days, checked per snapshot). Periodic cloud backups are not
  available under the current Convex entitlement, and no upgrade is authorized.

## Telemetry and alerts

Current state: the observability port accepts only `none` and `console`.
`console` writes to the end user's browser console. Events carry only
allowlisted dimensions (`src/lib/observability/dimensions.ts`). Backend
provider failures write static JSON lines (`jobScan.provider.*`) to Convex
function logs. **No durable central destination and no alert delivery are
configured.** Release failures are visible only as failed GitHub runs and
manifests.

Frontend event codes are restricted to `application.render.failed`,
`web.vital`, `workspace.query.failed` and the fixed rejection code. Request
IDs must be UUIDs; named `req_` slugs are dropped. Warehouse identifiers are
omitted entirely, and routes replace unknown segments with `[id]`. The console
sink applies this policy even to literal events built outside the helper.

The job-ticket provider has a 40-second per-attempt timeout and an independent
55-second total abort timer covering fetch and response-body reads. A backward
wall-clock jump cannot extend that hard total bound. One HTTP 5xx retry is
allowed only with at least 10 seconds of estimated budget; it can double provider
cost. Timeouts, network errors, 4xx/429 and malformed/oversized bodies are not
retried, and no database mutation is repeated.

Optional destinations, none configured or purchased:

- Vercel log drains for frontend/runtime logs. Plan availability is
  unverified.
- Convex log streams for function logs. Plan availability is unverified.
- A single new port sink that sends the sanitized events to one reviewed
  provider.

Before collecting, the owner (CODEOWNERS maintainers until named) must choose
one destination. They must confirm plan capability and cost, and add the
provider to the privacy/processor inventory. Keep the dimension allowlist.
Only then prove delivery by forcing a safe client error and a safe Convex
error and seeing both arrive with the release SHA. Route release-failure and
backup-failure notifications to the same owner. GitHub failure e-mail to
whoever triggered the run is not an alert route.

## Operator data repairs

Production data repairs run outside releases:
`scripts/import-pd-production.mjs`, `import-fg1-production.mjs`,
`expand-fg1-r04-r08-production.mjs` and
`correct-fg1-rear-aisle-production.mjs`. Before any client exists,
`scripts/lib/productionOperator.mjs` enforces:

- one `node --env-file=<file>`. The file is a regular operator-owned file
  with no group/other access, kept outside the repository or under the
  ignored `data/private/` / `data/import-staging/`. It must define
  `CONVEX_URL=https://greedy-cardinal-537.convex.cloud` and `CONVEX_ADMIN_KEY`,
  and no shell value may override them;
- `CONVEX_ADMIN_KEY` is a `prod:greedy-cardinal-537` deployment key. The
  **deploy-key slot `CONVEX_DEPLOY_KEY` must be absent**, even alongside an
  admin key, as must `CONVEX_DEPLOYMENT` and `CONVEX_SELF_HOSTED_*`;
- `--directory` is an existing operator-owned `0700` directory that is not a
  symlink, outside version control. Artifacts are written `0600` with
  exclusive create;
- `--backup` (apply/verify, and every rear-aisle mode) must be a `0600` file
  whose SHA-256 equals `--backup-sha256`, and it must have been captured from
  the production URL;
- `--mode apply` additionally needs `--confirm-deployment greedy-cardinal-537`.
  `preflight` is the read-only default.
- Every CLI control may appear once only, including mixed `--name=value` and
  `--name value` forms. Duplicate mode, directory, backup, digest or deployment
  confirmation options are refused before a client exists.

```sh
node --env-file=/private/operator.env scripts/import-pd-production.mjs \
  --mode preflight --directory /private/run
node --env-file=/private/operator.env scripts/import-pd-production.mjs \
  --mode apply --directory /private/run --backup /private/run/preflight.json \
  --backup-sha256 <sha256 printed by preflight> \
  --confirm-deployment greedy-cardinal-537
```

Each script then checks its revision, digest and unchanged-building guards
before a single mutation call. It never retries automatically. After a timeout
or an uncertain result, run `--mode verify` with the same backup. Do not
repeat `apply`. Don't run a repair while a release holds the production lock.
The admin key never goes into GitHub or Vercel. These refusals are covered by
`tests/integration/production-operator.integration.test.ts`, which runs no
import and contacts no deployment. No script has been run against production
for this change.
