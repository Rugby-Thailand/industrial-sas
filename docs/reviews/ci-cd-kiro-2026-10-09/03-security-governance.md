# CI security, governance and supply-chain audit for industrial-sas

> Coordinator verification (2026-10-09): the consolidated audit is the implementation authority. Live GitHub confirms no rulesets, unprotected main, disabled secret scanning/push protection/security updates, all actions allowed, SHA enforcement off, and CodeQL not configured. The fork-run policy is first_time_contributors; the earlier disabled setting meant Actions cannot create/approve PRs. Contributor authorship does not establish write access or prove a direct push. The selected initial remote-build design retains Convex and Clerk production secrets in Vercel; GitHub production-release holds the Vercel token. S6's key removal and S7's prebuilt split are conditional alternatives, not requirements for that design. A deploy-only key still permits backend code changes and is not a data-access containment guarantee. Default CodeQL setup excludes fork PRs under current documentation, so that coverage cannot be assumed. GitHub caches are scoped and current low-trust cache tokens default to read mode; hardening must preserve those boundaries. SBOMs, signing, OIDC, and isolated self-hosted runners are conditional rather than universally invalid.

## Scope and evidence

This was a read-only inspection of the local checkout at `0e9ea3a` with uncommitted HR/search work. I also checked `git log origin/main` (fetched `cc42063`). No CI, security or dependency files changed between `0e9ea3a` and `cc42063`. I did not browse any URLs. I did not inspect any live GitHub, Vercel, Convex or Clerk settings, and I treat them as unverified.

I did not read the contents of `.env.local`, `.env.convex-admin` or `data/import-staging/*`. For those I checked only filenames, permission modes and ignore status. I read the Next guides `environment-variables.md`, `building.md` and `ci-build-caching.md` under `node_modules/next/dist/docs/01-app/02-guides/`. They confirm that `next build` loads the environment, runs `next.config`, prerenders app code, and bakes `NEXT_PUBLIC_*` values into the build (`environment-variables.md:158-166`, `building.md:27,104`).

Confidence labels: **[C]** means confirmed from the repository or command output. **[A]** means an assumption or inference that root should verify.

## Findings

### S1: Secret-free, least-privilege PR workflow (KEEP, P0 invariant)

- **Current state [C]:**
  - The workflow sets `permissions: contents: read` (`.github/workflows/quality.yml:7-8`).
  - All three checkouts use `persist-credentials: false` (`:17-19`, `:34-36`, `:44-46`).
  - Triggers are `push: main`, `pull_request` and `workflow_dispatch` (`:2-6`).
  - Grep found no `secrets.`, `pull_request_target`, `workflow_run` or `id-token` anywhere in `.github`.
  - No `run:` step interpolates untrusted context. `matrix.shard` (`:38`) is a static value.
- **Why it matters:** in a public repository, fork PRs and Dependabot PRs execute this workflow's code. Today they can only receive a read-only token and no secrets.
- **Placement:** keep it as-is. Add a CODEOWNERS rule on `/.github/` (see S4).
- **Acceptance checks:**
  - The "Set up job" log of a fork PR run shows `GITHUB_TOKEN Permissions: Contents: read`.
  - A grep of `.github` for `pull_request_target|workflow_run|secrets\.` returns nothing except an approved release job.
- **Caveat:** any future job that needs a secret must not be added to the `pull_request` path (see S6).

### S2: Pin actions by SHA and enforce pinning at the platform (KEEP + ADD NOW, P1)

- **Current state [C]:**
  - All external actions are pinned to full SHAs with version comments: checkout (`quality.yml:17,34,44`), cache (`:49`), `pnpm/action-setup` (`action.yml:15`) and `setup-node` (`action.yml:21`).
  - Dependabot covers both directories weekly (`dependabot.yml:9-14`).
- **Gap:** the plan reports that all actions are allowed and that SHA pinning is not enforced. **[A]**, root is refreshing this.
- **Smallest change:** under Settings → Actions → General:
  - Choose "Allow select actions".
  - Allow `actions/*` and `pnpm/action-setup@*`, plus the future Vercel/dependency-review/CodeQL actions.
  - Turn on "Require actions to be pinned to a full-length commit SHA".
- **Acceptance checks:**
  - A test branch that uses `actions/checkout@v5` fails at job setup.
  - The current workflow still passes.
  - The local composite `./.github/actions/setup-node-pnpm` still resolves.
