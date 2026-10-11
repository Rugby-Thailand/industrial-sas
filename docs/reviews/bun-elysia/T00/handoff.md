# T00 handoff — baseline and pilot preservation

Task: T00 of the [Bun and Elysia delivery plan](../../../plans/bun-elysia-delivery-plan-2026-10-11.md) (Phase 1). Documentation/inventory only.

- Implementer: Kiro CLI, `claude-opus-5.5`. The model inventory lists it; the coordinator explicitly launched `--effort high` (see implementation-prompt.txt and the recorded invocation); no alternate model was used.
- Worktree/branch: `industrial-sas-bun-elysia-t00-20261011` on `codex/bun-elysia-t00-20261011`.
- Recorded base: `ca8c296b2364fcbca33df81a5b18f9e1a213ac16`.
- Recorded: 2026-10-11, 10:35–11:30 Asia/Bangkok.
- Nothing was committed, pushed, opened as a PR, merged or deployed. No remote setting was written and no external recipient was contacted. No inspected workspace was modified.

## Outcome

- The baseline is recorded in four manifests:
  - [baseline-manifest.json](baseline-manifest.json): SHAs, environment, installs, GitHub state, release safeguards, provider endpoints and copied-evidence hashes.
  - [command-manifest.json](command-manifest.json): every package script, child-process path and workflow step.
  - [test-manifest.json](test-manifest.json): all 256 tracked test files with their runner/project owner.
  - [workspace-inventory.json](workspace-inventory.json): dirty files, ownership and divergence.
- The research, plans, reviews and pilot evidence are copied into the delivery scope. All 20 copies matched their sources by sha256 before the portability edits listed below.
- Clean installs passed for both independently locked directories. Test discovery passed with 245 Vitest files and 11 Playwright spec files at `ca8c296`; after the fast-forward, [integration-checks.json](integration-checks.json) records 248 Vitest files / 2,965 cases and 11 Playwright spec files at `9675ae7`.
- Both plan ledgers are updated:
  - Phase 1: the delivery plan's ledger.
  - Phase 2: a new ledger in the [performance plan](../../../plans/performance-next-steps-2026-10-11.md).
- In the Phase 2 plan, only the Elysia deferral is superseded. Phase 2 now requires a new merged and released baseline that includes Bun/Elysia and HR/Search. Evidence from `9ac5da0` stays historical.
- Bun and Elysia are not merged or released anywhere. No Bun/Elysia PR exists.

## Files in scope

