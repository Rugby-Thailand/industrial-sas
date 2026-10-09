# Backend, data and operational release audit: industrial-sas

> Coordinator verification (2026-10-09): the consolidated audit is the implementation authority. With the chosen native Vercel remote build, the Convex Vercel environment guard stays active. The production-schema test compares complete validator objects for captured fields, not merely field presence; it still misses uncaptured tables/fields/indexes and newly required fields. Convex codegen can be investigated with a secrets-free local backend; rejecting preview keys is not evidence that every PR implementation is impossible. deploy --dry-run can write generated files locally and does not itself exit nonzero for output drift; use an isolated regeneration plus git diff, or a version-tested parser. Production dry-run is an optional early compatibility gate inside Vercel, with --codegen disable when freshness is checked separately, not a reason to place a production key in GitHub. UploadThing use is confirmed in the job-photo flow; Convex backups exclude that storage. The observability port is a reusable module; its current provider runs in the browser, so console events are not durable central telemetry. Vercel supports frontend rolling releases, but shared Convex changes remain global; per-org flags can stage behavior. Recovery compatibility requires tests, and an unsigned-webhook probe checks only part of the auth integration.

## Scope and evidence limits

- **What I checked directly:** local HEAD `0e9ea3a` with the dirty HR/search work left untouched. I read the plan, README, quality workflow, `vercel.json`, schema, schema policy, backfill/import/rollback code, observability code, webhook, scripts, `.gitignore`, the installed Convex 1.46.0 CLI source (`node_modules/convex/dist/esm/cli`) and the installed Next guides on `deploymentId` and version skew.
- **What I did not check:** live Vercel, Convex, Clerk and GitHub settings, and remote `main`. Every platform setting below is unverified unless I say otherwise.
- **Restrictions followed:** I ran no builds or tests and read no `.env` values. For `data/import-staging`, I listed file names only.

## Key confirmed facts

1. **Convex CLI deploy order.** The CLI runs `--cmd` (the Next build) first, then the push, and `--dry-run` skips `--cmd` entirely (`cli/lib/deploy2.js:322-345,363`). The CLI's guard against "prod key in a non-prod build" only detects Vercel, Netlify and Cloudflare, not GitHub Actions (`cli/lib/envvars.js:370-382`). Once the release moves to GitHub Actions, that protection is gone.
2. **Large-index deletion check.** The CLI asks for confirmation unless the hidden flag `--allow-deleting-large-indexes` is passed (`deploy2.js:343`, `deploy.js:92`). `--message` writes a note to the Convex audit log (`deploy.js:83`).
3. **Generated code is stale.** `convex/_generated` was last committed in `d81fa54` while Convex was pinned to 1.43.0. PR #42 (`03a157a`) bumped the pin to 1.46.0 without regenerating. The local diff adds a 1.46-style `export const env` to `convex/_generated/server.js`.
4. **Codegen needs a deployment.** `convex codegen` requires deployment credentials (`cli/codegen.js:61-80`), so it cannot run in the secret-free PR CI. A dry run prints `Command would write file:` when generated output differs (`cli/lib/codegen.js:632-634`).
5. **Runtime calls are by name.** `api.js` exports `anyApi`, so function calls resolve by name at runtime. There are 115 public and 15 internal Convex function exports.
6. **HR schema change is additive.** The local schema diff adds 241 lines and removes 0 (new HR tables only).
7. **No background work.** There is no scheduler or cron usage in `convex/`.
8. **Job-scan images live in UploadThing.** They are stored as `imageUrl` strings (`convex/schema.ts:897`; `src/features/finishedGoods/jobScan/JobScanScreen.tsx:21`). This contradicts `README.md:86` ("does not require UploadThing").

## Findings

### BD-01 Expand → migrate → contract schema changes

- **Classification / priority:** KEEP plus ADD NOW (policy). P1.
- **Current state:**
  - PR #42 restored production fields as optional (`docs/plans/production-deploy-fix-2026-10-08.md:44-58`), and the HR diff is purely additive.
  - #42 also deleted indexes as a side effect (`:66-67`).
  - No written rule exists.
- **Placement:** an "Backend change compatibility" rule in `AGENTS.md`, plus the release preflight (BD-03).
- **Why:** the backend goes live before the frontend is promoted, so live frontend N-1 must keep working against backend N.
- **Smallest change:** rules:
  - new fields are optional or have defaults;
  - unions only widen;
  - removing fields, tables or indexes is a separate later PR, after a backfill reports ready and a compatibility window passes.
- **Acceptance:** a test PR that adds a required field to an existing populated table fails the dry run before any push.
- **Caveat:** a few days of carrying optional fields; contraction is manual work.

