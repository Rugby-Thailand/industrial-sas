# CI workflow architecture audit — industrial-sas

> Coordinator verification (2026-10-09): the consolidated audit is the implementation authority. GitHub now supports `queue: max`; the default `queue: single` still replaces pending runs. Use unique non-PR quality-run groups and a separate production release lock. Actual cache usage is 38 entries / 5,795,168,195 bytes; churn is measurable, but cache eviction was not demonstrated. Convex codegen explicitly rejects preview deploy keys, rather than every deploy-key type; a secrets-free ephemeral local deployment remains an implementation option to rehearse. The recommended initial release uses Vercel remote builds, so the blanket prohibition on production cache reuse applies to shared GitHub caches, not Vercel's private build cache. The proposed structural module check cannot prove complete generated-code freshness.

## Scope and evidence

**What I checked:**

- Local HEAD is `0e9ea3a`. The locally fetched `origin/main` is `cc42063`. I ran `git diff 0e9ea3a origin/main` over the workflow, setup action, package and lockfile, Node/pnpm config, tsconfig, next config, Vercel files, ESLint/Prettier ignore files and `convex/_generated`. It was empty, so these findings apply to `cc42063`. I didn't fetch, so the live remote may be newer.
- I read the installed Next.js 16.3.8 guides: `06-cli/next.md` (typegen), `05-config/02-typescript.md`, `02-guides/ci-build-caching.md`, `turbopackFileSystemCache.md` and `upgrading/version-16.md`.
- I read the installed Convex 1.46.0 CLI source for `codegen` and deployment selection.
- **Commands run (read-only):**
  - `actionlint` 1.7.12 on `quality.yml`: no findings.
  - `prettier --list-different .`: 66 files fail on the dirty tree, 18 of which are tracked and unmodified, so they fail at HEAD too.
  - A module-set comparison between `convex/_generated/api.d.ts` and the files in `convex/`: 92 modules each, identical.
- **Not run:** typecheck, build, tests, `next typegen` and `convex codegen`.
- **Not verified:** any live GitHub, Vercel, Convex or Clerk setting.

## Findings

### CI-01 Single aggregate required check — KEEP (P1 interface)

- **Current state:** `quality.yml:59-73`. It runs with `if: always()`, needs `[validate, test, build]`, and requires `success` from each.
- **Why:** One stable required-check name (`check`). Failed, cancelled and skipped dependencies all turn it red.
- **Smallest change (ADD NEXT):** Replace the hand-written list with a generic test so a newly added job can't be left out:
  ```yaml
  env: { NEEDS: "${{ toJSON(needs) }}" }
  run: jq -e 'all(.[]; .result == "success")' <<<"$NEEDS"
  ```
- **Acceptance:** On a throwaway branch, add a job that runs `exit 1` and list it in `needs`; `check` must fail. Cancel a run; `check` must not be green.
- **Caveats:** A release job has to depend on `check`, not run alongside it. The ruleset should require `check` from the GitHub Actions app specifically.

### CI-02 Concurrency policy — ADD NOW (P1, correction)

- **Current state:** `quality.yml:9-11`. Main pushes share one group, `…-push-refs/heads/main`, with `cancel-in-progress: false`.
- **Why it matters:** Under GitHub concurrency, a group holds at most one running and one pending run. A newly queued run cancels any existing pending run, whatever `cancel-in-progress` says. So if three PRs merge quickly, the middle commit's main run is cancelled and never gets a `check`. That contradicts the plan's "PR cancellation leaves main runs intact". It also means a release job placed in this workflow inherits the serialisation.
- **Placement:** Workflow-level `concurrency` in `quality.yml`.
- **Smallest change:**
  ```yaml
  group: ${{ github.workflow }}-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || github.sha }}
  ```
  Put production serialisation only on the future release job, as job-level `concurrency: { group: production-release, cancel-in-progress: false }`.
- **Acceptance:** Push two main commits less than 30 s apart; both get a completed `check`. PR pushes still cancel the superseded run.
- **Caveats:** The per-SHA group gives up nothing; quality runs need no serialisation. Root should check the semantics: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency

### CI-03 Frozen install through one composite setup — KEEP (P3 refinement)

- **Current state:** `action.yml:14-28` uses `pnpm/action-setup`, which reads `packageManager: pnpm@10.33.2` (`package.json:7`), then `setup-node` with `cache: pnpm`, then `pnpm install --frozen-lockfile`.
  - Overrides in `pnpm-workspace.yaml:1-7` match the lockfile overrides.
  - The lockfile `settings.autoInstallPeers: true` matches `.npmrc`.