| Path                                                     | Change                                                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/plans/bun-elysia-delivery-plan-2026-10-11.md`      | Status; phase order; portable workspace table; start-document locations; current ledger (original initial table kept)                                        |
| `docs/plans/bun-migration-research-2026-10-11.md`        | Pointer to delivery plan/T00; two links to the unmerged `performance-improvement-2026-10-10.md` redirected to the Phase 2 plan with an explicit note         |
| `docs/plans/performance-next-steps-2026-10-11.md`        | Phase 2 status/new-baseline rule; Elysia-only supersession; portable evidence references; Phase 2 ledger                                                     |
| `docs/reviews/bun-typecheck-pilot-2026-10-11.md`         | Worktree name instead of absolute path; note that pilot code is uncommitted until T01 and about `<checker-worktree>`                                         |
| `docs/reviews/ai-search-clerk-performance-2026-10-11.md` | Delivery-status note (pilot code uncommitted until T02)                                                                                                      |
| `docs/reviews/independent-report.md`                     | Worktree name instead of absolute path; evidence-location note; Prettier table formatting                                                                    |
| `docs/reviews/bun-migration-kiro-review-2026-10-11.md`   | Copied unchanged                                                                                                                                             |
| `docs/reviews/assets/ai-search-clerk-2026-10-11/`        | Copied unchanged (1 file)                                                                                                                                    |
| `docs/reviews/assets/bun-migration-2026-10-11/`          | Copied unchanged (3 files)                                                                                                                                   |
| `docs/reviews/assets/bun-typecheck-pilot-2026-10-11/`    | 9 files copied; `benchmarks.json` (27) and `error-rejection.json` (3) absolute prefixes replaced with `<checker-worktree>`                                   |
| `docs/reviews/bun-elysia/T00/`                           | `implementation-prompt.txt` (pre-existing input), this handoff and four manifests; `external-prerequisites.md` is a concurrent Codex file (see Verification) |

Files added to `docs/reviews/bun-elysia/T00/` later in the cycle: `codex-audit.md`, `normal-root-install.json` and `integration-checks.json` (Codex); `refactor-prompt.txt` and `models-before-refactor.json` (coordinator); `refactor-handoff.md` (Kiro refactor).

The copied review texts and asset values are otherwise unchanged. The sha256 values of the sources are in `baseline-manifest.json` → `copiedEvidence`.

Links into `../../node_modules/next/dist/docs/...` in the research plan stay as they are. They resolve after `pnpm install`, and that is how AGENTS.md expects the installed guides to be read. On GitHub they do not resolve.

## Commands and results

| Command (T00 worktree unless stated)                                                     | Exit | Result                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `shasum -a 256` of 20 copies vs sources                                                  | 0    | All identical before edits                                                                                                               |
| `git ls-remote origin refs/heads/main`                                                   | 0    | `9675ae7`; main moved 3 commits past the base during T00 (PR #69, 18 app files, 3 new test files; no docs/lock/workflow/release changes) |
| `pnpm install --frozen-lockfile --ignore-scripts`                                        | 0    | 7.48 s; 880 packages, 880 reused from the warm store, 0 downloaded                                                                       |
| `pnpm -C tools/release install --frozen-lockfile --ignore-scripts`                       | 0    | 1.46 s; 268 packages, all reused; Vercel CLI 63.1.0                                                                                      |
| `pnpm ignored-builds`                                                                    | 1    | “Cannot identify as no node_modules found”: `--ignore-scripts` does not fill this record. `.modules.yaml` `pendingBuilds` used instead   |
| Probe: `pnpm install --frozen-lockfile` on a temporary copy of the release manifests     | 0    | pnpm's default blocked `esbuild@0.27.0` with an “Ignored build scripts” warning; temporary copy deleted                                  |
| `shasum -a 256 -c` of six manifests/locks; `git status` diff                             | 0    | Unchanged after both installs                                                                                                            |
| `pnpm ci:test-discovery`                                                                 | 0    | 7.04 s; “Test discovery OK: 245 Vitest files, 11 Playwright spec files.”                                                                 |
| `pnpm exec vitest list --json`                                                           | 0    | 19.99 s; 2,958 collected cases (listing, not execution)                                                                                  |
| `pnpm exec playwright test --config <each of 4> --list --reporter=json`                  | 0    | smoke 5 files/92, workspace 4/44, staging 2/13, production 1/7 listed tests                                                              |
| `kiro-cli-chat chat --list-models --format json-pretty`                                  | 0    | `claude-opus-5.5` present                                                                                                                |
| `gh api …/branches/main/protection`                                                      | 1    | 404 “Branch not protected”; protection comes from a ruleset                                                                              |
| `gh api …/rulesets/24799747`, `…/rules/branches/main`, environments, actions permissions | 0    | See GitHub state                                                                                                                         |
| `gh pr list`, `gh run list/view`, `gh api …/deployments`                                 | 0    | See release outcomes                                                                                                                     |
| In the T00 worktree: `git apply --check` with the checker patch and per-file AI patches  | 0/1  | Checker patch applies; 6 of 10 AI diffs apply (details below)                                                                            |
| Prettier on the declared files only; `git diff --check`; scope and secret scans          | 0    | See Verification                                                                                                                         |

Not run, as allowed for a documentation-only task: `pnpm check`, `pnpm build`, `pnpm audit:prod`, `pnpm ci:codegen`, any test execution, and any Bun command. Bun is not on PATH.

## Clean-install baseline

The dependency directories were clean: neither `node_modules` nor `tools/release/node_modules` existed before installation. The pnpm store was not clean. `~/Library/pnpm/store/v11` is 7.4 GB, already populated by other worktrees, and both installs downloaded nothing. The timings therefore measure linking from a warm store. They are not cold or network install times. T04 must measure clean and cached Bun/pnpm installs under equivalent cache states.

Lifecycle behavior:

- Root:
  - Five packages in the graph carry install scripts: `@parcel/watcher@2.6.0`, `@swc/core@1.15.47`, `esbuild@0.27.0`, `msgpackr-extract@3.0.4` and `unrs-resolver@1.12.2`.
  - These are exactly the reviewed `ignoredBuiltDependencies`, with `strictDepBuilds: true`. pnpm lists them as `pendingBuilds`.
  - With `--ignore-scripts`, none ran.
- Release:
  - Only `esbuild@0.27.0` has a script.
  - `tools/release/pnpm-workspace.yaml` has no ignore list and no `strictDepBuilds`. The CI-equivalent install therefore blocks esbuild by pnpm 10's default with a warning, and does not fail.
  - A new script-bearing release dependency would also only warn. T03 should treat this asymmetry as part of lifecycle parity rather than assume the release list is empty by policy.
- `--ignore-scripts` also disables project scripts. Neither `package.json` defines install/prepare hooks.

## Inventories (summary; details in manifests)

Package scripts:

- Root has 27 scripts, with `pnpm@10.33.2` and engines Node `24.x` / pnpm `10.x`.
- `tools/release` has no scripts and pins only `vercel` 63.1.0.
- `check`, `build` and `test` collide with Bun built-ins. Use `bun --check`, `bun run build` and `bun run test`.

Locks and policy:

- Two lockfiles (`lockfileVersion` 9.0), with 11 root and 9 release overrides.
- Both `.npmrc` files set `save-exact`, `engine-strict` and the peer options.
- Lock hashes are in `baseline-manifest.json`.

Runtime and child-process paths: 19 entries in `command-manifest.json`. The ones that matter for Bun:

- `dev.mjs`: Next and Convex shims.
- `check-test-discovery`, `audit-dependencies`, `audit-summary`, `seed-local-test`, and `release/run.mjs` (Playwright): hard-coded `pnpm`.
- `check-convex-codegen`: `pnpm exec node --env-file`.
- `release/run.mjs`: the `tools/release` Vercel `/bin/sh` wrapper, which runs `node`.
- `GATED_BUILD_COMMAND`: `node … && pnpm exec convex deploy --cmd '… && pnpm build'`.
- Four `*-production.mjs` operator scripts: they need Node `--env-file` in `execArgv` (candidate exception).
- Two e2e helpers that spawn `pnpm`.
- Seven integration tests that run `process.execPath` or create `#!${process.execPath}` shims.
- Thirteen tracked Node-shebang scripts.