### BD-02 Old-client (open tab) compatibility for public Convex functions

- **Classification / priority:** ADD NEXT. P1.
- **Current state:**
  - Calls resolve by name via `anyApi`, and argument validators reject unexpected fields.
  - `next.config.ts` sets no `deploymentId`.
  - Per the installed Next docs (`01-app/03-api-reference/05-config/01-next-config-js/deploymentId.md`), skew handling is navigation-triggered. It does not cover Convex WebSocket subscriptions from long-lived tabs. This applies to Vercel Skew Protection too (assumption; root to verify).
- **Placement:** new `tests/integration/public-function-contract.integration.test.ts` plus a fixture `tests/fixtures/public-function-contract.json`. It runs in the existing `test` shards.
- **Smallest change:** import the Convex modules and snapshot the name, visibility (`isPublic`), `exportArgs()` and `exportReturns()` of each public function. Confirmed: the installed `registration_impl.js:101-142` sets these. Fail on removal, a new required argument or a narrowed argument, unless the fixture is updated in the same reviewed PR.
- **Acceptance:** deleting a public mutation or adding a required argument fails CI. Adding an optional argument passes.
- **Caveat:** fixture churn on every API change. Exclude internal functions.

### BD-03 Production-schema fixture and deploy dry-run preflight

- **Classification / priority:** KEEP fixture; ADD NOW preflight. P0.
- **Current state:**
  - The fixture `tests/fixtures/production-schema-2026-10-08.json` is enforced by `tests/integration/production-schema-compatibility.integration.test.ts:20-34`.
  - It only checks that listed fields still exist in 9 tables. It cannot detect new required fields, narrowed unions outside the fixture, or removed tables or indexes.
  - There is no capture script, and the file name is dated.
- **Placement:** in the new release job, before the real deploy:
  `pnpm exec convex deploy --dry-run --typecheck disable --message "$SHA"`
  using the deploy-only `CONVEX_DEPLOY_KEY` from the GitHub `Production` environment.
- **Smallest change:**
  - Fail if the output contains `Would delete table indexes` and no allowlist file is present.
  - Assert `github.ref == refs/heads/main` and the environment in the workflow itself, because the CLI guard does not cover GitHub Actions (fact 1).
  - Document a metadata-only capture procedure for refreshing the fixture. Root should verify the exact CLI/dashboard export.
- **Trust boundary:** deploy-only key, scoped to the release job only.
- **Acceptance:** a known-incompatible schema causes the dry run to exit non-zero, and the real deploy step never runs.
- **Caveat:** a dry run proves the schema matches current data, not application semantics.

### BD-04 Convex generated-contract freshness

- **Classification / priority:** ADD NOW (one-time regeneration) plus ADD NEXT (gate). P1.
- **Current state:**
  - Stale against the pinned CLI (fact 3).
  - The build compiles against the committed types, because `--cmd` runs before the deploy regenerates code.
  - `.gitignore:46` cites `tests/integration/generated-artifacts.integration.test.ts`, which does not exist. It also claims the build job asserts a clean tree, which `quality.yml:41-55` does not do.
- **Placement:** a reviewed regeneration PR from current main. The gate is a release-preflight step that fails when the dry-run output contains `Command would write file:` for a path under `convex/_generated`.
- **Why:** stale types can hide or invent type errors. Runtime impact is low because calls are name-based.
- **Acceptance:** a stale `_generated` blocks the release before mutation. The gitignore comment is corrected, or the test it names is added.
- **Caveat:** the gate relies on CLI log text; re-check it on each CLI bump. A PR-level check is not possible without credentials (fact 4).

### BD-05 Resumable, tracked backfills and data migrations

- **Classification / priority:** KEEP. ADD NEXT for contraction. P2.
- **Current state (strong):**
  - The summary backfill is versioned (`VERSION = 1`), cursor-resumable, processes 100 records per page, and uses readiness and generation flags (`convex/lib/finishedGoodsSummary.ts:4,176-217`; `convex/staging/summaryBackfill.ts:11-55`).
  - The read side reports "unavailable" rather than zero when a summary isn't ready.
  - The PD and FG1 imports are digest-guarded, permission-gated, record revision markers (`schema.ts:1018-1040`) and have guarded rollback (`convex/storageLayouts/pdImport.ts:314-370,477`; `docs/pd-production-import.md`).
- **Gap:**
  - One-off production mutations (`fg1Import.apply/correctRearAisle/expandRearCells/rollback`, `pdImport.apply/rollback`) remain public API indefinitely.
  - Backfills are triggered by operators, not by the release.
