# Release orchestration and deployment environment audit

> Coordinator verification (2026-10-09): the consolidated audit is the implementation authority. Current Vercel docs confirm --prod --skip-domain, source deployment metadata, and promotion of a staged production deployment without rebuilding. Current CLI source supports VERCEL_TOKEN; verify the exact CLI version when implementation pins it. GitHub supports explicit queue: max; use a fixed production job lock and no cancellation, then independently reject stale SHAs. Choose a dedicated production-release environment for ownership clarity; no evidence establishes that Vercel would overwrite a policy on the existing environment. Clerk Testing Tokens support production with helper limitations; read-only authenticated production checks remain conditional on configured synthetic identity and owned host. Roll back a previously serving artifact with vercel rollback, not vercel promote or Redeploy; recovery is safe only after compatibility is demonstrated. The fact that an old frontend has served briefly against the new backend is not proof that every flow remains compatible. Production preflight can run inside Vercel with existing credentials if adopted; it need not move a Convex key into GitHub. Automatic pipeline dispatch retries are allowed on main after fresh CI.

## Scope and limits

I inspected files only. I did not run builds, tests, deployments, `git fetch` or anything against Vercel, Convex or Clerk. Local `HEAD` is `0e9ea3a` and the working tree has uncommitted HR/search changes. The local `origin/main` ref is `cc42063`. Between those two commits, `git diff` shows no change to `.github/`, `vercel.json`, `scripts/vercel-ignore-build.mjs`, `package.json`, `README.md`, `convex/schema.ts`, `convex/auth.config.ts` or `next.config.ts`. Live Vercel, Convex and Clerk settings are **unverified**. The Vercel CLI is not installed (`which vercel` and `node_modules/.bin` returned nothing), so every Vercel CLI behaviour below is an assumption for root to verify. Convex 1.46.0 behaviour is **confirmed from the installed code**. I read the installed Next guides `02-guides/environment-variables.md` and `05-config/01-next-config-js/deploymentId.md`.

## Recommended smallest architecture

Add one `release` job to `.github/workflows/quality.yml` with `needs: check`. It runs only on `push` to `main`, or on `workflow_dispatch` from `main`, and requires `needs.check.result == 'success'` for the same run. That means the same `github.sha` has already passed CI. The job:

1. Takes a job-level lock: `concurrency: production-release` with `cancel-in-progress: false`.
2. Checks out `github.sha` and stops if `refs/heads/main` has moved on.
3. Checks that no production Vercel deployment is still building.
4. Runs `vercel deploy --prod --skip-domain`. This is a **native remote build** in Vercel, so the existing build command runs `convex deploy --cmd 'pnpm build'` with Vercel's production environment.
5. Smoke-tests the candidate, runs `vercel promote <deploymentId>`, then checks the live site.

In the same pull request, `vercel.json` gets `"git": {"deploymentEnabled": {"main": false}}`, so Git previews continue. GitHub holds only `VERCEL_TOKEN`. The Convex deploy key and Clerk secret stay in Vercel. There is no manual approval step.

Alternatives, depending on platform settings:

- **(A) `--prebuilt`:** use only if remote-build CLI deploys cannot carry SHA metadata or skew protection. The cost is that `vercel pull` copies production secrets into the GitHub runner.
- **(B) Keep Vercel Git production builds:** use only if Vercel offers a gate that waits for GitHub checks _before the build runs_ (root to verify). Deployment Checks only delay domain assignment. By then the Convex push has already happened.
- **(C) Deploy hooks:** rejected. A hook builds the branch's current head, not a specific commit, so it cannot guarantee the exact SHA.

## Practices

### R1 — Exact main-SHA CI gate before any Convex-mutating build

