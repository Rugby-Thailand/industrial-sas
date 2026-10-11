# T01 handoff: promote the pinned Bun checker to the default typecheck

Task: T01 of the [Bun and Elysia delivery plan](../../../plans/bun-elysia-delivery-plan-2026-10-11.md), Phase 1. State: **IMPLEMENTED_LOCAL**. Codex audit, Kiro refactor, final verification, PR and release are still pending.

- Implementer: Kiro CLI, `claude-opus-5.5`, launched by the coordinator with `--effort high` ([implementation-prompt.txt](implementation-prompt.txt), [models-before-implementation.json](models-before-implementation.json)). No other model was used.
- Worktree and branch: `industrial-sas-bun-typecheck-pilot` on `codex/bun-checker-t01-20261011`.
- Base: `77ae110b7f346af747ed4094dba8854801133d08`. This is exactly `origin/main` and the T00 merge commit, and `git rev-parse HEAD origin/main` matched when recorded.
- Recorded: 2026-10-11, 12:00–12:50 Asia/Bangkok.
- Nothing was committed, pushed, opened as a PR, merged or deployed. No remote setting or environment was written. No provider or paid call was made and no recipient was contacted. No secret or `.env*` file was read; none exists in this worktree. No other worktree was touched.

## Outcome

- `pnpm typecheck` runs in three steps:
  1. It first checks that the `bun` on `PATH` is exactly 1.4.3 with embedded TypeScript 7.0.2.
  2. It runs `next typegen`.
  3. It runs `bun --check --no-pretty`.

  No script calls bare `bun check`. The collision probe shows that, in a package with a `check` script, bare `bun check` runs that script and exits 0 even when there is a type error.

- `pnpm typecheck:ts6` (`next typegen && tsc --noEmit`) is the TypeScript 6.0.3 comparison and fallback. `typescript@6.0.3` stays installed for the editor, typescript-eslint and the `next build` checker. `ignoreBuildErrors: false` is unchanged.
- `.bun-version` pins `1.4.3`.
- `scripts/ci/install-bun-checker.mjs` downloads the official `bun-v1.4.3` release zip, checks its SHA-256 against the pinned digest before extracting, extracts only `bun` into the ignored `.cache/bun-checker/`, and refuses any other Bun or embedded TypeScript version. It does not pipe to a shell, run an installer script or use a third-party action. On GitHub Actions it appends the directory to `GITHUB_PATH`.
  - Pinned digests: `linux-x64` `3e730528…6e18` and `darwin-arm64` `80afd4c0…3403`.
  - The digests match the GitHub release-asset metadata ([bun-release-artifact-metadata.json](bun-release-artifact-metadata.json)) and the release's `SHASUMS256.txt`, which I downloaded during implementation; its own digest `861ce0f1…a637` also matches the metadata.
  - Other platforms fail with an explicit "no pinned build" error. They do not fall back to another version.
- In `quality.yml`, the `validate` job gets an "Install pinned Bun checker" step before "Typecheck (cold next typegen + Bun checker)". All other jobs, the aggregate `check`, release jobs, Node 24/pnpm 10.33.2 setup, installs and the production build are unchanged.
- Workflow policy now requires the installer command in `validate` and requires it to run before `pnpm typecheck`. The contract test shows that removing it, moving it after typecheck, or swapping in `oven-sh/setup-bun` each fails validation.
- The harness was rewritten and its evidence written to [benchmark/](benchmark/). Historical pilot assets under `docs/reviews/assets/bun-typecheck-pilot-2026-10-11/` and all T00 evidence are unchanged.

## Changed files