Seven Vitest projects at `ca8c296` (files/collected cases; per-project figures at `9675ae7` are in [integration-checks.json](integration-checks.json)):

| Project        | Environment           | Files | Cases |
| -------------- | --------------------- | ----: | ----: |
| unit           | jsdom + setup + React |    98 |   869 |
| unit-node      | node                  |    57 |   610 |
| a11y           | jsdom + setup + React |     5 |    20 |
| property       | node                  |     2 |     4 |
| convex-runtime | edge-runtime          |     1 |     3 |
| integration    | node                  |    74 | 1,223 |
| isolation      | node                  |     8 |   229 |
| **Total**      |                       |   245 | 2,958 |

Test ownership:

- 256 tracked test files, each owned by exactly one runner.
- No duplicated Vitest collection and no unowned file.
- `tests/e2e/production/release-smoke.spec.ts` is listed by both the staging and production Playwright configs. It counts once as a Playwright file, as `check-test-discovery` expects.
- 189 test files have no CODEOWNERS entry. CODEOWNERS covers security, CI, release, e2e, properties and isolation tests.
- Vitest API usage that migration must preserve:
  - `vi.hoisted` 52, `vi.mock(` 195, `vi.stubEnv` 46, `vi.stubGlobal` 36, `vi.mocked` 8, `vi.useFakeTimers` 30;
  - `import.meta.glob` 9 occurrences across the listed files.

Required CI checks (ruleset 24799747, active on the default branch, no bypass actors, strict):

