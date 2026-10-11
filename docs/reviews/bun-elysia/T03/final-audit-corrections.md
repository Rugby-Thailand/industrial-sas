# T03 final-audit corrections

Agent: Kiro, claude-opus-5.5, high effort, no delegation. Input: exact
`f92f437ac281519fff93d527ccb1241b5e3cd2dd`, clean tree (1,353 tracked files),
and the independent final reports `T03/final-audits/{standards,spec}.md`
with their probe sources and receipts. The corrections were uncommitted when this agent handoff was written and were then frozen by the coordinator as `66d143d6a00f971805e1bba303014d828e9ab7e6`.
This is not an approval. New independent non-author audits and exact-version
full gates are still required, and the coordinator owns them after source
freeze.

## Findings and corrections

| Finding                                                                                                                                                                                                                                                                                          | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** (S1/SPEC-F1): the installed-store reader skipped a materialized package's own `node_modules`. A nested `leaf@2`/`@9` with an unreviewed postinstall passed policy, and the graph reported `leaf@1`, while `createRequire(host).resolve` bound the nested copy. Reproduced in both scopes. | `installed-store.mjs` walks each materialized package tree **before** its manifest or ownership counts, and the walk is bounded at 2,000,000 entries per store. Nested layouts are refused, not modelled. The walk rejects a `node_modules` entry of any type or casing at any depth (directory, link, dangling link, file, scoped package, deeper subdirectory, `Node_Modules`), and any link inside a package, because real-path resolution would escape. It also rejects entries that are neither files nor directories. The only nested form it accepts is `<package>/node_modules` holding just a real `.bin` directory. That `.bin` then passes the existing `bins()` check: regular shims, or links into owned packages. `packageName` rejects a `node_modules` segment, so the scoped resolution root `@scope/node_modules` cannot be an alias. Container, shared, root, link, containment and context checks are unchanged. Unknown paths still fail closed. |
| **P2** (S2): `loadPnpmScope` and `loadBunScope` used `JSON.parse`, so a duplicate `trustedDependencies` silently replaced `["esbuild"]` with `[]`.                                                                                                                                               | Both loaders now share `readScopeManifest`. It is the bounded decoded unique-key `parseUniqueJson` (16 MiB, depth 128) plus a JSON-object root check. All downstream schema, root-pin and trust validation is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **P2** (S3): in `runBunAudit`, a synchronous `spawn` throw leaked the created HOME. An `rmSync` throw inside `close` escaped the callback and left the promise unsettled.                                                                                                                        | The spawn call is guarded. A synchronous refusal settles once with `spawnError: "synchronous spawn failure (<errno>)"` after the HOME is removed. Every removal goes through `removeHome()`, which never throws and returns a sanitized code: an `E…` code, or `unknown host error`. Paths and host messages are never echoed. The new result field `cleanupError` makes `rawAuditProblems` prepend `bun audit isolated HOME cleanup failed: <code>`, so a run whose removal failed is never certified clean. A failed HOME creation still owns nothing and rejects. Async ENOENT, raw-byte UTF-8 decoding, the 8 MiB per-stream cap and overflow latch, the 120 s SIGKILL deadline, the four-variable env and `--no-env-file` are unchanged. `hostFailure` sits inside `runBunAudit`, so the auditors' VM extraction harness can run the actual function.                                                                                                            |
| **26 TypeScript errors** (`final-gates-f92f437a-ci/check.raw.txt`): 11 adapter, 1 lifecycle, 14 graph.                                                                                                                                                                                           | Test-only. The `Child` fixture type now matches the real result: `outputExceeded` and `cleanupError` are required, and the factory defaults are `false`/`null`. Indexed tuples and findings are narrowed with explicit throws, through the `tuple()` helper and `[first]` destructuring. Inferred `never[]` JS shapes are re-typed as `Binding[]`/`string[]`. Contextual differences are read through a `Record<string, unknown>` view with an `Array.isArray` guard. The CLI env follows the repository's `NODE_ENV: "test"` convention. The deliberate malformed-metadata assignment `tuple(malformed, "a")[2] = []` is kept. There is no `any`, `ts-ignore`/`ts-nocheck`, removed test or new dependency, and no negative assertion was weakened.                                                                                                                                                                                                                  |

