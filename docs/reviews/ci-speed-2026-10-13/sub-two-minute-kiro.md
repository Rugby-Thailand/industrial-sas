# Sub-two-minute release: adversarial review (Kiro)

Date: 2026-10-13. Plan only. This file is the only change. I made no source or
config edits, deploys, dispatches, installs, setting changes, secret reads or
app/provider endpoint calls. Remote `main` was `c425dd80f70f…` (confirmed with
`gh api …/commits/main`). Files were read with `git archive c425dd80` into a
temporary directory, which has since been removed. Timings come from GitHub job
metadata. For run 38350247746, allowlisted `[release:production]` event
timestamps were parsed from the log in memory; no IDs or log text were kept.

## Verdict

- **No-go on promising under 120 s.** No measured component supports it on the
  current plans. **Go on the experiments below.** The split architecture is the
  only family with a credible path. Even then, a sub-120 s p50 needs four
  things: a gate that is polled from a pre-warmed tail; quality and the
  frontend candidate each at ≤75–80 s; a Convex push of about 15 s or less;
  and staging still disabled. p95 under 120 s is not credible: measured Vercel
  build spans are 83–230 s, and an uncached trusted install took 77 s.
- The proposed order is sound with one change. Run every frontend-only
  candidate check **before** the backend push. This makes the split _safer_ than
  today: a bad frontend fails with mutation `none`.
- Three blocking design gaps need concrete designs before any implementation:
  1. how the backend credential is moved and executed;
  2. new inventory and mutation semantics;
  3. the tail's preparation cost, which alone exceeds the 30–40 s tail budget.
     Each is detailed below.

## Measured floors (standard `ubuntu-24.04`, public repo, GitHub Free org)

| Item                                                                            | Measured                                | Source                        |
| ------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------- |
| Push → first job start                                                          | 3–4 s                                   | runs 38347275340, 38350247746 |
| Checkout / cached setup per job                                                 | 6–11 s / 11–24 s                        | same                          |
| Uncached trusted setup (release jobs)                                           | 15–19 s typical, **77 s** at `c425dd80` | 38350247746 production job    |
| Chromium `--with-deps` / three engines                                          | 21–32 s / 59–80 s                       | same                          |
| Vitest shard step (1/3)                                                         | 43–82 s                                 | same                          |
| Workspace shard step (1/2)                                                      | 54–82 s                                 | same                          |
| Smoke build / smoke tests                                                       | 42–48 s (warm cache) / 38–39 s          | same                          |
| Quality gate complete                                                           | 170 s (`c425dd80`), 201 s (`0bbd285f`)  | same                          |
| `check` job; gap to next job                                                    | 5–6 s; 4–5 s                            | same                          |
| Backup, database-only (first live run)                                          | 2.2 s                                   | 38350247746 events            |
| Coupled remote build created→READY                                              | 104.9 s (`c425dd80`); 99–143 s earlier  | events, `timings.md`          |
| Candidate smoke / promote / live smoke                                          | 6.4 / 0.5 / 3.3 s                       | 38350247746 events            |
| Production job start → controller start                                         | ~119 s (setup 77 s + Chromium 30 s)     | 38350247746                   |
| Convex push alone, frontend-only Vercel build, prebuilt upload, cold Next build | **unmeasured**                          | —                             |

At `c425dd80`, staging still ran (the policy variable has not been changed).
Push-to-live was 747 s.

### Budget arithmetic

With a pre-warmed tail that polls the gate:
`T ≈ 4 + max(Q, F) + 6 (check) + 3 (poll) + Y (Convex push) + ~10 (post-push checks, promote, live)`.

- `Q` is the quality lane and `F` the frontend candidate.
- For `T < 120`: `max(Q, F) + Y ≲ 97`. If `Y = 15`, then `Q, F ≤ ~80`.

With a conventional `needs: check` tail, preparation must happen after the
gate. That preparation is checkout, node, a root install and Chromium: about
45 s median and 119 s observed. Under-120 would then need `Q ≤ ~35–50 s`, which
is impossible given the 20–30 s fixed floor per job. **Pre-warming is not
optional for this target.**

`Q ≤ 80` today means cutting the current maximum of 158–189 s by more than half
on every job. Each job has a fixed floor of about 25 s for checkout and setup.
The estimated shape:

- 6 Vitest shards;
- 4 workspace shards;
- navigation engines split, or a pinned Playwright image;
- the smoke build overlapped with browser installation;
- lint and format run in parallel.