| Path                                                                             | Change                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.bun-version`                                                                   | New: `1.4.3`                                                                                                                                                                                                                                                                                                                                                                                  |
| `scripts/ci/install-bun-checker.mjs`                                             | New: checksum-verified installer and `--verify` version guard; exports pure helpers                                                                                                                                                                                                                                                                                                           |
| `package.json`                                                                   | `typecheck` uses the Bun checker; `typecheck:bun` renamed to `typecheck:ts6`, which keeps the previous TS6 command; no dependency change                                                                                                                                                                                                                                                      |
| `.github/workflows/quality.yml`                                                  | Install step plus a renamed typecheck step in `validate`                                                                                                                                                                                                                                                                                                                                      |
| `scripts/ci/workflow-lib.mjs`                                                    | **Outside the explicit file list, needed for validator parity.** `VALIDATE_COMMANDS`, the mandatory-command list used by `validate-workflows.mjs`, lives here, not in `validate-workflows.mjs`. Adds `BUN_CHECKER_INSTALL` plus an ordering rule (12 lines). Without it CI could silently lose the pinned install. I made this edit before noting it here, so I am flagging it for audit now. |
| `tests/integration/ci-workflows.integration.test.ts`                             | One contract test: install missing, misordered, or replaced by a third-party action                                                                                                                                                                                                                                                                                                           |
| `tests/integration/bun-checker.integration.test.ts`                              | New, 12 tests: pins/assets, refusal of unpinned versions, exact-version verify with a fake `bun` (shadowed PATH, wrong compiler, missing), script contract (no bare `bun check`, TS6 retained, aggregate `check` and `build` unchanged), and harness helpers (manifest parsing, diagnostics, order alternation, medians, path portability, scope validation)                                  |
| `scripts/benchmark-typecheck.mjs`                                                | Rewritten serial harness (see Measurements). It replaces the untracked pilot script, whose sha256 `0c988ea3…1f28eb` is the one recorded in T00. An exact copy is kept as [benchmark/pilot-benchmark-typecheck.mjs.txt](benchmark/pilot-benchmark-typecheck.mjs.txt) (same sha256)                                                                                                             |
| `src/features/finishedGoods/catalogueFilters.test.ts`, `unitNextAction.test.ts`  | The three reconciled `activeMoveId` fixture corrections, unchanged from the preserved patch                                                                                                                                                                                                                                                                                                   |
| `README.md`                                                                      | Typecheck/Bun setup paragraph; CI paragraph                                                                                                                                                                                                                                                                                                                                                   |
| `docs/plans/bun-elysia-delivery-plan-2026-10-11.md`                              | Status line; ledger: T00 DONE (PR #70, `77ae110`, run 38112960884, staging/production outcomes), T01 IMPLEMENTED_LOCAL with exact base and preservation; `IMPLEMENTED_LOCAL` added to the state list                                                                                                                                                                                          |
| `docs/plans/performance-next-steps-2026-10-11.md`                                | Phase 2 ledger note: T00 DONE, T01 IMPLEMENTED_LOCAL                                                                                                                                                                                                                                                                                                                                          |
| `docs/reviews/bun-elysia/T01/benchmark/**`, `verification-logs/**`, this handoff | New evidence                                                                                                                                                                                                                                                                                                                                                                                  |

The coordinator-supplied files in this directory are unchanged: `implementation-prompt.txt`, `reconciliation.json`, `models-before-implementation.json`, `bun-release-artifact-metadata.json` and `T00-release/**`. `pnpm-lock.yaml` and the `.github/actions/` composite action are unchanged. I chose the script installer over a new composite action because it is a single file the validator and tests can audit.

## Commands and results

All runs are local on macOS arm64 (Apple M1 Max, 10 logical CPUs, 32 GiB) with Node v24.19.0 and pnpm 10.33.2. Bun came from `.cache/bun-checker/bun-v1.4.3-bun-darwin-aarch64` on `PATH` unless stated otherwise. Logs are in [verification-logs/](verification-logs/) with paths replaced by `<repo>`, `<tmp>` and `<home>`. Gates ran one at a time, after timing.

| Command                                                                                                                                                                        | Exit      | Result                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` (no `node_modules` before)                                                                                                                    | 0         | 7.1 s; 880 packages, all reused from the warm store, none downloaded. Lock unchanged                                                                                                                                                                                                                                |
| `node scripts/ci/install-bun-checker.mjs` (fresh, then cached)                                                                                                                 | 0 / 0     | Archive verified; extracted `bun` sha256 `28c7dd0a…3f79`, identical to the pilot's npm `@oven/bun-darwin-aarch64@1.4.3` binary                                                                                                                                                                                      |
| `install-bun-checker.mjs --verify` without Bun on PATH / with it / `--bogus`                                                                                                   | 1 / 0 / 2 | Fails closed, accepts the pin, rejects unknown arguments                                                                                                                                                                                                                                                            |
| `pnpm typecheck`                                                                                                                                                               | 0         | `✓ No type errors in 763 files` (a first run caught a real TS2769 in my new test, which I fixed)                                                                                                                                                                                                                    |
| `pnpm typecheck:ts6`                                                                                                                                                           | 0         | Pass                                                                                                                                                                                                                                                                                                                |
| `vitest run` on the two corrected fixture files                                                                                                                                | 0         | 2 files / **25 tests** passed                                                                                                                                                                                                                                                                                       |
| `pnpm check`                                                                                                                                                                   | 1         | Only `format:check` failed, on 10 coordinator-supplied raw JSON files: `T00-release/**` and `bun-release-artifact-metadata.json` ([prettier-list-different.log](verification-logs/prettier-list-different.txt)). I did not reformat supplied evidence. Every file I authored passes Prettier. See unresolved item 1 |
| `pnpm typecheck && pnpm lint && pnpm test` (remaining `check` stages in order)                                                                                                 | 0         | Bun check 763 files; ESLint 0 warnings; **249 files / 2,978 tests** passed                                                                                                                                                                                                                                          |
| `pnpm build` (`env -i`, Bun **not** on PATH, no credentials)                                                                                                                   | 0         | Next 16.3.8 Turbopack; "Running TypeScript … Finished" with the project-local TS6 `tsc`                                                                                                                                                                                                                             |
| Same build with a deliberate `src/__t01_build_gate_guard.ts` error (removed by a shell trap)                                                                                   | 1         | `error TS2322` / "Failed to type check": the independent TS6 build gate is enforced. Rebuilt clean afterwards (exit 0)                                                                                                                                                                                              |
| `pnpm audit:prod`                                                                                                                                                              | 0         | No known vulnerabilities                                                                                                                                                                                                                                                                                            |
| `node scripts/ci/audit-dependencies.mjs --scope=app` / `--scope=release`                                                                                                       | 0 / 0     | Passed, exceptions checked against expiry. The release tools came from `pnpm -C tools/release install --frozen-lockfile` (exit 0; esbuild blocked by pnpm default, as T00 recorded)                                                                                                                                 |
| `node scripts/ci/validate-workflows.mjs --verify-pins`                                                                                                                         | 0         | All pins resolve; actionlint 1.7.12 no problems; policy OK (5 workflows, 1 composite action)                                                                                                                                                                                                                        |
| `pnpm ci:codegen` (`env -i`, no `CONVEX_*` variables)                                                                                                                          | 0         | `convex/_generated` matches the pinned CLI output                                                                                                                                                                                                                                                                   |
| `pnpm ci:test-discovery`                                                                                                                                                       | 1         | Only failure: `bun-checker.integration.test.ts: collected but not tracked by git`, which is expected before commit                                                                                                                                                                                                  |
| Same, with a throwaway `GIT_INDEX_FILE` copy and `git add -N` of the new test                                                                                                  | 0         | 249 Vitest files, 11 Playwright spec files. The real index is unchanged                                                                                                                                                                                                                                             |
| `vitest run` on the 8 release/CI contract files (browser-release-safety, ci-workflows, generated-artifacts, release-api/-entrypoint/-env-contract/-orchestration, bun-checker) | 0         | 8 files / 182 tests                                                                                                                                                                                                                                                                                                 |
| `git diff --check`; tree status after all generators and builds                                                                                                                | 0         | Only the intended paths are modified or untracked. Generated `.next`, `tsconfig.tsbuildinfo` and `.cache/` are ignored                                                                                                                                                                                              |

Not run:

- **Linux CI.** Nothing was pushed. GitHub-hosted `ubuntu-24.04` proof of the pinned checker is still required: the `validate` job's install and typecheck steps on the PR.
- **Local Linux container.** Docker Desktop's daemon was not running and I did not start one.
- **Browser/e2e suites.** T01 changes no runtime or UI.

## Measurements

**Provisional implementation evidence:** these timings do not approve the final candidate. The original harness lacked full content freeze and explicit completion proof; a corrected, refactored candidate must be reproduced independently. These come from [benchmark/benchmarks.json](benchmark/benchmarks.json), produced by `node scripts/benchmark-typecheck.mjs --samples=10` and recorded 2026-10-11T05:29:38Z. Commit and `origin/main` were `77ae110`; the working tree is listed in [environment.json](benchmark/environment.json).

Method:

- 10 serial samples per profile, 90 processes.
- Profile order runs forward on odd iterations and reversed on even ones.
- Only one process ran at a time, and this task started nothing else during the run.
- Other workstation activity was uncontrolled. The 1-minute load average ranged from 2.71 to 4.81 and is recorded per sample.
- Route types were generated first.
- The filesystem was warm, and no `.env*` files were present.
- Every sample exited 0.

| Checker-only (Bun 1.4.3 / TS 6.0.3)                       | Median s |     Min–max s |
| --------------------------------------------------------- | -------: | ------------: |
| TS6 full (`--incremental false`)                          |   14.443 | 14.379–14.645 |
| TS6 cached (primed build info, no change)                 |    2.878 |   2.840–2.912 |
| TS6 edited (primed build info, one existing file changed) |    5.880 |   5.833–5.935 |
| Bun `--check`                                             |    0.843 |   0.826–0.890 |
| Bun `--check`, same edit                                  |    0.869 |   0.824–0.940 |

| Whole command (includes pnpm startup and `next typegen`) | Median s |     Min–max s |
| -------------------------------------------------------- | -------: | ------------: |
| `pnpm exec next typegen` alone                           |    1.216 |   1.003–1.240 |
| `pnpm typecheck:ts6 --incremental false`                 |   15.569 | 15.370–15.640 |
| `pnpm typecheck:ts6` (primed default build info)         |    4.054 |   3.849–4.596 |
| `pnpm typecheck` (pin verification + typegen + Bun)      |    1.995 |   1.912–2.088 |

Median ratios, TS6 over Bun:

| Comparison                | Ratio |
| ------------------------- | ----: |
| Checker-only, full        | 17.1× |
| Checker-only, cached      |  3.4× |
| Checker-only, edited file |  6.8× |
| Whole command, full       |  7.8× |
| Whole command, cached     |  2.0× |

Bun never writes or reads build info, so every Bun run is a full-project check.

Limits: these are wall-clock times on one local workstation. They are not CI, `next build`, application runtime or provider latency measurements, and they do not imply any application speedup.

A first 10-sample run (05:19Z) finished all timings with similar medians. It then correctly failed its final working-tree assertion because I had edited README and the plans while it ran ([harness-run1-failed-tree-check.log](verification-logs/harness-run1-failed-tree-check.txt)). Its data is preserved at the sibling `../industrial-sas-delivery-preserved-20261011/T01/failed-first-comparison/` directory and is not accepted. After the provisional implementation run, `prettier --write` reformatted the harness JSON. The values are unchanged.

Correctness evidence from the same run:

- [Manifests](benchmark/manifest-comparison.json): TS6 `--listFilesOnly` and Bun `check -p <repo>/tsconfig.json --listFilesOnly`, run from a neutral temp package, select **identical 775 project inputs**.
  - By location: src 472, tests 124, convex 138, `.next/types` 4, scripts 25, plus root configs, types and messages.
  - Dependency files and standard-library declarations are excluded; Bun bundles TypeScript 7's libraries.
  - Scope validation found no problems. Every tracked or untracked `.ts`/`.tsx`/`.mts` file outside the tsconfig excludes is present. No ignored, non-generated input appears. Generated inputs are only `.next/types/*` and `next-env.d.ts`.
  - The count is higher than the pilot's 729 because the base moved and T01 adds files.
- [Deliberate errors](benchmark/error-rejection.json): one `TS2322` guard each in `src/`, `tests/`, `convex/` and `.next/types/`.
  - Both checkers rejected all four, with identical locations, codes and messages.
  - Both whole commands also rejected them. The generated-type guard survived `next typegen` and was reported.
  - Guards are removed in `finally`, and their absence is asserted.
- [Edited file](benchmark/edited-file.json): an error appended to `src/features/finishedGoods/unitNextAction.ts` was rejected by Bun and by incremental TS6. After the file was restored, both passed with no stale diagnostic, and the file's sha256 was asserted unchanged.
- [Collision probe](benchmark/collision-probe.json): in a temporary project, bare `bun check` exited 0 and ran `echo AGGREGATE_CHECK_SCRIPT_RAN`. `bun --check` exited 1 with `TS2322`.
- [Pins and provenance](benchmark/environment.json): versions, archive and binary sha256, script text, cache conditions, harness sha256 `f24a2dfc…63d8`, and the pilot script hash and copy.

## Rollback

Before commit, revert the tracked edits and delete the untracked T01 files. Do not delete the coordinator inputs in this directory.

After merge, revert the T01 commit. If only the checker needs to roll back, restore these and keep the fixture corrections:

- `package.json` `typecheck` to `next typegen && tsc --noEmit`
- the old `validate` step
- `VALIDATE_COMMANDS`

The ignored `.cache/bun-checker/` can be removed locally at any time. The pilot's ignored `.cache/checker-tools/`, `.cache/typecheck-benchmark.tsbuildinfo` and `.cache/T01-pre-reconciliation-node_modules/` were left untouched.

## Unresolved items

1. **`pnpm check` fails at `format:check` on coordinator-supplied raw JSON** (10 files listed above). If they are committed as they are, CI's Formatting step fails too. Choose one: Prettier-format them (bytes change; record the original hashes first), add a reviewed `.prettierignore` entry (outside this task's file list), or keep them out of the commit.
2. **Linux CI proof is pending.** The required `check` → `validate` run on the PR must show "Install pinned Bun checker" printing the `bun-linux-x64.zip` digest, and `pnpm typecheck` passing on `ubuntu-24.04`. The Linux digest is pinned from release metadata but has not yet been exercised by an extraction on Linux.
3. **Test discovery needs the new test tracked.** `pnpm ci:test-discovery` passes once `tests/integration/bun-checker.integration.test.ts` is committed, as the temporary-index run shows.
4. **`scripts/ci/workflow-lib.mjs`** was edited outside the explicit file list for the reason given in Changed files. The audit should accept the edit or move the rule.
5. **Developer setup.** `pnpm typecheck`, and therefore `pnpm check`, now fails until the pinned Bun is first on `PATH`. The README documents this. The installer pins only `linux-x64` and `darwin-arm64`; other contributor platforms need reviewed digests added.
6. **Bun executable on Linux.** This is the glibc `bun-linux-x64` build; `ubuntu-24.04` is glibc. The plan scheduled `oven-sh/setup-bun` allowlisting for T04, and T01 deliberately does not need it.
7. **Later work stays pending, no current questions.** Bun installs, runtime, tests and release changes belong to T03–T07. LINE, Sent, Composio and Sentry configuration remain pending for their own tasks.