- **Caveat:** each new action requires an allowlist edit. Dependabot's SHA rewrites stay compatible.

### S3: Main branch ruleset (ADD NOW, P0)

- **Current state:**
  - The plan reports zero rulesets and `main` unprotected **[A, root refreshing]**.
  - Local history shows first-parent commit `d8d7aa0` "Correct FG1 rear edge…". It has no `(#N)` suffix and added `scripts/correct-fg1-rear-aisle-production.mjs`. This is consistent with a direct push to `main` **[A]**. Root can verify with `GET /repos/{o}/{r}/commits/d8d7aa0/pulls`.
- **Why it matters more now:** with automatic production release, every commit on `main` deploys.
- **Placement:** a repository ruleset targeting the default branch:
  - Require a pull request.
  - Require status check `check` with its source pinned to the GitHub Actions app, so a commit status posted under the same name by another integration cannot satisfy it.
  - Block force pushes and branch deletion.
  - Keep the bypass list empty, or admins limited to "pull requests only".
- **Governance (separate decision):**
  - Require 1 approval, dismiss stale approvals, and require approval of the most recent push, so an author cannot push after approval and auto-deploy.
  - A second contributor exists (`giftchennissa-creator` authored #38 and #41). Their write permission is **[A]**.
- **Dependabot and fork defaults:**
  - Their PRs run `check` with a read-only token. They pass or fail exactly like human PRs.
  - Both still need a human approval, which is consistent with D-29.
  - Do not enable Dependabot auto-merge, because merging means deploying to production.
- **Acceptance checks:**
  - A direct `git push origin main` from a non-bypass account is rejected.
  - A PR where `test` fails shows `check` red and cannot be merged.
  - A commit status named `check` posted through the API from a non-Actions source does not satisfy the rule.
- **Caveat:** "require branches up to date" is optional. The release depends on the push-to-main `check` (S6), so a broken merge result still cannot deploy.

### S4: CODEOWNERS for trust-critical paths (ADD NOW, P1)

- **Current state [C]:** there is no CODEOWNERS file (grep of tracked files).
- **Placement:** new file `.github/CODEOWNERS`. Root must confirm the owner handles have write access. Paths:
  - CI and policy: `/.github/`, `/.github/CODEOWNERS`
  - Dependencies and toolchain: `/package.json`, `/pnpm-lock.yaml`, `/pnpm-workspace.yaml`, `/.npmrc`, `/.nvmrc`
  - Build and deploy: `/vercel.json`, `/next.config.ts`, `/scripts/`
  - Backend, auth and tenancy: `/convex/schema.ts`, `/convex/auth.config.ts`, `/convex/http.ts`, `/convex/lib/permissions.ts`, `/convex/lib/tenant*.ts`
  - Edge security: `/src/proxy.ts`, `/src/lib/securityHeaders.ts`
- Turn on "Require review from Code Owners" in the S3 ruleset.
- **Acceptance checks:**
  - A PR that touches `pnpm-lock.yaml` automatically requests the owner and is blocked until they approve.
  - GitHub's CODEOWNERS error view shows no errors.
- **Caveat:** a sole owner cannot approve their own PR. With two owners, list both.

### S5: Fork PR approval and the default workflow trust model (KEEP + ADD NOW setting, P1)

- **Current state:**
  - The plan reports that "workflow PR approval" is disabled. That label is ambiguous. It may mean "Allow GitHub Actions to create and approve pull requests" (keep that disabled) rather than the fork-run approval policy **[A]**.
- **Placement:** under Settings → Actions → "Approval for running fork pull request workflows", choose "Require approval for all external contributors".
- **Why:** fork runs hold no secrets (S1). Approval limits compute abuse and stops untrusted code from probing caches before review.
- **Acceptance checks:** a PR from a throwaway fork shows "Approve and run" and does not run until approved.
- **Cost:** a click per external PR.

### S6: Credential boundary for the automatic release job (ADD NOW with the release workflow, P0)

- **Current state:**
  - No release workflow exists **[C]**.
  - Production deploys through Vercel Git with `CONVEX_DEPLOY_KEY` in Vercel Production (`README.md:76-79`) **[C, live state A]**.
- **Placement:** a `release` job in `quality.yml`, so it gets the same-SHA `needs` dependency:
  - `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`, with `needs: check`.
  - `environment: Production`, with the deployment branch policy limited to `main` and no required reviewers.
  - Job-level `permissions: contents: read`, with `concurrency: {group: production-release, cancel-in-progress: false}`.
  - Store `CONVEX_DEPLOY_KEY` and `VERCEL_TOKEN` as environment secrets, not repository secrets, so PR and dispatch runs on other refs cannot read them.
  - Pass secrets through `env:` only on the steps that use them.
- **Avoid `workflow_run`:** it runs with base-repo secrets even when the triggering run came from a fork. If it is ever used, it must check `event == 'push'`, `head_branch == 'main'` and that the head repository equals the repository.
- **Trust boundary:** code that reaches `main` through the S3 ruleset.
- **Behavioural checks:**
  - A fork PR, and a `workflow_dispatch` on a non-main branch, shows `release` skipped. If forced, it fails with "branch not allowed to deploy to Production".
  - A main push where `check` fails produces no release job.
  - Printing `${{ secrets.CONVEX_DEPLOY_KEY != '' }}` in a PR job shows `false`.
- **Cross-domain:** after cutover, remove `CONVEX_DEPLOY_KEY` from Vercel Production so only one holder remains, then rotate the key. Vercel `.github/`-only skips (`scripts/vercel-ignore-build.mjs:30-35`) do not apply to GitHub-triggered releases.

### S7: Keep the deploy key out of the full dependency build (ADD NEXT, P1)

- **Current state [C]:**
  - `convex deploy --cmd 'pnpm build'` (`README.md:76`) runs `next build` with the deploy key in its environment.
  - Per the Next docs, that build runs `next.config.ts`, PostCSS/Tailwind and prerendering of app code. The whole dependency graph, devDependencies included, can therefore read the key.
- **Correction to the plan:** the plan treats a "deploy-only" key as a containment boundary. The `deployment:deploy` permission lets the holder push arbitrary backend functions, which have full data access. It narrows CLI operations, not the blast radius.
- **Smallest change:** split the release into separate steps:
  1. Build with only public configuration (`NEXT_PUBLIC_CONVEX_URL` for production is static).
  2. Run the pinned `convex deploy` without `--cmd`, with the key present only in that step.
  3. Upload the prebuilt artifact.
- Root and the deployment domain must reconcile this with Vercel prebuilt/system-env limits and the Convex ordering.
- **Acceptance checks:** the build step's `env` contains no `CONVEX_DEPLOY_KEY`. A test dependency script that reads `process.env.CONVEX_DEPLOY_KEY` during build sees it undefined.
- **Caveat:** whether `CLERK_SECRET_KEY` is needed at build time is unverified **[A]**.

### S8: Secret scanning and push protection (ADD NOW, P0)

- **Current state:**
  - The plan reports both disabled **[A, root refreshing]**.
  - Only `.env.example` is tracked among environment or credential filenames **[C]**.
  - `.gitignore:58-70` and `:75-83` exclude environment and key files **[C]**.
- **Placement:** Settings → Code security → enable Secret scanning and Push protection. Both are free for public repositories.
- **Acceptance checks:**
  - Readback reports enabled.
  - Pushing a GitHub-documented test token on a scratch branch is blocked.
  - Historical alerts are triaged with a named owner.
- **Caveat [A]:** Convex deploy and admin keys may not be a supported pattern. Clerk `sk_live_` support should be checked. Coverage gaps need either a custom pattern (plan and licence permitting) or a pinned scanner binary in CI. Treat that as CONDITIONAL until root checks pattern coverage.

### S9: Local credential and sensitive-data hygiene (ADD NOW, P1)

**Confirmed issues:**

- `data/import-staging/` is untracked and not gitignored (`git check-ignore` returned no match). It contains `company-candidates.json` (mode 0644), `top-gold-clerk-identity.json` (0600), large JSON plan files and a ZIP. A single `git add .` would publish them to a public repository. Push protection would not catch business data.
- The production scripts read an admin credential through the deploy key's variable name: `scripts/import-pd-production.mjs:1` ("private admin credential file") and `:29` (`process.env.CONVEX_DEPLOY_KEY`, "Missing admin key"). The same pattern appears in all four `*-production.mjs` scripts. They use it with `setAdminAuth` to impersonate a hard-coded Clerk subject and org (`:45-50`). Sharing one variable name for two credential classes invites pasting the admin key into Vercel or GitHub.
- `.env.convex-admin` sits in the repository root. It is ignored by `.gitignore:59` and has mode 0600.

**Good controls to keep:**

- Exact-URL assertion (`:27-28`), 0700 artifact directory (`:39-43`), `wx`/0600 writes (`:60`), and default read-only preflight mode.
- `dev-login.mjs:38-49,75-77` (loopback and `sk_test_` only), and `seed-local-test.mjs:12-26`.
- Backend-side guards in `convex/staging/hrDemo.ts:52-55` and `annexDemo.ts:214-226`.

**Smallest changes:**

1. Add `/data/import-staging/` to `.gitignore`.
2. Rename the scripts' variable to `CONVEX_ADMIN_KEY` with a startup refusal if it is missing.
3. Move the admin env file outside the repository and pass it with `--env-file`.

**Acceptance checks:** `git check-ignore data/import-staging/x` matches, and the scripts fail if only `CONVEX_DEPLOY_KEY` is set.

### S10: Dependency review on PRs (ADD NOW, P1)

- **Current state [C]:** absent.
- **Placement:** a `dependency-review` job in `quality.yml`, pinned by SHA:
  - `if: github.event_name == 'pull_request'`, `fail-on-severity: high`, no PR comment.
  - Commenting needs `pull-requests: write`, which fork PRs do not get.
  - It requires the dependency graph to be enabled.
- **Required aggregate edit:** a job skipped on `push` would turn `check` (`:70-73`) red on `main` and block every release. The check must require `success` on `pull_request` and accept `skipped` otherwise.
- **Acceptance checks:**
  - A PR that adds a known high-severity package version fails `check`.
  - A main push stays green.
  - Dependabot and fork PRs run it with a read-only token.
- **Caveat:** a GitHub API outage fails the job closed. That is acceptable.

### S11: CodeQL / SAST (ADD NOW non-blocking, then ADD NEXT required, P1)

- **Current state:** the plan reports default setup as not configured **[A]**. There is no workflow locally **[C]**.
- **Placement:** Code scanning → Default setup with the JavaScript/TypeScript and Actions languages. No workflow file is needed. It scans PRs, `main` and a weekly schedule, which covers idle periods.
- **Acceptance checks:**
  - The first `main` analysis completes.
  - A PR introducing `eval(req.query)` produces an alert.
  - Actions-language analysis covers the future release job.
- **Later:** after baselining, add a ruleset rule requiring code-scanning results at "High or higher". Do not add it to `check` at first.
- **Cost:** free for a public repository, and a few minutes per run.

### S12: D-29 exact pins plus security-only npm updates, with a scheduled audit (ADD NOW, P1/P2)

- **Current state [C]:**
  - Dependabot is limited to github-actions by D-29 (`dependabot.yml:5-6`).
  - `.npmrc:3-4` sets `save-exact`.
  - The audit is high/critical and production-only (`package.json:28`), runs only on PR and push (`quality.yml:23`), and depends on the advisory database at run time.
- **Inconsistency [C]:** `pnpm-workspace.yaml:4-5` uses caret overrides (`postcss>nanoid: ^3.3.18`, `next>sharp: ^0.35.5`), which contradicts D-29. The lockfile still resolves exact versions.
- **Changes:**
  1. Enable "Dependabot security updates" (setting).
  2. Add an npm entry with `directory: "/"` and `open-pull-requests-limit: 0`, which stops routine version PRs while still allowing security updates. Root should verify this against the GitHub docs.
  3. Add `.github/workflows/security-audit.yml` with `schedule` weekly plus `workflow_dispatch` and `contents: read`. It runs `pnpm audit --prod --audit-level high` as blocking and a full `pnpm audit` as report-only. It must never trigger a release.
  4. Pin the overrides exactly (ADD NEXT).
- **Caveats:**
  - Fixes in transitive packages may need manual `overrides` edits that Dependabot will not make **[A]**.
  - GitHub disables schedules in public repositories after 60 days of inactivity.
  - The audit-production-only scope excludes build-time devDependencies, which run inside the secret-holding Vercel build today (see S7).
- **Acceptance checks:**
  - A security alert opens an exact-pinned PR that requires CODEOWNER review.
  - No routine npm PRs appear.
  - The schedule run appears weekly in Actions.

### S13: pnpm lifecycle, release-age and trust policy (ADD NEXT, P2; one P1 verification)

- **Current state [C]:**
  - `esbuild@0.27.0` (`postinstall: node install.js`) and `unrs-resolver@1.12.2` (`postinstall`) have install scripts.
  - pnpm 10.33.2 skips dependency builds by default, and CI uses pnpm 10.33.2 from `packageManager` (`package.json:7`, `action.yml:12-15`).
  - The lockfile has no git or tarball sources (grep).
- **P1 verification [A]:** which pnpm Vercel's install uses. pnpm 9 runs dependency lifecycle scripts while the production secrets are in the environment. `engines.pnpm >=10` (`package.json:10`) with `engine-strict` (`.npmrc:7`) suggests pnpm 10, but the Vercel build log is the evidence.
- **Changes in `pnpm-workspace.yaml`:**
  - `strictDepBuilds: true` plus an explicit `ignoredBuiltDependencies: [esbuild, unrs-resolver]`, so a new dependency with a build script fails CI instead of warning.
  - `minimumReleaseAge` around 1440–4320 minutes, with a documented emergency exclusion. It affects resolution, not frozen installs **[A]**.
  - Optionally `trustPolicy: no-downgrade` and `blockExoticSubdeps`.
- Root should verify the setting names and minimum pnpm versions at https://pnpm.io/settings.
- **Acceptance checks:** a clean frozen install and build pass, and adding a test package with a postinstall script fails the install.

### S14: Cache poisoning, exfiltration and artifact retention (KEEP + CONDITIONAL rules, P1 when release or Playwright are added)

- **Current state [C]:**
  - `.next/cache` key includes the lockfile hash, `.nvmrc` and the SHA (`quality.yml:49-54`). The pnpm store goes through setup-node (`action.yml:24`).
  - No artifacts are uploaded.
  - PR-scope caches cannot be restored by `main`, and secret-free CI caches hold nothing sensitive.
- **Risk:** caches saved on `main` are readable by PR and fork runs **[A, GitHub cache scoping]**.
- **Rules for the release job:**
  - Do not save caches (use `actions/cache/restore` or no cache).
  - Never cache `.next/` from a production-configured build, because prerender or fetch caches may contain production data.
- **Rules for future reports:**
  - Unique shard names and `retention-days: 7`.
  - Never upload `.env*`, Playwright `storageState`, or traces that contain Clerk cookies. Artifacts in public repositories are downloadable by any signed-in user.
- **Acceptance checks:**
  - The release log shows no "Cache saved".
  - Fork-run cache listings contain no release keys.
  - Artifact manifests contain no `storageState`.

### S15: Practices that are overkill or not applicable here

| Practice                                | Classification           | Reason                                                                                                                                               |
| --------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| OIDC federation                         | NOT APPLICABLE           | Vercel CLI and Convex deploys need tokens or keys **[A, verify]**. Revisit if a provider adds GitHub OIDC trust.                                     |
| SBOM publishing / artifact attestations | NOT APPLICABLE           | No artifact is distributed. Vercel builds remotely. Dependency-graph SBOM export on demand is enough.                                                |
| Licence gate                            | CONDITIONAL              | The package is `UNLICENSED` with no LICENSE file in a public repository. Add `allow-licenses` in dependency review only if legal policy requires it. |
| Signed-commit requirement               | NOT APPLICABLE           | Squash merges are made by GitHub.                                                                                                                    |
| Self-hosted runners                     | NOT APPLICABLE, prohibit | Unsafe in a public repository.                                                                                                                       |
| zizmor/actionlint                       | ADD NEXT (pinned)        | Worth it once a secret-holding workflow exists, not before.                                                                                          |
| Harden-runner egress control            | CONDITIONAL              | Consider for the release job only.                                                                                                                   |

## Corrections and gaps in the existing plan

1. **Deploy-only key:** the plan relies on the "deploy-only" key for containment. Deploy permission is equivalent to arbitrary backend code execution. Isolating the key from the build (S7) is the real control.
2. **Missing sensitive-data issue:** the plan omits the unignored `data/import-staging/` business and identity files in a public repository, and the `CONVEX_DEPLOY_KEY` variable name being reused for an admin key (S9).
3. **Dependency review breaks main:** adding it to the aggregate needs event-aware handling. Otherwise `main` turns red and releases stop (S10).
4. **Ambiguous setting:** "Workflow PR approval disabled" mixes up two settings. The fork-run approval policy needs a separate readback (S5).
5. **Second reviewer exists:** a second contributor is evidenced locally, so independent review is plausibly available (S3).
6. **Direct push evidence:** `d8d7aa0` suggests a past direct push to `main` (S3).
7. **Dev-dependency risk is understated:** dev-tool vulnerabilities currently run with production secrets on Vercel (S7, S12). Vercel's pnpm version is unverified (S13).
8. **Overrides contradict D-29:** the caret overrides conflict with exact pins (S12).
9. **No Dependabot auto-merge:** under automatic production release, explicitly keep auto-merge off.
10. **Missing cache rule:** no cache saving in the release job (S14).

## Cross-domain dependencies for root

- **Vercel:**
  - Git Fork Protection is on.
  - The Preview `CONVEX_DEPLOY_KEY` targets a non-production deployment (`README.md:70` warns about stale Preview variables).
  - Production-only scoping of secrets.
  - The pnpm version in the build log.
  - Removing the Vercel production key after the GitHub cutover.
- **Convex:** deploy-key permission scope, admin-key inventory and rotation, and backend `ALLOW_LOCAL_TEST_SEED` being unset in production.
- **Clerk:** whether the production secret is needed at build time, and secret-scanning partner coverage for `sk_live_`.

## Suggested documentation for root to verify (not browsed)

- GitHub rulesets and required-check sources: docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets
- GitHub Actions security hardening and `workflow_run` risks: docs.github.com/actions/security-for-github-actions
- Actions SHA-pinning policy
- Dependabot security updates
- `actions/dependency-review-action`
- CodeQL default setup
- Cache access restrictions
- pnpm settings: https://pnpm.io/settings
- Vercel Git Fork Protection and package-manager detection

## Summary mapping

| ID  | Practice                                                 | Class                    | Pri   | Placement                                                         |
| --- | -------------------------------------------------------- | ------------------------ | ----- | ----------------------------------------------------------------- |
| S1  | Secret-free, least-privilege PR CI                       | KEEP                     | P0    | `quality.yml:7-8,17-19`                                           |
| S2  | SHA pins + enforcement/allowlist                         | KEEP + ADD NOW           | P1    | Actions settings; `dependabot.yml`                                |
| S3  | Main ruleset, required `check` (Actions source)          | ADD NOW                  | P0    | GitHub ruleset                                                    |
| S4  | CODEOWNERS on critical paths                             | ADD NOW                  | P1    | `.github/CODEOWNERS` + ruleset                                    |
| S5  | Fork-run approval; no auto-merge                         | ADD NOW                  | P1    | Actions settings                                                  |
| S6  | Release job env secrets, `needs: check`, main-only       | ADD NOW                  | P0    | `quality.yml` release job; `Production` env                       |
| S7  | Deploy key isolated from the build                       | ADD NEXT                 | P1    | Release job steps                                                 |
| S8  | Secret scanning + push protection                        | ADD NOW                  | P0    | Code security settings                                            |
| S9  | Ignore import-staging; separate admin key variable       | ADD NOW                  | P1    | `.gitignore`, `scripts/*-production.mjs`                          |
| S10 | Dependency review + event-aware aggregate                | ADD NOW                  | P1    | `quality.yml`                                                     |
| S11 | CodeQL JS/TS + Actions                                   | ADD NOW → required later | P1    | Default setup, then ruleset                                       |
| S12 | Security-only npm updates, weekly audit, exact overrides | ADD NOW / NEXT           | P1/P2 | `dependabot.yml`, new `security-audit.yml`, `pnpm-workspace.yaml` |
| S13 | pnpm build/release-age/trust policy; Vercel pnpm check   | ADD NEXT (+P1 verify)    | P2    | `pnpm-workspace.yaml`; Vercel log                                 |
| S14 | No release cache saves; artifact retention               | KEEP + CONDITIONAL       | P1    | Release and Playwright jobs                                       |
| S15 | OIDC, SBOM, attestations, signing, licence gate          | N/A / CONDITIONAL        | —     | —                                                                 |