- **Placement:** keep backfills outside the build. Add a contraction PR that removes completed one-off mutations after their rollback window.
- **Acceptance:** an interrupted backfill resumes from its cursor without double-counting (already covered by the summary integration tests). After contraction, the function-contract fixture (BD-02) shows the removal deliberately.
- **Not applicable now:** a generic migrations framework such as the Convex migrations component. The current pattern fits this scale.

### BD-06 Index rollout and deletion

- **Classification / priority:** CONDITIONAL, with one ADD NOW rule. P2.
- **Current state:**
  - Roughly 101 index or staged-index lines in the schema.
  - Installed Convex supports staged indexes (`server/schema.js:15-26`).
  - A large-index deletion triggers a confirmation prompt (fact 2). In non-interactive CI it presumably fails; unverified.
- **ADD NOW:** the release workflow must never pass `--allow-deleting-large-indexes`.
- **Conditional:** use staged indexes when a table becomes large enough for a backfill to approach Convex time limits, and enable them in a following release. Delete an index only in a contraction PR, after no code references it.
- **Acceptance:** the dry-run log lists added and deleted indexes. A deletion without an allowlist entry fails (BD-03).

### BD-07 Quotas and time bounds

- **Classification / priority:** KEEP plus ADD NEXT. P2.
- **Current state (good):**
  - Transactional per-actor quota (`convex/lib/actionQuota.ts:41-80`); HR AI search is capped at 20 per 10 minutes (`convex/hr/navigationIntent.ts:25-29`).
  - The search provider has a timeout (`convex/model/search/provider.ts:138-153`).
  - Scans are bounded (README pagination section).
- **Gap:** the job-scan OpenRouter `fetch` has no timeout and retries once on any 5xx response (`convex/finishedGoods/jobScans.ts:180-217`).
- **Smallest change:**
  - Add `signal: AbortSignal.timeout(...)` to that fetch.
  - Give the release job an explicit `timeout-minutes`, plus per-step timeouts on the deploy and smoke steps.
- **Acceptance:** a stubbed hung provider returns `AI_UNAVAILABLE` within the bound.

### BD-08 Backups, including what they exclude