- **Gaps:**
  - `engines.pnpm` is `">=10.0.0"` (`package.json:10`), which still admits pnpm 11.
  - `.npmrc` comments call `resolution-mode=highest` and `prefer-workspace-packages` "Reproducibility". They have no effect on a frozen single-package install.
  - Two overrides are ranges: `^3.3.18` and `^0.35.5`. That contradicts the D-29 exact-pin policy.
- **Smallest change (ADD NEXT):** Set `engines.pnpm` to `"10.x"` and make both overrides exact. Before any future pnpm 11 upgrade, check whether pnpm 11 still reads these `.npmrc` settings (unverified).
- **Cross-domain (unverified):** Vercel picks its pnpm version from `lockfileVersion: '9.0'` and project settings unless Corepack is enabled. It may not be 10.33.2. The deployment audit should read back the pnpm version in the Vercel build log.
- **Acceptance:** CI log shows `pnpm 10.33.2`. Changing `package.json` without updating the lockfile fails the install with `ERR_PNPM_OUTDATED_LOCKFILE`.

### CI-04 Node pinned to the major version — KEEP (P3)

- **Current state:** `.nvmrc` is `24`, `engines.node` is `24.x`, and `engine-strict=true`. Local Node is `v24.19.0`.
- **Why the major-only pin is right:** Vercel only lets you choose a Node major. A patch pin in CI (for example `24.19.0`) would not reproduce Vercel's runtime, Dependabot doesn't update `.nvmrc`, and every patch would need a manual pull request. A full patch pin is CONDITIONAL, only for reproducing a patch-specific bug.
- **Caveats:** `setup-node` without `check-latest` uses whatever Node 24 build is in the runner image's tool cache, so the patch level drifts when GitHub updates the image. The setup log records the version.
- **Unverified assumption:** That a mismatch actually fails the install (`action.yml:17-19`) for the root project. Test it once with `.nvmrc` set to `22` on a throwaway branch; the install should fail.

### CI-05 Dependency and Next build caches — KEEP; restore-only on PRs is CONDITIONAL (P2)

- **Current state:**
  - The pnpm store is cached by `setup-node`, keyed on the lockfile.
  - `.next/cache` (`quality.yml:48-54`) uses key `os-arch-next-hash(lock,.nvmrc)-sha` with a partial-key `restore-keys` fallback.
  - Next 16.3 turns the Turbopack build filesystem cache on by default (`turbopackFileSystemCache.md`, "v16.3.0"), so restoring it does speed builds up.
- **Tradeoff:** A new entry is saved for every commit on every PR push. PR-scoped entries can't be reused by other PRs. GitHub's repository cache limit is 10 GB with least-recently-used eviction (root to verify), so large Turbopack caches can push out the shared pnpm-store entry from main. The partial-key fallback is safe: Next validates its cache, and the key includes the lockfile hash. Putting `.nvmrc` in the hash adds little, since its content `24` doesn't change when the Node patch changes.
- **Contradicts the plan's "no cache defect identified":** The churn is possible but unmeasured.
- **Prerequisite:** Root should run `gh cache list --sort size_in_bytes` (not run).
- **Change, only if total cache use is above about 5 GB or the pnpm store is being evicted:** On PRs use `actions/cache/restore`; on `push` to main use restore plus `actions/cache/save`.
- **Trust boundary:** Main can't read caches written by PRs. A future production `vercel build` in GitHub must not restore `.next/cache` at all.
- **Acceptance:** Build-step duration is compared before and after over at least 10 runs; the pnpm cache hits on PR runs.

### CI-06 Clean tree after build — ADD NOW (P1)

- **Current state:** `.gitignore:38-46` says the build job "runs `next build` and then asserts the tree is clean" and that `tests/integration/generated-artifacts.integration.test.ts` "holds that line". Neither is true:
  - `quality.yml:55` only runs `pnpm build`.
  - That test was deleted in `983fb5a` (2026-09-19).
- **Why:** `tsconfig.json:7-9` notes that Next rewrites tsconfig. Codegen and future typegen output could also drift without anyone noticing.
- **Placement:** `quality.yml`, a new step after `pnpm build` (and after typegen in `validate` once CI-07 lands):
  ```yaml
  - name: Require a clean tree
    run: |
      git status --porcelain --untracked-files=all
      test -z "$(git status --porcelain --untracked-files=all)"
  ```
  Alternatively, correct the stale comment. Restoring the check is preferred.
