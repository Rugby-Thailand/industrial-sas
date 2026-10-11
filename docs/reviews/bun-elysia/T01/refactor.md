# T01 Kiro refactor (claude-opus-5.5, high)

Scope: the five scoped T01 scripts/tests plus this report. No README, plan, `package.json`, lock, workflow YAML or existing evidence was edited. Nothing was committed, pushed, deployed or fetched from the network.

## Changes and reasons

1. `scripts/ci/install-bun-checker.mjs`
   - Added a shared `cachedArchivePath()` export and a `CACHE_DIR` constant. Before, the installer and the benchmark each built `.cache/bun-checker/<asset>-v<version>.zip` separately. The benchmark's cached-archive digest assertion now reads the exact path the installer writes. The path itself is unchanged (`bun-darwin-aarch64-v1.4.3.zip` still resolves and still matches the pinned digest).
   - Reworded the `--verify` header comment so the two checks stay separate. `install` verifies the archive's integrity against the pinned SHA-256 before extraction. `--verify` checks only the versions reported by the first `bun` the shell would select on PATH. It does not rehash that binary. No behavior changed.
2. `scripts/benchmark-typecheck.mjs`: uses `cachedArchivePath(root)` in place of the duplicated path construction. Nothing else changed, including the assertions, freeze fingerprints, guard enforcement, cleanup, serial order and completion gating. Because the harness file changed, its SHA-256 no longer matches `f24a2dfc…` in `benchmark/environment.json`. The coordinator's planned fresh comparison replaces that historical run anyway.
3. `scripts/ci/workflow-lib.mjs`: the install-before-typecheck order check now names both indices and runs only when both commands are present. The old check compared `indexOf` with `-1`. When `pnpm typecheck` was removed, that produced a false "must run before" message alongside the correct "must run pnpm typecheck" one. A missing install or typecheck is still rejected, and a reversed order is still rejected.
4. `tests/integration/ci-workflows.integration.test.ts`: added a regression assertion that removing the typecheck step reports the missing command and no false order message. Temporarily reverting change 3 made this test fail, and restoring it made the test pass.
5. `tests/integration/bun-checker.integration.test.ts`: the three installer subprocess call sites now share one `runInstaller(args, { cwd, path })` helper. It always uses the installer's absolute path, so the empty-PATH/cwd case no longer needs its own spawn block. Assertions are unchanged. The `--version=1.4.4` case now runs with the same minimal environment (`NODE_ENV`, `PATH`). That does not affect it, because argument rejection happens before PATH is read. Added assertions for the `cachedArchivePath` and `installedBinDir` layout.

Everything else was reviewed and left alone: pins and digests, platform refusal, `.bun-version` validation, executable PATH lookup, neutral-directory probing, staging extraction from in-memory verified bytes, CI `GITHUB_PATH` handling, every benchmark freeze, scope and generated-guard check, and the release validators. None of these had a refactor that would improve readability without risk.

## Commands (serial, local, offline)

| Command                                                                                                                                           | Result                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `pnpm exec prettier --write` / `--check` on the five scoped files                                                                                 | unchanged / all formatted                            |
| `pnpm exec eslint --max-warnings=0` on the five scoped files                                                                                      | exit 0                                               |
| `pnpm exec vitest run --project integration tests/integration/bun-checker.integration.test.ts tests/integration/ci-workflows.integration.test.ts` | 2 files, 59 tests passed                             |
| Same order test with change 3 temporarily reverted                                                                                                | 1 failed (expected), then restored                   |
| `pnpm typecheck` with the installed pinned Bun first on PATH                                                                                      | exit 0; Bun 1.4.3 / TS 7.0.2; no errors in 763 files |
| `pnpm typecheck:ts6`                                                                                                                              | exit 0                                               |
| `node scripts/ci/validate-workflows.mjs --skip-actionlint` (no `--verify-pins`: network)                                                          | Workflow policy OK: 5 workflows, 1 composite action  |
| `node scripts/ci/install-bun-checker.mjs --verify` without Bun on PATH                                                                            | exit 1, "bun 1.4.3 is not on PATH"                   |
| Read-only check: `cachedArchivePath()` exists and its SHA-256 equals the pinned digest                                                            | true                                                 |

Not run, as instructed: timings/benchmark, full build, full `pnpm check`, `--verify-pins`, actionlint, and the installer download path.

## Resulting file SHA-256

| File                                                 | SHA-256                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `scripts/ci/install-bun-checker.mjs`                 | `e835fe161384de64bab92b328ca7db5526c09645a5384554724e4db3810517e8` |
| `scripts/benchmark-typecheck.mjs`                    | `415fd6f36cef2c9a9c6c7e060abf6ceb45202afc51692258c12089497bafcbd3` |
| `tests/integration/bun-checker.integration.test.ts`  | `73ac8a33b44ad2018756efb2f660f152b9450c5edf2c4efe12a3991b35c4f1ac` |
| `scripts/ci/workflow-lib.mjs`                        | `7a25ce4fd2e3bdcac14243938d33a46171195e59122911045469087989bcfc74` |
| `tests/integration/ci-workflows.integration.test.ts` | `cfaf0c9b68edc4af250791c5731e8a49bdb9d1dc9b7d3ecfc2fc2d28028f1ab2` |

## Unresolved

No new concrete defects. Still open, for the coordinator: the fresh serial comparison on the committed candidate (the harness hash changed), the exact-candidate full gates, `--verify-pins`/actionlint, and Linux CI proof of the installer download path.