- **Classification / priority:** ADD NOW, P0.
- **Current state:** No release job exists (`quality.yml:12-73`). `README.md:76` runs the Convex deploy inside the Vercel build. Vercel's Git integration builds `main` at the same time as CI, not after it (README:48-51). The CLI runs `--cmd` and then pushes (`node_modules/convex/dist/cjs/cli/lib/deploy2.js:346,367`). So a commit that fails CI can still change production Convex.
- **Placement:** New `release` job in `quality.yml`: `needs: [check]`, `if: needs.check.result == 'success' && github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')`.
- **Why:** `check` uses `if: always()` (`quality.yml:60`), so the release job must explicitly require success.
- **Smallest change:** About 40 lines of YAML. No inputs that claim a SHA.
- **Prerequisites:** R2 lands in the same PR. The `main` ruleset (CI domain) prevents direct pushes that skip PR review.
- **Acceptance:** On a scratch branch, rehearse a deliberately failing test merged to a branch that mimics the release path. Expect no production Vercel deployment and no new entry in the Convex audit log. A green run on `main` produces exactly one production deployment whose metadata SHA equals `github.sha`.
- **Caveats:** Release latency grows by about 98 seconds of CI plus the Vercel build.

### R2 — Disable Git-triggered production builds in an atomic cutover PR

- **Classification / priority:** ADD NOW, P0.
- **Current state:** `vercel.json:1-4` contains only `ignoreCommand`.
- **Placement:** `vercel.json`, key `git.deploymentEnabled.main = false`, shipped in the same PR that adds R1. Settings to inventory: the Vercel production branch, deploy hooks, and dashboard "Redeploy".
- **Why:** Two paths would run Convex pushes with no shared lock.
- **Smallest change:** One JSON key. Revoke any production deploy hooks.
- **Trust boundary:** The cutover merge commit is itself released by GitHub Actions, because the merged workflow already contains `release`.
- **Acceptance:**
  - Merging a non-docs PR creates no Git-sourced production deployment.
  - Previews still build.
  - A read-back of the Vercel project settings shows the main branch deployment disabled.
  - The hook list is empty.
- **Caveats:** Before merging, wait for any in-flight Git production builds to finish and confirm their Convex push either completed or never started. Disabling the trigger does not stop builds already running.

### R3 — Native remote build (`vercel deploy --prod --skip-domain`), not `--prebuilt`

- **Classification / priority:** ADD NOW, P0. `--prebuilt` is CONDITIONAL.
- **Current state:** The Convex guard `isNonProdBuildEnvironment()` uses `VERCEL_ENV` only when `VERCEL` is set (`lib/envvars.js:412-424`). It returns `false` in plain GitHub Actions. The prior plan says to "evaluate prebuilt" (plan, Proposed release design).
- **Placement:** The `release` job step `vercel deploy --prod --skip-domain`, with the CLI version pinned exactly and the token passed through the environment (root: verify the CLI honours `VERCEL_TOKEN`).
- **Why:** A remote build keeps `CONVEX_DEPLOY_KEY` and `CLERK_SECRET_KEY` inside Vercel and keeps Vercel's system variables and skew-protection integration. It also keeps the Convex guard against production keys in non-production builds active (`deploy.js:109`). With `--prebuilt`, `vercel build` runs the same Convex push in the runner, and `vercel pull` writes production secrets to disk there.
- **Acceptance:** In Vercel, the deployment shows `target=production` and is not aliased. The build log contains `Deployed Convex functions to https://greedy-cardinal-537.convex.cloud`.
- **Caveats (root: verify):**
  - Whether CLI deployments populate `VERCEL_GIT_COMMIT_SHA`. Convex's audit message falls back to "Deployed from Vercel" without it (`envvars.js:328-396`). Mitigation: pass `--meta githubSha=$GITHUB_SHA` and compare.
  - If the runner is cancelled, the remote build may keep running and outlive the GitHub lock (see R6).

### R4 — Keep `convex deploy --cmd` ordering (frontend build first, then backend push)

- **Classification:** KEEP.
- **Confirmed:**
  - `runCommand` runs `spawnSync(cmd)` and crashes on a non-zero exit before `runPush` (`deploy2.js:346,372-402,367`). A failing `next build` therefore never mutates Convex.
  - The push sequence is `startPush`, then `waitForSchema` (schema validation and index backfill), then `finishPush` (`components.js:342,455,483`). A schema-validation failure crashes before `finishPush`, so nothing is committed.
  - Code generation runs _after_ `--cmd` (`deploy2.js:357`). The frontend is built against the committed `convex/_generated`.
- **Residual risk:** Failures _after_ the push, such as Vercel output upload or function packaging, leave the new backend serving the old frontend. Not promoting a candidate leaves the same state.
- **Acceptance:** A staging rehearsal with an injected `next build` failure produces no Convex audit entry.
- **Caveat:** Stale committed `_generated` files can mismatch the pushed functions. The dirty tree currently modifies `convex/_generated/*`, which must be committed with the backend change. A CI drift check is ADD NEXT (CI domain).