## Actual baseline inventory check (read-only, darwin-arm64)

`node /tmp/t03-corr/baseline-inventory.mjs <worktree> <worktree>/tools/release` calls `readInstalledStore(<dir>, "pnpm")` on the owned worktree installs. Its output is in `/tmp/t03-corr/final/baseline-inventory.raw.txt`
(sha256 `6519d004…e1a9`).

- Before the correction, both scopes stopped at `unknown root entry .modules.yaml`.
- **Release passes: 268 entries, 1 root.** That needs two recognitions, each
  with regressions: pnpm's bounded regular root files `.modules.yaml` and
  `.pnpm-workspace-state-v1.json` (pnpm only, never links or directories);
  and the 19 package-local `.bin`-only directories pnpm writes.
- **App fails closed, concretely:**
  `.pnpm/resolve@2.0.0-next.7/node_modules/resolve/test/shadowed_core/node_modules`.
  The published tarball ships two nested test layouts: this one holds
  `util`, and `test/resolver/symlinked/_/node_modules` holds `foo.js`. They
  are unsupported nested layouts and are deliberately not modelled. The app
  store also holds 84 `.bin`-only package directories.
- The app root also holds the test caches `.vite` and `.vite-temp`. They are
  **not** recognized, because no actual check reaches them (the store walk
  refuses first) and a regression proves they still fail as unknown root
  entries. No Bun install was run, so the same refusal in a Bun app store is
  expected from the identical tarball but unverified.

## Red/green and commands (direct exits; no pipeline status)

Raw files are under `/tmp/t03-corr/`. Node 24.19.0, pnpm 10.33.2, Vitest
4.1.11. Scoped Vitest is
`pnpm exec vitest run --project integration tests/integration/bun-{audit-adapter,resolved-graph,lifecycle-policy,installed-graph}.integration.test.ts`.

| Step                                                                                                             | Exit | Result                                                                                                                                                                                                             | Raw sha256      |
| ---------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| Baseline scoped Vitest at `f92f437a`                                                                             | 0    | 4 files, 146 passed                                                                                                                                                                                                | —               |
| Red `PATH=<.cache/bun-checker/…>:$PATH pnpm typecheck` at `f92f437a`                                             | 1    | 26 errors (11/1/14), as recorded                                                                                                                                                                                   | `3ea8aa0f…be23` |
| Red `pnpm typecheck:ts6` at `f92f437a`                                                                           | 2    | the same 26 errors                                                                                                                                                                                                 | `a63ecb06…65a5` |
| Red: new tests against the HEAD sources of the three corrected modules (restored afterwards; hashes re-verified) | 1    | 31 failed, 147 passed (178): every nested-layout case, the `.bin`/metadata cases, both lifecycle scopes, both loaders, both CLIs and three host-IO cases. The HOME-creation case passes on old source (invariant). | `9c147b0a…c49e` |
| Final scoped Vitest                                                                                              | 0    | 4 files, **178 passed** (adapter 59, graph 64, lifecycle 28, installed 27)                                                                                                                                         | `b28a89a8…7318` |
| Final `pnpm typecheck` (pinned Bun 1.4.3 / TS 7.0.2, `--verify`; no install/network)                             | 0    | No type errors in 776 files                                                                                                                                                                                        | `83c8c98f…35dc` |
| Final `pnpm typecheck:ts6`                                                                                       | 0    | 0 errors                                                                                                                                                                                                           | `d6ca806b…eee8` |
| `pnpm exec eslint --max-warnings=0` on the 8 scoped modules and 4 suites                                         | 0    | no output                                                                                                                                                                                                          | `e3b0c442…b855` |
| `pnpm exec prettier --check` on the same 12 files                                                                | 0    | all formatted                                                                                                                                                                                                      | `17aa973d…8f20` |
| Spec probe `spec-probes-f92f437a-canonical-temp.mjs`, unmodified                                                 | 1    | throws `…/host/node_modules: unsupported nested node_modules…`; the bypass no longer reproduces; its temp root was removed by its `finally`                                                                        | `b3b84437…95a4` |
| Standards probe copy (only `output` redirected to `/tmp/t03-corr/standards-copy`)                                | 1    | 15 invariant probes pass (UTF-8, cap/latch, deadline, async ENOENT cleanup, env keys and others); all 4 `OBSERVATION` counterexamples now fail to reproduce                                                        | `5121e176…e89d` |