That is about 18–20 concurrent jobs. The GitHub Free limit is **20 concurrent
standard jobs** ([limits](https://docs.github.com/en/actions/reference/limits)).
One push plus one PR run would therefore queue. Larger runners and custom
images (custom images GA 2026-03-26) require Team or Enterprise. This org's
plan is `free`, and `GET orgs/…/actions/hosted-runners` returns "not supported
for this organization". Using paid preinstalled runners requires a purchase,
which is a user decision. Third-party runners are acceptable only for jobs
without secrets, and never for the tail.

## Findings on the proposed architecture

### B1 (blocker): the backend credential and how it is executed

Today the production `CONVEX_DEPLOY_KEY` exists **only in Vercel**. GitHub
`production-release` holds `VERCEL_TOKEN` and `CONVEX_BACKUP_ADMIN_KEY`
(runbook "Configuration inventory"). Removing `convex deploy` from the build
means a runner must push the backend. Concrete design:

1. **Key.** An operator mints a new production deploy key in Convex with only
   the `deployment:deploy` permission. Scoped deploy keys are documented in
   [Deploy keys](https://docs.convex.dev/cli/deploy-key-types) and
   [role actions](https://docs.convex.dev/team-management/role-actions). This
   does not limit what _pushed code_ can do. It does stop a leaked key from
   directly running `env set`, `run`, `import` or `export`. Add
   `deployment:auditLog:view` only if the backend-ledger readback (B2) uses
   the audit log. Experiment E5 must prove the scoping with convex 1.46.0
   first.
2. **Placement.** Use the same job and environment, `production-release`. The
   lock is a job-level concurrency group, and a second job would release it
   between backup and push. Use a distinct secret name such as
   `CONVEX_RELEASE_DEPLOY_KEY`. This name matters:
   `convex-backup.mjs` `AMBIENT_SELECTION` refuses the backup when
   `CONVEX_DEPLOY_KEY` is in the process environment. Naively adding it to
   the controller step would therefore turn every release into
   `BACKUP_FAILED`. That fails closed, but it blocks every release.
3. **Execution.** Prefer one step per phase, so each secret is present only in
   its own step. The order: backup step (backup key only), then push step
   (deploy key only), then frontend steps (`VERCEL_TOKEN` only). Phases hand
   over state through the manifest, and the current-`main` check is repeated
   before the push. If the controller stays a single process, give the Convex
   child an _allowlisted_ environment: `PATH`, `HOME`, `CI`, and
   `CONVEX_DEPLOY_KEY` mapped from the renamed slot. Change
   `smokeEnvironment` from a denylist to an allowlist. The current denylist
   strips `CONVEX_DEPLOY_KEY` only, so a renamed slot would reach the
   Playwright workers.
4. **Command.** From the clean checkout of the gated SHA, after the frozen root
   install (lifecycle scripts stay blocked by `strictDepBuilds`):
   `pnpm exec convex deploy --codegen disable --message "release <sha> run <id>"`.
   - `--codegen disable` is safe because the codegen job checks freshness for
     the same SHA.
   - `--typecheck disable` is safe only if quality adds the Convex-tsconfig
     typecheck. Prior audit: CI does not run it today.
   - Never pass `--skip-large-indexes-check`.
   - Use no `--cmd`, a bounded timeout, and validate the key's class and
     deployment offline first with the existing `classifyConvexDeployKey`.
5. **Remove from Vercel.** After the first successful split release, remove
   `CONVEX_DEPLOY_KEY` from every Vercel target and revoke the old key. Until
   then, a dashboard Redeploy or deploy hook of any historical deployment runs
   that deployment's committed coupled `buildCommand` with the live key.
   Invert the frontend build contract so that the Vercel build **refuses** the
   presence of `CONVEX_DEPLOY_KEY`. Add this to the cutover predicate
   (`cutoverState`).
6. **Threat delta.** Merged code already reaches the production backend
   automatically today. The new exposure is _persistent exfiltration_: a
   merged workflow change can copy the key, and the copy survives a revert.
   Mitigations: deploy-only scope, expiry and rotation dates like the
   existing tokens, and a main-only environment branch policy. Consider
   requiring code-owner review for `.github/**` and `scripts/release/**`;
   human review is currently optional, and changing that is a setting change
   the user must decide. Staging already keeps its dev deploy key in GitHub,
   so the pattern has precedent.

### B2 (blocker): inventory and mutation semantics

The controller treats every newer production-target Vercel deployment as a
possible Convex push. This shows up in three places:

- `BLOCKED_IN_FLIGHT`;
- `BLOCKED_UNRECONCILED`;
- `promote()` `CONFLICT` on any deployment with `createdAt ≥ candidate`.

Once frontend candidates are created before the gate, that becomes wrong in
both directions:

- **False blocks.** A failed-gate or superseded candidate becomes an
  "unreconciled" deployment. The next commit's pre-gate candidate turns this
  run's promotion into `CONFLICT` **after** its backend push.
- **Missed detection.** Backend pushes no longer create Vercel deployments, so
  an interrupted push leaves no trace in the Vercel inventory.

Required:

- **Durable backend ledger.** Record intent and result before and after the
  push. Options: a GitHub Deployment for a `production-backend` environment
  (needs `deployments: write`), or the Convex audit log via `--message` (needs
  view scope). Preflight refuses on an `in_progress` or failed ledger entry,
  and when the backend SHA differs from the serving frontend SHA, unless an
  operator has acknowledged it.
- **Classify Vercel deployments by kind.** Count frontend-only candidates
  (pipeline metadata, built after the key removal) as harmless. Narrow
  `CONFLICT` to "serving changed" or "promotion target is not ours". Keep the
  old rules until the cutover predicate in B1.5 holds.
- **New outcomes.**
  - `CANDIDATE_PRECHECK_FAILED`: mutation `none`.
  - `BACKEND_PUSH_FAILED` / `BACKEND_PUSH_TIMEOUT`: `backend-possible`. A
    non-zero CLI exit cannot be attributed to a pre-push stage.
  - The existing `VERIFY_FAILED` moves before the push.
- **Tests.** Update the failure table, mutation fixtures and validator in the
  same change.

### B3 (blocker for the target): tail preparation

The only way to get a 30–40 s tail on the Free plan is to start the release job
at push time. That job would:

1. take the production lock;
2. check out and install without secrets in the environment;
3. install Chromium, preferably the shell only;
4. **poll this run attempt's `check` result** through the Actions API (needs
   `actions: read`);
5. only then run any step that uses a secret.

This is an intentional redesign of the declarative `needs: check` gate
(`RELEASE_CONDITIONS`, "release must need check" in `workflow-lib.mjs`):

- The lock is held during quality, so the daily backup and the next release
  wait about 80 s longer.
- The validator must statically prove that no secret-bearing step precedes
  the poll, and that the poll fails closed on failure, cancellation, a missing
  result or the wrong attempt.

Without this redesign, the realistic tail is 55–85 s median and over 120 s in
the observed worst case.

### Major

- **M1, secrets at build time (prebuilt option).** Vercel Secret values are
  write-only ([Config/Secret](https://vercel.com/docs/environment-variables/sensitive-environment-variables)).
  `vercel pull` cannot supply them, and production `UPLOADTHING_TOKEN` is
  already a Secret. The env contract requires `CLERK_SECRET_KEY` and
  `UPLOADTHING_TOKEN` at build. `src/proxy.ts` and
  `src/lib/auth/appAccess.ts` gate Clerk on `CLERK_SECRET_KEY` presence, and
  smoke guards against the "Sign-in unavailable" copy. Whether any of this is
  baked in at build time is unproven (E3).
  - If it is baked, the build needs live secrets before the gate, on a public
    repository. Workflow artifacts and caches from `main` are readable by PR
    runs, including forks
    ([cache access rules](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache)).
    That is a no-go for the prebuilt option.
- **M2, system variables and the env validator.** With `--prebuilt`, system
  environment variables are missing at build time
  ([deploy docs](https://vercel.com/docs/cli/deploy#when-not-to-use---prebuilt)).
  The current `pre` and `build` phases require `VERCEL=1`,
  `VERCEL_TARGET_ENV` and `VERCEL_PROJECT_ID`, so they would fail. The
  replacement provenance must come from the runner, artifact digest, metadata
  and pre-push HTTP checks, plus a names-only Vercel env inventory check that
  the runtime Secrets exist for the target.
- **M3, skew protection.** It is available on Pro and Enterprise only. Whether
  it is enabled here, and on which Vercel plan, is unverified (no endpoint
  calls). For prebuilt, Vercel's skew page contradicts itself: "not available
  for prebuilt" next to "requires a custom deployment ID". The
  [2026-01-28 changelog](https://vercel.com/changelog/skew-protection-now-supports-prebuilt-deployments)
  says it is supported via `deploymentId` in `next.config`. Use a non-`dpl_`
  ID unique per build, such as SHA plus run attempt, and prove it (E2).
  Convex WebSocket clients in old tabs are not covered by any of this.
  Expand/migrate/contract remains the real compatibility rule.
- **M4, hosted Bun.** A remote build honours `vercel.json`'s
  `bunVersion: "1.4.x"` natively. For prebuilt, check
  `.vercel/output/functions/**/.vc-config.json` statically for the Bun runtime
  _before_ upload. Today the runtime is checked only by smoke, which in the new
  order would run after the push.
- **M5, `RELEASE_SHA`.** It is used twice:
  - baked into the `X-Release-Sha` header (`next.config.ts` `headers()`);
  - read at runtime by `/api/runtime` (`force-dynamic`), where smoke accepts
    `null` because `--build-env` is build-only.

  For either split option, also pass `--env RELEASE_SHA=<sha>` (runtime) and
  tighten smoke to require a non-null matching body SHA. Keep `--meta` as
  well. The metadata is self-asserted by the token holder, so pair it with the
  artifact digest (prebuilt) or the pre-push HTTP checks (both options).

- **M6, artifact integrity (prebuilt).** Pass `.vercel/output` within one run.
  Record the upload-artifact digest as a job output, and verify it after
  download with a pinned download-artifact version that fails on mismatch
  ([digest changelog](https://github.blog/changelog/2025-03-18-github-actions-now-supports-a-digest-for-validating-your-artifacts-at-runtime/)).
  Artifacts on this public repository are downloadable by any signed-in user,
  so scan the artifact for credential shapes and `.vercel/.env*` and fail on
  any hit. Attestation is optional for a same-run handoff.
- **M7, cache trust.** Keep production builds uncached until cold timings are
  known. A cache written by a job that saw any secret is a fork-readable leak.
  A later cache may hold only the output of a secret-free build. It needs its
  own key namespace, written only by the `push`-triggered build job, and must
  never restore from smoke's `.next/cache`, whose environment inputs differ.
- **M8, writes and network during the build.**
  - `next/font/google` fetches fonts during the build.
  - The Sentry plugin, when `SENTRY_ENABLED=1` and an auth token are present,
    uploads source maps with a secret at build time. Before the gate, that
    would publish maps for an unreleased SHA. Disable it before the gate, or
    upload after the gate.
  - `vercel build` writes `.vercel/output` and `.next` and may re-run the
    install command. Measure this, and keep `ci:clean-tree` after the build.
- **M9, provider queue.** A pre-gate remote build per merge competes for
  Vercel's concurrent build slots (plan-dependent, unverified). Rapid merges
  can make `F` the critical path.

### Minor

- `Y` (the Convex push) depends on the data. New or changed indexes block the
  push until backfill finishes; large tables prompt for confirmation
  ([indexes](https://docs.convex.dev/database/reading-data/indexes)). Schema
  changes revalidate existing documents. The data is small today (3,296
  documents in the last restore rehearsal), but an SLA must exclude
  index and schema pushes, lockfile changes, cold caches and Playwright
  version bumps.
- The runbook still says the native Git cutover steps 1–4 "have not been
  executed". Reconcile it before stating which Vercel paths can push the
  backend.
- When staging is re-enabled, it adds a full sequential tail. A sub-120 s SLA
  is defined only while staging is disabled. Record that in the SLA itself.

## Alternatives compared

| Option                                                                                     | Critical path (est.)                               | Safety vs. today                                                                                   | Main unknowns                                  |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| A. Current coupled build, staging off                                                      | about 170 + 6 + 244 ≈ 7 min (from `c425dd80` jobs) | baseline                                                                                           | none                                           |
| B. A plus the existing speed-plan items                                                    | about 5–6 min (plan estimate, unmeasured)          | equal                                                                                              | browser and image savings                      |
| C. **Remote frontend-only candidate before the gate**, runner Convex push, pre-warmed tail | `max(Q, F_remote) + ~25 + Y`                       | better (frontend checks before mutation); new key placement                                        | `F_remote` without Convex (E1), Y (E4), Q (E7) |
| D. **Prebuilt** on the runner, uploaded after the gate                                     | `max(Q, B_runner) + upload + ~25 + Y`              | better if E3 shows the build needs no secrets; otherwise worse (pre-gate secrets on a public repo) | E2, E3, upload time                            |
| E. Larger or custom-image runners with C or D                                              | lowers Q and setup                                 | equal                                                                                              | requires a Team plan purchase                  |
| F. Native Vercel Git builds                                                                | —                                                  | rejected: bypasses the lock and backup                                                             | —                                              |

**Prefer C** as the first candidate. Secrets, system variables, skew protection
and Bun stay native in Vercel. It uses no GitHub job slots for the build. The
build runner never holds a credential: the pre-gate job holds only the
project-restricted `VERCEL_TOKEN`, runs only the pinned CLI and uploads source.
That last point is an intentional, documented change, because the token is
currently used only after the gate. Choose D only if E2 and E3 pass and E1
shows `F_remote > 80 s`.

## Go/no-go experiments (in order)

Each is gated by the user where it touches a provider. Run each at least 5
times. Report median and range, not sums.

| #   | Experiment                                                                                                                                                                                                                                                                                   | Go if                                                                                        | No-go action                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| E0  | Record Vercel `buildingAt`/`ready` in the manifest. An operator privately reads the build logs for how long the Convex push took inside the coupled build.                                                                                                                                   | the Convex portion is ≥ 15 s, or splitting is still required for the pre-gate overlap        | if the split saves under 15 s and E7 fails, stop at B   |
| E1  | Staging project only: CLI deploy with a frontend-only build command (no `convex deploy`), created→READY                                                                                                                                                                                      | median ≤ 75 s                                                                                | try D, or accept that F is critical                     |
| E2  | Staging prebuilt: `vercel build` without `vercel pull`, using a constructed project config and no secrets. Check the Bun runtime in `.vc-config.json`, the `deploymentId` in routes-manifest, the header SHA and a credential scan. Then `deploy --prebuilt --archive=tgz --env RELEASE_SHA` | build + upload ≤ 75 s; runtime Secrets work; Bun 1.4.x serves; skew routing works if enabled | drop D                                                  |
| E3  | Build twice, with and without `CLERK_SECRET_KEY`/`UPLOADTHING_TOKEN` (staging values), and diff the server output and prerendered HTML                                                                                                                                                       | identical apart from build IDs                                                               | D needs pre-gate secrets: no-go                         |
| E4  | Staging Convex push from a runner with `--codegen disable --message`: no-op, code-only, additive field, small new index                                                                                                                                                                      | no-op and code-only median ≤ 15 s                                                            | budget fails; publish the measured target               |
| E5  | Deploy-only scoped key on staging with convex 1.46.0: push succeeds; `env set`, `run`, `import` and `export` are refused                                                                                                                                                                     | all as expected                                                                              | use a full key only with an explicit risk sign-off      |
| E6  | Pre-warmed tail without secrets on a branch: lock behaviour, gate-poll latency, the backup workflow waiting, and the validator proving "no secret before the gate"                                                                                                                           | gate → first mutation ≤ 5 s; fails closed on every gate state                                | conventional tail; under-120 impossible                 |
| E7  | Quality ≤ 75 s on standard runners: shard counts, navigation image or split, overlap, parallel validate; identical test inventory; ≤ 18 concurrent jobs                                                                                                                                      | every job ≤ 75 s in ≥ 4 of 5 runs                                                            | the user decides on Team runners or relaxing the target |
| E8  | Uncached trusted install variance (10 runs)                                                                                                                                                                                                                                                  | p80 ≤ 25 s                                                                                   | makes E6 mandatory                                      |
| E9  | State-machine tests for B2: orphan and superseded candidates, interruption after the push, narrowed `CONFLICT`, new outcomes, the cutover predicate refusing a Vercel `CONVEX_DEPLOY_KEY`                                                                                                    | all mutation fixtures pass                                                                   | do not cut over                                         |
| E10 | Full split path on staging with injected failures: precheck, push, promote, cancellation after the push                                                                                                                                                                                      | every outcome matches the new failure table                                                  | do not cut over                                         |

Production cutover happens only after E9 and E10 pass, in this order:

1. Mint the scoped key.
2. Add it as a GitHub environment secret.
3. Run the first split release under observation.
4. Remove the key from Vercel and revoke the old one.
5. Verify that the Vercel build refuses the key slot.

Each step is high-risk and needs the user's explicit approval.

Commit publicly to under 120 s only if E1 or E2, plus E4, E6 and E7, all pass.
Otherwise publish the measured p50 and name the binding constraint.