### R5 — Validate the environment and target inside `--cmd`, before the push

- **Classification / priority:** ADD NOW, P1.
- **Current state:** The app fails closed but builds green when unconfigured (`src/lib/auth/appAccess.ts:17-28`, `src/proxy.ts:13-19`, `src/lib/environment.ts:22-33`). The Convex CLI announces its target but does not assert it (`deploy.js` `deployToExistingDeployment`).
- **Placement:** New `scripts/assert-deploy-env.mjs`. Change the Vercel build command to `--cmd 'node scripts/assert-deploy-env.mjs && pnpm build'` and record that in `README.md:76`.
- **Rules:**
  - If `VERCEL_ENV=production`: require `NEXT_PUBLIC_CONVEX_URL == https://greedy-cardinal-537.convex.cloud` (injected by the CLI), a `pk_live_` Clerk key, a present `CLERK_SECRET_KEY`, and `CONVEX_DEPLOY_KEY` prefixed `prod:greedy-cardinal-537` (key format assumed; verify).
  - If preview: require `pk_test_` and a Convex URL that is not the production URL.
  - Print variable names only, never values.
- **Why:** `--cmd` runs after the CLI injects the URL and before the push, so a failure blocks the mutation.
- **Acceptance:** Unit tests over these rules. A preview misconfiguration fails the build with no Convex push.
- **Caveat:** `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` have no reads in `src/` or `convex/` (grep). Do not require them. The CLI injects the site URL anyway (`envvars.js:141-142`, `deploy2.js:388-392`).

### R6 — Release lock scope, pending policy and stale-SHA recheck

- **Classification / priority:** ADD NOW, P0.
- **Current state:** The workflow lock key includes `github.event_name` (`quality.yml:10`). A `workflow_dispatch` run on `main` and a `push` run on `main` therefore land in _different_ groups and could release at the same time.
- **Placement:** Job-level `concurrency: { group: production-release, cancel-in-progress: false }` on `release`. First step: compare `git ls-remote origin refs/heads/main` with `github.sha`. If they differ, skip with success, because the newer commit will release.
- **Pending policy:** A group keeps one running and one pending run, and newer pending runs replace older ones (verify any current queue option). That is acceptable here: an intermediate commit is superseded and its changes ship with the newer one.
- **In-flight check:** Before deploying, require that no production deployment is in BUILDING or QUEUED state. This covers orphaned remote builds and manual bypasses.
- **Acceptance:** Merge two PRs within 30 seconds of each other. Expect one active release, the stale one skipped, and the Convex audit log showing pushes in order with no "Schema was overwritten by another push" (`deploy2.js` `raceDetected`).
- **Caveat:** Once the deploy step starts, never cancel the job manually. Set `timeout-minutes` to about 45.

### R7 — Build once, then promote the same artifact

- **Classification / priority:** ADD NOW, P1.
- **Current state:** Next inlines `NEXT_PUBLIC_*` values at build time and they are "frozen" after that (Next `environment-variables.md:154-166`). The frozen fields are the Convex URL, the Clerk publishable key, the sign-in URL and the observability sink (src grep).
- **Placement:** The `release` job runs `vercel promote <deploymentId>` (verify that promoting a staged _production-target_ deployment does not rebuild, whereas promoting a _preview_ rebuilds with production variables).
- **Why:** A PR or preview build has the wrong frozen values. A rebuild would re-run `convex deploy`.
- **Acceptance:** The promoted deployment ID equals the candidate ID. Live HTML carries the same `data-dpl-id` (Next `deploymentId.md`; verify Vercel sets it).
- **Caveats:**
  - Rollbacks must reuse an existing artifact (Instant Rollback or promote). Dashboard "Redeploy" of an old deployment re-runs the build command and **pushes old backend code to Convex**. Document this.
  - Root: verify whether Vercel turns off production domain auto-assignment after a rollback. That does not matter when promotion is explicit.

### R8 — Candidate and post-promotion smoke tests (phased)