- **Acceptance:** On a throwaway branch, change `tsconfig.json` `jsx` to `preserve`; the build job fails and lists the file.
- **Caveats:** Only tracked and unignored files are checked; `.next/` and `next-env.d.ts` are ignored. No ongoing cost.

### CI-07 Generate Next route types before standalone `tsc` — ADD NEXT (P2, downgraded from plan P1)

- **Current state:** `typecheck` runs `tsc --noEmit` (`package.json:27`). `tsconfig.json` includes `.next/types/**`.
  - The Next docs recommend `next typegen && tsc --noEmit` for CI (`next.md:179-186`).
  - The app uses no `PageProps<…>`, `LayoutProps<…>` or `typedRoutes` (my grep of `src` found nothing).
  - CSS-module declarations arrive through `next.config.ts` importing `next`, whose `index.d.ts` references `types/global` (declares `*.module.css`).
  - `next build` type-checks the whole tsconfig project with route validators; `ignoreBuildErrors: false` at `next.config.ts:18-20`.
- **Why lower priority:** The build job already enforces route contracts. Typegen only moves that feedback earlier and removes local reliance on stale `.next*/types` folders (the include list in `tsconfig.json`).
- **Smallest change:** `"typecheck": "next typegen && tsc --noEmit"`.
- **Caveats:** typegen loads `next.config.ts` in the production build phase (`next.md:210`). The current config needs no environment variables, but run it in CI once to confirm (not run). It adds a few seconds.
- **Acceptance:** On a cold checkout `validate` passes. On a throwaway branch, give a page default export an invalid `params` prop type; `validate` fails, not only `build`.

### CI-08 Convex generated-contract freshness — ADD NOW (structural check) + CONDITIONAL (full codegen) (P1)

- **Current state:** `convex/_generated` is committed (`.gitignore:48-51`) and nothing in CI checks it is current.
- **Confirmed drift on main:**
  - `#42` (`03a157a`) bumped `convex` from 1.43.0 to 1.46.0.
  - `_generated` was last committed in `#36`.
  - The installed 1.46.0 template (`cli/codegen_templates/server.js`) emits a "Typesafe environment variables" `env` export.
  - That export is absent from both HEAD and `origin/main` `server.d.ts`; the count is 0. The dirty working tree contains it, mixed into the HR work.
- **Why the obvious fix doesn't work secret-free:** Convex 1.46's `codegen` resolves deployment credentials (`cli/codegen.js`) and refuses deploy keys. A naive `convex codegen` in a fork-safe PR job isn't available.
- **Smallest change, ADD NOW:**
  1. A separate PR that regenerates `_generated` with the pinned 1.46.0, isolated from the HR work.
  2. A test, `tests/integration/convex-generated-contract.integration.test.ts`, asserting that the set of modules imported by `api.d.ts` equals the function files in `convex/`. The same rule gave 92 = 92 today.
- **CONDITIONAL, ADD NEXT:** A job running `CONVEX_AGENT_MODE=anonymous pnpm exec convex codegen --typecheck disable` against a local backend, then `git diff --exit-code convex/_generated`. Assumption to verify: it runs without secrets on ubuntu-24.04. It downloads the backend binary over the network, so it's slower and flakier.
- **Also unchecked:** CI never bundles Convex functions with `convex/tsconfig.json`, whose `lib` is ES2023 against ES2022 at root and whose strict flags differ. A bundling failure would first appear in the production `convex deploy`. The deployment-domain `convex deploy --dry-run` preflight should cover this (interface).
- **Acceptance:** Adding `convex/foo.ts` without regenerating fails the test; once the full-codegen job exists, a CLI bump without regeneration fails `git diff`.

### CI-09 Formatting gate — ADD NOW, in its own baseline PR (P2)

- **Current state:** `format:check` exists (`package.json:26`) but CI never runs it. 18 tracked, unmodified files fail at HEAD:
  - 5 in `src/components`
  - 3 in `public/f1-f2-reference`
  - 2 each in `src/hooks`, `src/features`, `docs/plans` and `convex/model`
  - 1 each in `src/app` and `docs/guides`