- **Classification / priority:** ADD NOW (verify and enable) plus ADD NEXT (drill). P0 before the automated cutover.
- **Current state:**
  - The backup schedule on `greedy-cardinal-537` is unverified.
  - Per Convex docs (cited in the plan, not browsed by me), backups exclude code, environment variables and scheduled functions. This app has no scheduled work, so that last exclusion does not apply today.
  - Backend environment variable names in use: `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SIGNING_SECRET`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_SEARCH_MODEL`. The OpenRouter variables appear in neither `.env.example` nor the README.
  - Job-scan photos live in UploadThing, entirely outside Convex backups. A restore can bring back `imageUrl` values pointing at files that were since deleted.
- **Placement:** the Convex dashboard's periodic-backup setting. Also an environment-variable name inventory and an external-storage note in the README, under Production / Deployment configuration.
- **Trust boundary:** a restore target holds production HR PII. Restrict access and delete it after the drill.
- **Acceptance:**
  - A readback shows the backup schedule and retention.
  - The drill restores into an isolated deployment, sets the listed environment variables, and redeploys the release SHA.
  - The read check passes, and elapsed time meets the agreed RTO (recovery-time target).
- **Cost:** daily backups may depend on the Convex plan; verify.

### BD-09 Rollback vs forward fix (frontend ≠ backend)

- **Classification / priority:** KEEP the principle; ADD NOW a runbook decision table. P0.
- **Current state:** `README.md:91-92` and `production-deploy-fix-2026-10-08.md:73-74` correctly say a frontend rollback does not roll back Convex.
- **Smallest change:** a runbook section with a decision order:
  1. Frontend-only defect: Vercel instant rollback. This is safe only because BD-01 and BD-02 keep N-1 compatible.
  2. Backend defect: forward fix through the same automated pipeline. "Rollback" means redeploying an older SHA, and only if that SHA's schema accepts data written since.
  3. Data corruption: restore from backup as a last resort, accepting the RPO (acceptable data loss) as a known loss.
- **Acceptance:** the staging rehearsal from plan step 10 exercises cases 1 and 2.
- **Correction to the plan:** no Convex "code rollback" exists. Don't design one.

### BD-10 Release manifest and version traceability

- **Classification / priority:** ADD NOW. P1.
- **Current state:** no SHA is passed to `convex deploy`, there is no version endpoint, and `next.config.ts` has no `deploymentId`.
- **Placement:** in the release job:
  - `--message "release <sha> run <run_id>"` on the dry run and the real deploy;
  - a `$GITHUB_STEP_SUMMARY` table with SHA, run, Vercel deployment ID, Convex deployment name and outcome;
  - a GitHub Deployment record through `environment: Production`.
- **Why:** the backend version is otherwise only inferable.
- **Acceptance:** for any production incident, the Convex audit-log entry, the Vercel deployment and the GitHub run all resolve to one SHA.
- **Conditional:** a read-only `/api/version` route returning `VERCEL_GIT_COMMIT_SHA`. Vercel metadata may be enough.

### BD-11 Canaries and feature flags

- **Classification / priority:** CONDITIONAL. P2.
- **Current state:**
  - Per-organization entitlements are already wired into the function wrappers (`convex/lib/tenantFunctions.ts:161,302,365`; `convex/lib/permissions.ts:172`), but no HR function declares an `entitlementKey`.
  - Convex is a single backend, so percentage canaries are not possible.
- **Recommendation:**
  - The staged Vercel candidate from the plan is the only canary needed.
  - Optionally gate HR, a large new PII module, behind `entitlementKey: "hr"` for a per-organization dark launch.
  - Not applicable: an external flag service, or traffic-split canaries.
- **Acceptance:** with the entitlement disabled, HR functions refuse and the navigation hides HR. Enabling it for a single organization works.

### BD-12 Observability: the port, platform logs and drains

- **Classification / priority:** ADD NEXT. P1.
- **Current state:**
  - The sinks are `none` and `console` (`src/lib/observability/port.ts:8-40`), resolved from `NEXT_PUBLIC_OBSERVABILITY_SINK` inside a `"use client"` provider (`src/components/providers/ObservabilityProvider.tsx:1,25,39`).
  - The `console` sink therefore writes to the end user's browser console. It is not durable even on the server.
  - Backend errors go only to Convex function logs.
- **Placement:** one durable destination. Either a Convex log stream plus a Vercel log drain to the same provider (plan-dependent; unverified), or a single SDK sink added to the port.
- **Acceptance:** a forced `application.render.failed` event and a forced Convex error both appear in the destination within minutes, tagged with the release SHA.
- **Correction to the plan:** the plan calls `console` "insufficient". In fact it is client-only.
- **Caveat:** a new provider is a new data processor (see BD-13).

### BD-13 PII redaction (HR context)

- **Classification / priority:** ADD NOW plus ADD NEXT. P1.
- **Current state:**
  - Redaction is syntactic. `SAFE_STRING` (`src/lib/observability/event.ts:26`) lets ASCII names and employee codes through.
  - `jobScans.ts:213-217` logs up to 300 characters of the provider's response body.
  - `navigationIntent.ts:79-80` correctly logs a code only.
  - `data/import-staging/` is untracked, not gitignored (confirmed with `git check-ignore`), and contains `top-gold-clerk-identity.json`. The repository is public (per the plan).
  - Production scripts hard-code Clerk user and organization IDs (`scripts/import-pd-production.mjs:44-49`).
  - The privacy draft lists Clerk, Convex, Vercel and Google (`docs/privacy-policy-draft.md:23`), but not OpenRouter or UploadThing.
- **Smallest change:**
  - ADD NOW: gitignore `data/import-staging/` or move it outside the repository, without deleting user work.
  - ADD NEXT: a key allowlist for dimensions, and stop logging the provider's response body.
- **Acceptance:** an attempt to add `data/import-staging/**` shows the files as ignored. A dimension like `displayName` is dropped.

### BD-14 Health, auth and post-release read checks

- **Classification / priority:** ADD NOW. P0 for automatic release.
- **Current state:**
  - No health route exists; the only HTTP route is `/webhooks/clerk` (`convex/http.ts:4`).
  - The webhook returns 503 when its secret is missing and 400 for unsigned requests (`convex/lib/clerkWebhook.ts:57-68`).
  - Post-release checks are manual (`README.md:90-91`).
- **Placement:** release-job steps, before and after promotion:
  1. `POST https://greedy-cardinal-537.convex.site/webhooks/clerk` with no signature: expect **400**. A 503 means the secret is missing; a 404 means the route is not deployed. No side effects.
  2. Candidate and production domain return 200, and the sign-in page renders.
  3. An authenticated read-only catalogue query using the designated synthetic account.
  4. Summary readiness for the test warehouse.
- **Plus (ADD NEXT):** an external uptime monitor on the app domain and the webhook URL.
- **Acceptance:** each check fails the job on mismatch, and a failure before promotion leaves the old frontend serving.
- **Trust boundary:** a dedicated test identity, reads only.

### BD-15 Alerting, SLOs, DORA metrics, recovery targets and ownership

- **Classification / priority:** ADD NEXT (lightweight). Full SLO error budgets are CONDITIONAL or overkill. P1.
- **Current state:** no owner, alert route, RPO or RTO is recorded in the repo (the plan also flags this).
- **Smallest change:**
  - Name a release owner and a restore owner.
  - Route deploy-failure and BD-12 error alerts to that person.
  - Set RPO equal to the verified backup interval, and an RTO measured by the drill.
  - Derive change failure rate and MTTR (DORA metrics) from GitHub Deployment statuses plus an `incident` label.
- **Acceptance:** a failed release triggers a notification that reaches the owner. The restore drill is timed against the RTO at least quarterly.
- **Why lightweight:** with automatic releases, someone must receive failures, but a single-backend app does not justify full error-budget machinery.

## Corrections to the plan and missing cross-domain dependencies

- **Lost CLI guard:** once releases leave Vercel, the CLI's build-environment guard no longer fires (fact 1). The workflow must enforce main-only release itself.
- **Fixture limits:** the plan treats the dated fixture as regression protection. Its coverage is field-presence only, and it has no capture procedure.
- **Missing from the backup/environment inventory:** UploadThing as external storage, and the OpenRouter environment variables. `README.md:69` ("no deployed code") and `:86` are stale.
- **Scheduled-function caveat:** currently not applicable; no scheduler or crons exist.
- **Old-client compatibility:** Convex WebSocket clients in old tabs are a separate concern from Vercel/Next skew handling. Add BD-02.
- **Key naming:** operator scripts read an _admin_ credential through the variable name `CONVEX_DEPLOY_KEY` (`scripts/*-production.mjs:29-45`). Rename it, for example to `CONVEX_ADMIN_KEY`, so the CI deploy-only key and the admin key cannot be confused. The admin key must never enter GitHub.
- **Restore drills hold PII:** a restore target contains production HR data and needs restricted access and deletion afterwards.
- **Dependencies on other domains:**
  - Security: the deploy-only key in the GitHub `Production` environment.
  - QA: a synthetic test account and organization.
  - Platform: the Vercel skew setting, Convex backup and log-stream plan features, and the Clerk production domain for the candidate host.

## Documentation for root to verify (I did not browse these)

- docs.convex.dev/database/backup-restore
- docs.convex.dev/production/integrations/log-streams
- docs.convex.dev/production/state/limits
- docs.convex.dev/cli/reference/deploy
- Convex staged-index documentation
- vercel.com/docs/skew-protection
- vercel.com/docs/drains
- vercel.com/docs/instant-rollback

## Summary

| ID    | Practice                           | Class                   | Priority | Placement                               |
| ----- | ---------------------------------- | ----------------------- | -------- | --------------------------------------- |
| BD-01 | Expand → migrate → contract        | KEEP + ADD NOW          | P1       | `AGENTS.md` rule + preflight            |
| BD-02 | Old-client function contract       | ADD NEXT                | P1       | new contract test + fixture             |
| BD-03 | Schema fixture + dry-run preflight | KEEP + ADD NOW          | P0       | release job before deploy               |
| BD-04 | Generated-contract freshness       | ADD NOW/NEXT            | P1       | regeneration PR; dry-run gate           |
| BD-05 | Resumable backfills, tracking      | KEEP (+ contract later) | P2       | `convex/staging`, `storageLayouts`      |
| BD-06 | Index rollout and deletion         | CONDITIONAL (+1 rule)   | P2       | schema / release flags                  |
| BD-07 | Quotas and time bounds             | KEEP + ADD NEXT         | P2       | `jobScans.ts`, job timeouts             |
| BD-08 | Backups, exclusions, drill         | ADD NOW/NEXT            | P0       | Convex dashboard, README                |
| BD-09 | Rollback vs forward fix            | KEEP + ADD NOW          | P0       | runbook                                 |
| BD-10 | Release manifest                   | ADD NOW                 | P1       | release job, `--message`                |
| BD-11 | Canary / feature flags             | CONDITIONAL             | P2       | entitlements for HR                     |
| BD-12 | Durable observability              | ADD NEXT                | P1       | port sink / platform drains             |
| BD-13 | PII redaction (HR)                 | ADD NOW/NEXT            | P1       | `.gitignore`, `event.ts`, `jobScans.ts` |
| BD-14 | Health and read checks             | ADD NOW                 | P0       | release job steps                       |
| BD-15 | Alerts, RPO/RTO, DORA, owners      | ADD NEXT                | P1       | GitHub Deployments + owner              |