- **Classification / priority:** Phase 1 ADD NOW, P1. Authenticated production-Clerk smoke on the candidate is CONDITIONAL.
- **Current state:** No smoke tests or Playwright config exist, although `.gitignore` refers to `playwright.config.ts`. README:89-92 describes manual verification.
- **Phase 1 placement (`release` job):**
  - Candidate: deployment READY, metadata SHA matches, Convex target appears in the build log. Fetch a route with the automation bypass sent as a header, never in the URL.
  - Promote.
  - Live checks on `app.thaipropertyai.com`: `/th/sign-in` returns 200, the deployment ID matches, and the Clerk and Convex origins respond.
  - On failure, promote the previous deployment ID recorded before the release.
- **Why automatic frontend rollback is safe here:** The old frontend already served traffic against the new backend between the push and promotion.
- **Why authenticated candidate smoke is conditional:** Clerk production keys are bound to the production domain and do not support `*.vercel.app`. Authenticated smoke needs an owned candidate subdomain aliased to the staged deployment, a production test user, and bot protection handled. Root: verify Clerk testing-token availability for production instances.
- **Recommendation:** Run authenticated end-to-end tests against previews (Clerk development instance plus a Convex preview). Keep production checks read-only.
- **Acceptance:** A forced smoke failure in staging leaves the previous deployment serving and the job red.

### R9 — Docs-only skip and emergency redeploy under GitHub Actions

- **Classification / priority:** ADD NEXT, P2. The emergency path is ADD NOW.
- **Current state:** The script builds whenever `VERCEL_GIT_PREVIOUS_SHA` is missing or invalid, or `FORCE_VERCEL_BUILD=1` (`scripts/vercel-ignore-build.mjs:7-12`). CLI deployments almost certainly lack that variable, so every release builds, which fails safe.
- **Placement:**
  - Emergency path: the existing `workflow_dispatch` (`quality.yml:6`) on `main` runs full CI and then `release` for `github.sha`. It covers same-commit redeploys after environment-variable changes.
  - Optional skip: inside `release`, get the previous released SHA from GitHub deployment history (`deployments: read`, `fetch-depth: 0`), run the existing script with `VERCEL_GIT_PREVIOUS_SHA` set, and skip when it exits 0.
- **Acceptance:** A docs-only merge produces no new production deployment (once the skip is implemented). A dispatch produces one even for an unchanged SHA.
- **Caveats:** `FORCE_VERCEL_BUILD` remains relevant only to previews. Treat a CANCELED Vercel state (ignore step triggered) as failure, not success.

### R10 — Release credential scope and GitHub environment

- **Classification / priority:** ADD NOW, P0.
- **Current state:** The workflow is secret-free with `contents: read` and `persist-credentials: false` (`quality.yml:8,19,36,46`); KEEP that. The prior plan reuses the existing `Production` environment.
- **Placement:** New GitHub environment `production-release`:
  - Deployment branch policy: `main` only.
  - No required reviewers. Disable administrator bypass if the plan allows.
  - Secret: `VERCEL_TOKEN` (team-scoped, with expiry). Variables: `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`. `.vercel/project.json` confirms `industrial-sas` and team `team_HIg4…`.
  - Do not store any Convex or Clerk secret in GitHub.
- **Why a new environment:** `Production` and `Preview` match the names Vercel's Git integration uses for deployment statuses (assumption). Branch policies there could conflict with Vercel's status posting or be overwritten by it.
- **Acceptance:** A dispatch from a non-main ref cannot read the secret and fails before deploying. Workflow logs contain no token.
- **Caveat:** Vercel tokens are team-wide. Rotation needs an owner.

### R11 — Preview Convex and Clerk isolation and branch naming

- **Classification / priority:** ADD NOW (verification), P1.
- **Confirmed behaviour:**
  - With a preview deploy key, the preview name is `VERCEL_GIT_COMMIT_REF` (`envvars.js:397-400`, `deploy.js:130`). Branch names such as `codex/...` contain slashes; root: verify the naming limits.
  - A production key in a Vercel preview crashes the deploy (`deploy.js:109`). KEEP; never pass `--check-build-environment disable`.
  - `convex/auth.config.ts:6` reads `CLERK_JWT_ISSUER_DOMAIN`. Preview deployments therefore need Convex project default environment variables pointing at the Clerk _development_ instance (assumption from Convex behaviour; verify).