- Required contexts: `check`, `Analyze (javascript-typescript)`, `Analyze (actions)` and `CodeQL`.
- Pull request rules: 0 required approvals, thread resolution required, merge/squash/rebase allowed.
- Deletion and non-fast-forward are blocked.
- `check` aggregates `validate`, `codegen`, three test shards, two browser suites and `dependency-review`. Dependency review is PR-only and skipped on push.

Release safeguards (see `baseline-manifest.json` → `releaseSafeguards`):

- Quality → staging → production run on `main` only.
- Staging and production have separate locks; the production lock is shared with the daily backup.
- Exact-SHA and main-head checks, plus cutover `vercel.json` validation.
- Production is refused without a fresh native Convex snapshot that includes storage.
- `assert-deploy-env` runs before and inside `convex deploy`.
- Candidate smoke, promotion of the same deployment ID, then live smoke.
- SHA-pinned actions are enforced by the repository.
- Trusted jobs install without cache.

Provider endpoints:

- Inbound:
  - Convex `POST /webhooks/clerk`, verified by the Svix signature through `@clerk/backend/webhooks`;
  - Next `/api/uploadthing`;
  - Next `/api/observability/speed-insights`, a same-origin relay;
  - the Clerk Proxy matcher, including `/__clerk`.
- Outbound:
  - OpenRouter chat completions (three Convex modules) and the generation lookup;
  - Vercel REST, GitHub REST (main ref), the Convex production deployment (backup/operator) and Clerk Backend calls from guarded development login; operator Clerk issuer literals only configure Convex admin identity;
  - release target hosts, opt-in Sentry and UploadThing.
- The Elysia `/api/ai` route exists only in the local pilot. LINE, Sent.dm and Composio have no code or configuration.

Only secret and variable names were recorded (`VERCEL_TOKEN`, `CONVEX_DEPLOY_KEY`, `CLERK_SECRET_KEY`, `CONVEX_BACKUP_ADMIN_KEY`, `RELEASE_ACKNOWLEDGED_DEPLOYMENTS`). No values were read.

## GitHub state and release outcomes (read-only)

- Open PRs: #48 (setup-node 7.1.0) and #49 (security: vitest 4.1.11). No Bun/Elysia PR exists.
  - #49 changes the Vitest version this baseline used, so later runner tasks must rebase onto the result.
  - #48 changes the setup-action pin that T04 edits.