- **Stale `.prettierignore` entries:** It references `pnpm manual:generate`/`manual:check`, `docs/manual-html/` and `PROJECT_PLAN.md`. None of those scripts or files exist.
- **Correction to the plan:** Don't reformat `public/f1-f2-reference/*.html`. They are reference pages served as-is in an iframe (`F1F2ReferencePreview.tsx:28`), and HTML reformatting can change how whitespace renders. Add them to `.prettierignore`.
- **Placement:** `validate` step `pnpm format:check`, and add it to the `check` script.
- **Acceptance:** `prettier --list-different .` prints nothing on main; a misformatted `.ts` file in a PR fails `validate`.
- **Caveats:** Do the baseline after, or rebased under, the dirty HR work to avoid conflicts. Stay on prettier 3.9.6.

### CI-10 Lint, type and build-error gates — KEEP; minor ADD NOW (P3)

- **Current state:** `eslint . --max-warnings=0`, ESLint ignores `convex/_generated/**`, `ignoreBuildErrors: false`, strict tsconfig. `validate` runs typecheck → lint → audit one after another (`quality.yml:21-23`), so a type error hides lint and audit results.
- **Smallest change:** Add `if: ${{ !cancelled() }}` to the lint and audit steps.
- **Cross-domain:** With automatic release, a newly published advisory or a registry outage during `pnpm audit` blocks every main release, hotfixes included. The security audit should decide whether audit stays in `check` or moves to its own required job with a documented exception process.
- **Acceptance:** A PR with both a type error and a lint error shows both failures in one run.

### CI-11 Workflow YAML validation — ADD NOW (P2)

- **Current state:** No CI validation. Local actionlint 1.7.12 reports nothing on `quality.yml`, so turning it on won't break CI.
- **Placement:** First step of `validate`, or a tiny `workflow-lint` job added to `check`'s `needs`.
- **Smallest change:** Download a pinned release, check its SHA-256, and run `actionlint -color`. Root to supply the checksum: https://github.com/rhysd/actionlint/releases
- **Acceptance:** A `${{ matrix.shardd }}` typo on a throwaway branch fails the job. Takes about 5 s.
- **Caveats:** It doesn't validate `dependabot.yml`; GitHub reports that file's errors itself. Workflow security linting (zizmor) belongs to the security domain.

### CI-12 Triggers: forks, drafts, merge queue — KEEP `pull_request`; `merge_group` CONDITIONAL (P3)

- **Current state:** `pull_request` (all bases, default types), `push: main` and `workflow_dispatch`. There's no `pull_request_target`, so fork code runs with a read-only token and no secrets.
- **Merge queue:** For this repo's volume (#41–#46 over a few days), a ruleset with "require branches up to date" is enough, so a merge queue is likely overkill. If you adopt one, add `merge_group:` to `on:` _before_ enabling it; otherwise the required check never reports and the queue stalls.
- **Interface:** An auto-release triggered by `workflow_run` must filter `branches: [main]` and `event == push`, check `head_sha`, and never trust runs from forks. `needs: check` within the push run is simpler.
- **Acceptance:** A fork PR runs every job with no secrets (log shows `secrets: none`/empty).

### CI-13 Timeouts, retries, cancellation — KEEP (P3)

- **Current state:** Timeouts are 10/10/15/2 minutes. Recent main runs took about 98 s end to end, per the plan's GitHub data, which I didn't re-check. `fail-fast: false` on the shards. No automatic test retries (`vitest.config.mts` has no `retry`), so flaky tests aren't hidden.
- **Recommendation:** Don't add step or job retries. Network steps (pnpm install, audit, Google Fonts at build via `src/app/[locale]/layout.tsx:2`) fail visibly. Self-hosting the fonts is a separate ADD NEXT that removes a network dependency from both CI and Vercel builds.
- **Acceptance:** Recorded flake rate stays at 0 without retries; a job that hangs is killed at its timeout and `check` fails.

### CI-14 Docs-only skips — KEEP in Vercel; never in CI (P2 interface)

- **Current state:**
  - `vercel.json` sets `ignoreCommand`.
  - `scripts/vercel-ignore-build.mjs:4-40` compares against `VERCEL_GIT_PREVIOUS_SHA`, ignores renames, builds when history is missing or invalid, builds same-commit redeploys, and builds when `FORCE_VERCEL_BUILD=1`.
  - `tests/integration/vercel-ignore-build.integration.test.ts:46-96` covers all of these.
  - CI has no path filters, so required checks can't deadlock.