The red run used a pre-move variant of `bun-audit.mjs` (`05e2d8fe…fec7`).
Moving `hostFailure` into `runBunAudit` changed no behavior, and the final
runs cover it. The probe rerun exits are expected: the probes assert the
defects.

## Refactor decision

One narrow refactor of the corrections was justified: the test helper
`pnpmRepo()` in `bun-resolved-graph` replaces two identical
three-line repository builders. No source refactor was made. The
`rawAuditProblems`/`childProblems` split keeps the existing body byte-identical
and the exported parameter fully destructured. `packageTree` stays separate
from `packagePaths`, because the two answer different questions: nearer
resolution roots versus alias inventory.

## Preserved

Final sha256 of the changed source and test files:

    874fe7c3e8788c4813be86d061987d034a894b8f657ddf480dd89b6680ca021c  scripts/ci/bun-audit.mjs
    9d6ad42bd4b7bdfc0d1ae58628c45b4750771463fc94859437fb7b37de27d859  scripts/ci/installed-store.mjs
    090212d1bc07d72bc7c823ca7a2542e7e3c30d3639b4bfb1003f626e42f0e616  scripts/ci/lockfile-graph.mjs
    8a6a4a5f5b3b83d8425f0e75fcfd8bfe19bb60bd58b259ebbf38a7352021e7ba  tests/integration/bun-audit-adapter.integration.test.ts
    e92057cfea70c48c407aceb8193b96475f0b467b98e75f41c84522d80f4ed8eb  tests/integration/bun-installed-graph.integration.test.ts
    746ec9ce738703009df7ad6be5b150eafdb98c2e3e1d8c0a5f81a85a44df0eb5  tests/integration/bun-lifecycle-policy.integration.test.ts
    26adf9aaa36cd29861835af5fcdfab8cd9407b7025a0b1aea5ad8fd0917d2d79  tests/integration/bun-resolved-graph.integration.test.ts

Byte-identical: `json-input`, `installed-graph`, `lifecycle-policy`,
`resolution-context` and `semver-range` (their hashes equal the standards
report), the review fixture `4bcb07ab…d8ac`, `source-manifest.json`
`560175e7…30a5`, both manifests and locks, `dependency-exceptions.json`,
workflows, the controller, defaults and ledgers. Only the seven files in
scope plus these two documents changed. There was no install, network,
lifecycle script, provider, browser, device, secret read, benchmark, commit
or push. Fixture code was never executed; `createRequire().resolve` only
locates files.

## Known barriers (unchanged; no adoption, performance, integration or release claim)

pnpm remains authoritative. The barriers are the braces chains (3 app and 37 release, more than the exceptions cover), missing selector provenance (7 app and 27 release edges), dropped platform/libc metadata, the actual optional-peer difference and the app's physical `debug → supports-color`. The new concrete app-inventory refusal is `resolve@2.0.0-next.7`. The historical macOS lifecycle and installed-graph results were produced by the pre-correction reader. They stay historical evidence and were not re-derived. Linux and the integrated T02 graph remain unvalidated.