- **Unverified:** README:70 says the old Preview variables point elsewhere.
- **Settings:** In Vercel Preview: a Convex preview deploy key and `pk_test` keys, no production values. Turn on Vercel fork/external-PR build protection.
- **Acceptance:** A read-back shows Preview free of production values. A preview build log shows a deployment of type `preview`. A PR from a fork does not build with secrets without authorization.
- **Caveat:** Preview deployments have no Clerk webhook pointing at them. Webhook-driven organization sync is untestable there unless configured.

### R12 — Preview seeding

- **Classification:** CONDITIONAL / ADD NEXT.
- **Confirmed:** Every seed function requires `ALLOW_LOCAL_TEST_SEED` and refuses non-loopback URLs (`convex/staging/annexDemo.ts:211-226`, `hrDemo.ts:55-61`, also `paginationDemo.ts` and `storageLayoutUiDemo.ts`). `--preview-run` runs only when the preview deployment is new (`deploy.js:260`).
- **Implication:** Cloud previews currently get no fixtures. That is safe.
- **Change if needed:** A separate `convex/staging/previewSeed.ts` that requires a preview-only default variable and checks the deployment URL is not production, invoked via `--preview-run` in a preview-specific build command.
- **Acceptance:** Calling it on production throws, and a test asserts this.
- **Caveat:** Do not loosen the loopback guards.

### R13 — Backend compatibility and recovery after a mutation

- **Classification / priority:** ADD NOW (policy), P0. Keep the large-index protection.
- **Confirmed:**
  - Deleting an index of 100k or more documents in a non-interactive build crashes unless `--allow-deleting-large-indexes` is passed (`checkForLargeIndexDeletion.js:74`, `deploy2.js:362`). KEEP the flag out of the standard command.
  - `--dry-run` **skips `--cmd`** (`deploy2.js:382`) and regenerates `_generated` unless `--codegen disable` is set (`deploy2.js:357`).
- **Policy:**
  - Additive-first (expand/contract) schema changes.
  - Recovery is a forward fix merged through `main`.
  - Frontend rollback reuses an artifact.
  - Keep the metadata fixture test (`tests/integration/production-schema-compatibility.integration.test.ts`).
- **Acceptance:** A staging rehearsal that fails Vercel after the push is recovered by a follow-up `main` release, with the old frontend working against the new backend.
- **Caveat:** The real push already validates the schema before committing, so a dry-run preflight in the automatic path is largely redundant. Running it there would also put a production Convex key in GitHub.

### R14 — Manual bypass paths

- **Classification / priority:** ADD NOW (documentation and coordination), P1.
- **Evidence:**
  - README:89 tells people to run `npx vercel --prod`, which is an unlocked production Convex push.
  - Production data scripts (`scripts/import-fg1-production.mjs:27-45` and three others) use an **admin** key that they read from a variable named `CONVEX_DEPLOY_KEY`, from a local env file. They assert "Updated backend deployed", so they depend on release ordering.
  - Local `.env.convex-admin` and `.vercel/.env.preview.audit.local` exist. Both are gitignored and I did not read them.
- **Change:**
  - Replace README:89 with the dispatch path.
  - Rename the scripts' variable to `CONVEX_ADMIN_KEY` so a broad key never ends up in Vercel's slot.
  - Run data scripts only while no release is running.
  - Delete pulled env files once they are no longer needed (security owner).
- **Acceptance:** README and scripts contain no production push instruction outside GitHub Actions. Searching the scripts finds no admin key read from `CONVEX_DEPLOY_KEY`.

### R15 — Manual release approval, Deployment Checks, merge queue

- **Classification:** NOT APPLICABLE / overkill for now.
- Manual approval is excluded by the user's decision. PR review remains a separate requirement in rulesets.
- Vercel Deployment Checks add nothing when GitHub Actions promotes explicitly.
- A merge queue is unnecessary at this merge rate. If adopted later, it needs a `merge_group` trigger.

## Corrections to the prior plan