- **Caveats:**
  - `CLAUDE.md` isn't in the skip list. That's harmless; it just builds.
  - **Cross-domain:** After the cutover, the ignore command governs only Git-triggered (preview) deployments. Root should verify whether it applies to CLI deploys. The release workflow needs its own explicit rule for docs- or `.github`-only main commits: either always release (idempotent) or reuse the same diff logic against the _last released_ SHA, not `HEAD^`.
- **Acceptance:** The existing test passes. On a docs-only main commit, the release job either skips with a logged reason or deploys an identical build, never mixing the two.

### CI-15 Artifact provenance — NOT APPLICABLE for CI build outputs; record SHA ↔ deployment (P3)

- **Current state:** CI's `next build` output is a gate, not a shipped artifact. Vercel builds production separately with production `NEXT_PUBLIC_*` values. SLSA build attestations for CI output would certify something that's never deployed; that would be overkill.
- **Placement (deployment domain):** The release manifest records commit SHA, workflow run ID, Vercel deployment ID and Convex deployment, and the release asserts that Vercel's commit SHA equals `github.sha`.
- **Test reports (ADD NEXT):** JUnit output uploaded per shard with short retention.
- **Acceptance:** For any production deployment ID, the run and SHA can be looked up and match.

### CI-16 Toolchain and lockfile updates — KEEP (P3)

- **Current state:** Dependabot updates github-actions only, for the root and the composite action (`dependabot.yml:9-19`). All action references are pinned by SHA. npm dependencies are updated by hand under D-29.
- **Recommendation:** Keep this. Don't add Renovate or automatic npm version PRs; security-only updates belong to the security domain. Write down a monthly review covering Node 24, pnpm 10 and the Convex CLI. The Convex CLI matters because CI-08 shows a CLI bump changes generated output.
- **Acceptance:** Every CLI bump PR includes regenerated `_generated`, enforced by CI-08.

## Missing cross-domain dependencies

1. The release job must not inherit the workflow-level concurrency (CI-02). It needs `needs: check` plus a job-level production group.
2. Vercel's actual Node and pnpm versions are unverified (CI-03, CI-04).
3. Convex bundling and codegen need either a secret-free local backend or a credentialed preflight on main only (CI-08).
4. Making audit a blocking gate on auto-release is a policy decision (CI-10).
5. Docs-only behaviour for the GitHub release path is undefined (CI-14).
6. Caches written in CI must never feed production builds (CI-05).

## Corrections to the prior plan

- "PR cancellation leaves main runs intact" is wrong: pending main runs get replaced (CI-02).
- "No cache defect" is unproven: per-SHA churn is unmeasured (CI-05).
- The standalone-typecheck gap is P2, not P1, because the build already enforces route types (CI-07).
- The plan leaves out the stale Convex generated code, the clean-tree check the repo claims exists, and the reference HTML that must not be reformatted (CI-06, CI-08, CI-09).
- actionlint can be added now rather than waiting for step 5.

## Summary

| ID    | Practice                                     | Class                 | Priority |
| ----- | -------------------------------------------- | --------------------- | -------- |
| CI-01 | Aggregate `check` (generic `needs` test)     | KEEP / ADD NEXT       | P1       |
| CI-02 | Per-SHA main concurrency; release-only group | ADD NOW               | P1       |
| CI-03 | Frozen install, composite setup, exact pnpm  | KEEP (+tighten)       | P3       |
| CI-04 | Node major pin `24`                          | KEEP                  | P3       |
| CI-05 | pnpm and `.next` caches; PR restore-only     | KEEP / CONDITIONAL    | P2       |
| CI-06 | Clean-tree check after build                 | ADD NOW               | P1       |
| CI-07 | `next typegen && tsc`                        | ADD NEXT              | P2       |
| CI-08 | Convex generated-code freshness              | ADD NOW / CONDITIONAL | P1       |
| CI-09 | Formatting gate after baseline               | ADD NOW               | P2       |
| CI-10 | Lint and type gates; `!cancelled()`          | KEEP / ADD NOW        | P3       |
| CI-11 | actionlint                                   | ADD NOW               | P2       |
| CI-12 | `pull_request`; `merge_group`                | KEEP / CONDITIONAL    | P3       |
| CI-13 | Timeouts, no retries                         | KEEP                  | P3       |
| CI-14 | Vercel docs-only skip; no CI path filters    | KEEP                  | P2       |
| CI-15 | Build attestations                           | NOT APPLICABLE        | P3       |
| CI-16 | Actions-only Dependabot; manual npm (D-29)   | KEEP                  | P3       |