- `9675ae7` (PR #69): Planner quality run 38108938145 succeeded. Staging passed. Production was `RELEASED` at 03:45:58Z. Candidate and live smoke each had 6 passed, 0 failed and 1 optional check skipped as not configured. CodeQL succeeded.
- `ca8c296` (PR #68, the T00 base): run 38107420036 succeeded and was released to production.
- `1deda8f` (PR #67, HR/Search): its staging outcome was `SUPERSEDED` because main advanced, so production was skipped. HR/Search reached production through `ca8c296` and then `9675ae7`.
- Environments `staging` and `production-release` allow only `main`. Actions policy: selected actions only, with SHA pinning required. Allowed patterns are GitHub-owned actions, `pnpm/action-setup@*` and `github/codeql-action/*@*`. `oven-sh/setup-bun` is not allowed yet (T04).

## Workspaces (no modifications)

Primary workspace `industrial-sas`:

- Local `main` is at `733c6ac`, with two unpushed local commits (`8b0ef53` HR/Search/UI, `733c6ac` navigation variant). It is 2 commits ahead of / 37 behind `9675ae7`, and its tree differs from main in 537 files. Never deliver this branch wholesale.
- 26 dirty paths, all owned by the AI pilot or its docs:
  - 10 modified tracked files;
  - 8 untracked code/test/benchmark files;
  - 8 untracked docs, copied into T00.
- 5 stashes.

Checker worktree `industrial-sas-bun-typecheck-pilot`:

- At `8b0ef53` on `codex/bun-typecheck-pilot-20261011`, 1 ahead / 37 behind main. Its only commit is the same unpushed local HR/Search commit, so it must not be delivered.
- Dirty tracked files: `package.json` (`typecheck:bun`) and two fixture tests (`activeMoveId`). The patch's sha256 is `a032b81f…8b51b47`; it applies cleanly to `ca8c296`, and those three paths are unchanged through `9675ae7`.
- Untracked: `scripts/benchmark-typecheck.mjs` (sha256 `0c988ea3…1f28eb`) plus the pilot review and assets copied into T00.

Other relevant worktrees are listed in `workspace-inventory.json`:

- HR, AI-usage and navigation delivery worktrees are clean and already in main.
- Two detached `9ac5da0` performance worktrees hold the copied reports. `performance-methodology-2026-10-11.md` is not copied; it is outside scope.
- Older `performance-20261011-0600` and `ai-usage` branches are not in main and are not T00 inputs.

## T01 reconciliation plan (do not run in T00)

1. In the checker worktree, write `git diff` to a preserved bundle outside the worktree. Verify sha256 `a032b81f34df890f3c3f5a471b14e3e7119f77af01416bd936853dd3b8051b47`. Copy `scripts/benchmark-typecheck.mjs` there too and record its hash. Do not stash.
2. Fetch and record the new `origin/main` SHA (after T00 merges). In a scratch clean worktree at that SHA, run `git apply --check` on the bundle. If it fails, stop and re-port by hand; do not resolve conflicts in place.
3. Move the untracked duplicates of T00-delivered docs and assets out of the checker worktree into the bundle. Main will track them, and the T00 asset copies differ intentionally because of the portability edits. Leave `scripts/benchmark-typecheck.mjs` in place, because main does not track it.
4. Only after steps 1–3 are verified, restore the three tracked files, then run `git switch -c <T01 branch> origin/main` in the checker worktree. Re-apply the verified bundle with `git apply --check` first. Confirm the intended added script and three fixture corrections against the preserved patch, and preserve its original hash as provenance. Record a new hash for the resulting diff: the package file has a different base blob, so Git index hashes make byte-identical patch hashes inappropriate. Keep `codex/bun-typecheck-pilot-20261011` and `8b0ef53` as they are; do not delete or rebase them.
5. Reinstall dependencies on the new base and regenerate route types. Re-run both-checker comparisons, input manifests and deliberate-error cases on the new tree. `9675ae7` adds three test files (248 expected Vitest files); refresh rather than reuse the 729-file / 245-file figures.

## AI pilot transfer (T02, explicit scoped patch)

- Start from a clean worktree at the latest merged main, after T01. Never copy the dirty primary tree or its local commits.
- Apply only the reviewed per-file diffs. Six apply cleanly today: `.env.example` (variable name only), `README.md`, `convex/hr/navigationIntent.ts`, `GlobalSearch.test.tsx`, `SearchDialogFocus.test.tsx` and `useAiSearch.ts`. Copy the eight untracked AI files.
- Re-port four:
  - `package.json`: add the four exact pins `@elysiajs/eden` 1.4.9, `@sinclair/typebox` 0.34.52, `elysia` 1.4.30 and `exact-mirror` 0.2.7.
  - `pnpm-lock.yaml`: regenerate it with the repository's installer and review the graph delta. Do not patch it.
  - `c-sidebar-2.test.tsx` and `SearchDialogLoader.test.tsx`: these exist only in local `8b0ef53` and have no target on main. Port their relevant scenarios to the current owning tests where the behavior remains. Do not restore obsolete files or silently lose relevant coverage; document cases whose target behavior was intentionally removed on main.
- Then meet T02's acceptance list. Use the pilot's 120-test result only as history.

## Acceptance check

| T00 criterion                       | Status                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Fresh base SHA                      | Met: `ca8c296`; main drift to `9675ae7` recorded with its file scope                                                        |
| Complete command/test manifests     | Met for base `ca8c296`; must be refreshed per task base                                                                     |
| Pilot ownership                     | Met: every dirty path in both workspaces classified                                                                         |
| Existing PRs                        | Met: two open Dependabot PRs; no Bun/Elysia PR                                                                              |
| Clean-install baseline              | Met for both installs, with the warm-store limit; cold-store timing not measured                                            |
| Task ledger                         | Met: delivery-plan ledger plus Phase 2 ledger                                                                               |
| Link each source report             | Met in repo. The unmerged `performance-improvement-2026-10-10.md` and out-of-scope methodology review are named, not linked |
| Local pilot not mistaken for merged | Met: ledgers and reviews state local/uncommitted status                                                                     |

Gaps:

- Tests were listed, not executed.
- No Bun command was run.
- Coverage/JUnit baselines were not generated.
- Main moved during the task.
- The `release-smoke.spec.ts` dual-config listing should be kept in mind for T10's “exactly one owner” rule.

## Verification of this delivery

Recorded at the Kiro implementation handoff. Later checks are in [codex-audit.md](codex-audit.md), [integration-checks.json](integration-checks.json) and [refactor-handoff.md](refactor-handoff.md).

- Prettier: `pnpm exec prettier --write` ran only on eight files changed or created by Kiro: the delivery and performance plans, `independent-report.md`, this handoff and the four manifests. Afterwards, `pnpm exec prettier --check` passed on all 20 declared Markdown/JSON files except `external-prerequisites.md` (see below). Plain-text assets are not handled by Prettier.
- Links: every relative Markdown link in the eight Markdown files resolves locally. The `node_modules` guide links resolve only because dependencies are now installed.
- Portability: the declared docs, assets and manifests contain no `/Users/`, `/private/var` or `/private/tmp` paths.
- Secret scan: a regex scan for JWT, OpenAI/Clerk/GitHub/AWS/Slack/Svix-style keys, private-key headers, Convex deploy keys, Clerk user/org/session IDs and email addresses found no matches. Trailing-whitespace scan: none.
- Scope: `git status --porcelain=v1 -uall` shows 27 untracked paths, all inside the allowed set, and no tracked modification (`git diff --stat` is empty).

### Concurrent file not authored by Kiro

`docs/reviews/bun-elysia/T00/external-prerequisites.md` appeared at 11:25 during this session. It is headed “Independent Codex read-only audit” and records configuration-name findings. One of them is a production Convex name `ALLOW_LOCAL_TEST_SEED` that the runbook says must be absent; it is flagged for reviewed reconciliation.

Kiro did not create, verify, edit or format it. At handoff it failed `prettier --check`; the Codex standards audit has since formatted it ([codex-audit.md](codex-audit.md)). Its findings are not repeated in the manifests because Kiro did not reproduce them.

## Rollback

This is a documentation revert only. Before commit, delete the untracked declared files. After merge, revert the T00 commit. The source copies remain in their original worktrees. The installed `node_modules` directories are ignored and can be removed with `rm -rf node_modules tools/release/node_modules` in this worktree only.

## Next dependencies

- Remaining T00 steps: FINAL_VERIFY and PR. CODEX_AUDIT_FIX ([codex-audit.md](codex-audit.md)) and KIRO_REFACTOR ([refactor-handoff.md](refactor-handoff.md)) are complete.
  - Codex refreshes `origin/main`, which was `9675ae7` at recording.
  - Commit only the declared paths.
  - The PR runs the required `check` and CodeQL contexts.
  - Merging releases automatically. Record the merge and release SHAs in the ledger.
- T01 depends on T00 being merged and released, and follows the reconciliation plan above.
- T02 depends on T01. T03 depends on T01.
- Phase 2 waits for Phase 1 closure and a new released reference.

## Codex supplemental verification

Normal root `pnpm install --frozen-lockfile` passed in a separate clean temporary dependency directory, using the warm store. Package, lock, workspace policy and npmrc remained byte-identical. This single observation is a policy/compatibility probe, not a Bun migration timing comparison. Raw command/output is in [normal-root-install.json](normal-root-install.json). The delivery branch was subsequently fast-forwarded to `9675ae7b77c7e2a1369e4ef5c520531e14b8d823`; original manifests remain explicitly pinned to `ca8c296`. Final integration checks are recorded separately.

The standards audit added the Python asset-generator Node/Playwright and pnpm/Convex children to the runtime inventory and corrected Clerk outbound attribution. No provider calls were made for these checks.