1. "Use the existing `Production` environment" should become a dedicated `production-release` environment (R10).
2. "Evaluate prebuilt" should become a recommended remote build. Prebuilt widens the secret boundary and loses the Convex non-production guard (R3).
3. Making the "backend deployment preflight" a dry-run gate is redundant in the automatic path. The dry run skips `--cmd`, writes codegen output, and needs a production key in GitHub (R13).
4. Production-Clerk authenticated smoke on the candidate is impractical as a phase-1 requirement (R8).
5. The lock defect is missed: `github.event_name` in the group key splits push and dispatch releases (R6).
6. Do not keep a "temporary manual procedure" alongside the new path. Cut over atomically, with the workflow and `vercel.json` in one PR (R2).
7. Additions the plan omits: the Redeploy-means-backend-downgrade hazard (R7), deploy hooks building branch head rather than a SHA, and the admin key named like the deploy key (R14).
8. Stale repository documentation: README:81 says to set `NEXT_PUBLIC_APP_URL`, which nothing reads. `.gitignore` cites `tests/integration/generated-artifacts.integration.test.ts` (missing) and a clean-tree assertion that `quality.yml` does not make.

## Dependencies on other domains

- **CI / governance:** A `main` ruleset requiring `check` (otherwise direct pushes still release) and a `_generated` drift check.
- **Security:** Secret scanning and token ownership.
- **QA:** Preview Playwright tests with the Clerk development instance.
- **Operations:** Alert routing for release failures, and a Convex backup drill before cutover.

## Root to verify against official documentation

- Vercel: `git.deploymentEnabled`; CLI `deploy --prod --skip-domain`, `promote` and `inspect`; system variables on CLI deployments; protection bypass for automation; Instant Rollback; fork protection.
- Convex: preview deploy keys and default environment variables, preview name limits.
- Clerk: production domain/subdomain rules and testing tokens.
- GitHub: concurrency pending behaviour; environments created by Vercel.
- Suggested starting points: https://vercel.com/docs/project-configuration/git-configuration, https://vercel.com/docs/cli/deploy, https://vercel.com/docs/cli/promote, https://docs.convex.dev/production/hosting/vercel, https://docs.convex.dev/production/hosting/preview-deployments, https://clerk.com/docs/guides/development/deployment/vercel, https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency.

## Summary

| ID  | Practice                                              | Class                          | Priority | Placement                                           |
| --- | ----------------------------------------------------- | ------------------------------ | -------- | --------------------------------------------------- |
| R1  | Same-SHA CI gate before Convex push                   | ADD NOW                        | P0       | `quality.yml` `release` job, `needs: check`         |
| R2  | Disable Git production builds; atomic cutover         | ADD NOW                        | P0       | `vercel.json` `git.deploymentEnabled`; hooks        |
| R3  | Remote build, not `--prebuilt`                        | ADD NOW (prebuilt CONDITIONAL) | P0       | `release` step `vercel deploy --prod --skip-domain` |
| R4  | `--cmd` before push ordering                          | KEEP                           | —        | README:76 build command                             |
| R5  | Environment/target validator inside `--cmd`           | ADD NOW                        | P1       | `scripts/assert-deploy-env.mjs` + build command     |
| R6  | Fixed lock, no cancel, stale recheck, in-flight check | ADD NOW                        | P0       | job-level `concurrency` + first steps               |
| R7  | Promote the same artifact; never Redeploy             | ADD NOW                        | P1       | `vercel promote`; runbook                           |
| R8  | Phased smoke tests + automatic frontend rollback      | ADD NOW / CONDITIONAL          | P1       | `release` steps; previews for auth E2E              |
| R9  | Docs skip + dispatch emergency path                   | ADD NOW / NEXT                 | P2       | `workflow_dispatch`; reuse ignore script            |
| R10 | Dedicated environment, Vercel-only secret             | ADD NOW                        | P0       | GitHub environment `production-release`             |
| R11 | Preview Convex/Clerk isolation                        | ADD NOW (verify)               | P1       | Vercel Preview vars; Convex preview defaults        |
| R12 | Preview seeding                                       | CONDITIONAL                    | P3       | new `convex/staging/previewSeed.ts`                 |
| R13 | Compatibility/recovery; large-index guard             | ADD NOW / KEEP                 | P0       | policy + metadata fixture                           |
| R14 | Manual bypass coordination                            | ADD NOW                        | P1       | README:89; production scripts                       |
| R15 | Manual approval / Deployment Checks / merge queue     | N/A                            | —        | —                                                   |
