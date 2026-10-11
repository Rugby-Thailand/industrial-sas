# Bun type-checker pilot — October 11, 2026

The isolated checker pilot passes. Bun 1.4.3 reduced checker-only median time
from 13.77 seconds for a full TypeScript 6 check to 0.87 seconds. The complete
`pnpm typecheck:bun` command, including Next.js route generation, took 1.54
seconds versus 17.44 seconds for full TypeScript 6 and 5.11 seconds for cached
TypeScript 6. This is approximately 11.4× faster than the full command and
3.3× faster than the cached command, saving 15.90 and 3.58 seconds respectively.

## Isolation and changes

- Worktree: `industrial-sas-bun-typecheck-pilot` (sibling of the primary checkout).
- Branch: `codex/bun-typecheck-pilot-20261011`.
- Base: `8b0ef53`, the main workspace's committed HEAD at creation. Uncommitted
  AI-search and other changes in the main workspace were not copied into this
  experiment.
- Dependencies installed separately with `pnpm install --frozen-lockfile`.
  Project dependency versions and lockfiles are unchanged.
- Bun 1.4.3 and native TypeScript 7.0.2 installed separately under ignored
  `.cache/checker-tools`, with installation scripts disabled. No global tools
  were installed or upgraded.
- Added the optional `typecheck:bun` script: `next typegen && bun --check --no-pretty`.
  The default `typecheck`, aggregate `check`, CI and production build remain
  on their existing configuration. TypeScript 6.0.3 remains installed for the
  editor and compiler API consumers.
- Corrected three test fixtures in `catalogueFilters.test.ts` and
  `unitNextAction.test.ts`: moving pallets now carry an `activeMoveId` alongside
  their move status, matching the backend's returned contract. No assertions,
  compiler strictness settings or production behavior were relaxed.

## Compatibility evidence

The unmodified committed tree passed TypeScript 6, but both TypeScript 7 and
Bun reported three errors in the fixtures above. Their diagnostic text was
identical after removing Bun's complete summary. Original results and
diagnostics are under [the evidence directory](assets/bun-typecheck-pilot-2026-10-11).

All three checkers select the same **729 project files**, including tests,
Convex code and generated Next.js types. The project-only manifests exclude
dependency files and standard-library declarations: Bun bundles TypeScript 7's
libraries, while TypeScript 6 uses its installed libraries.

For Bun's input listing, the benchmark uses `bun check -p <project> --listFilesOnly`
from the isolated tools directory. `bun --check --listFilesOnly` did not print
the listing during this experiment. This also avoids the repository's existing
aggregate `check` script being selected by a bare `bun check`.

Each checker rejected deliberate `TS2322` errors inserted into application,
test, Convex and generated Next.js type files. Those temporary files were
removed before timing. Every measured check passed after the fixture fixes.
This validates this tree and these error cases; it is not a claim that every
possible diagnostic is identical between TypeScript 6 and TypeScript 7.

## Timings

Three sequential samples per profile, with rotated order. Node 24.19.0,
TypeScript 6.0.3, native TypeScript 7.0.2, Bun 1.4.3 with embedded TypeScript
7.0.2, on this macOS arm64 workstation. Filesystem caches were warm. Cached
TypeScript checks were primed and had no source changes; edited-file latency
was not measured. No tests or other benchmark processes were started by this
experiment during timing. Other workstation background activity was uncontrolled.

| Checker-only profile      | Samples (seconds)        |  Median | Result |
| ------------------------- | ------------------------ | ------: | ------ |
| TypeScript 6, full        | 13.766 / 19.012 / 13.577 | 13.766s | Pass   |
| TypeScript 6, cached      | 3.398 / 2.538 / 2.645    |  2.645s | Pass   |
| Native TypeScript 7, full | 2.242 / 2.545 / 3.081    |  2.545s | Pass   |
| Bun checker               | 0.869 / 0.637 / 0.994    |  0.869s | Pass   |

| Complete pnpm command, including `next typegen`     | Samples (seconds)        |  Median | Result |
| --------------------------------------------------- | ------------------------ | ------: | ------ |
| `pnpm typecheck --incremental false --pretty false` | 15.477 / 17.440 / 18.816 | 17.440s | Pass   |
| `pnpm typecheck --pretty false`, primed cache       | 3.636 / 6.336 / 5.111    |  5.111s | Pass   |
| `pnpm typecheck:bun`                                | 1.389 / 2.198 / 1.536    |  1.536s | Pass   |

Raw commands, timings, output and exit codes are in
[benchmarks.json](assets/bun-typecheck-pilot-2026-10-11/benchmarks.json).
File manifests and deliberate-error results are alongside it. Sample variation
is substantial, so these are local measurements rather than a CI prediction.
No full Next.js build, CI run or application runtime benchmark was performed.

## Reproduce

For this macOS arm64 workstation, from the checker worktree. The
`typecheck:bun` script, fixture fixes and `scripts/benchmark-typecheck.mjs`
are uncommitted pilot changes in that worktree; they reach `main` only through
T01 of the [delivery plan](../plans/bun-elysia-delivery-plan-2026-10-11.md).
In the raw JSON assets, `<checker-worktree>` replaces that worktree's absolute
path (T00 portability edit; values otherwise unchanged).

```sh
pnpm install --frozen-lockfile
npm install --prefix .cache/checker-tools --no-audit --no-fund --ignore-scripts --save-exact @oven/bun-darwin-aarch64@1.4.3 typescript7@npm:typescript@7.0.2
export PATH="$PWD/.cache/checker-tools/node_modules/@oven/bun-darwin-aarch64/bin:$PATH"
pnpm typecheck:bun
node scripts/benchmark-typecheck.mjs
```

On other platforms, install the matching Bun 1.4.3 binary and set `BUN_BIN`
to its executable and `NATIVE_TSC` to TypeScript 7.0.2's CLI file when running
the benchmark. Bun 1.4.3 is required for this measured comparison. Earlier
Bun releases do not provide this checker. Use `bun --check` in this project
because `bun check` can select its existing `check` script.
[Bun checker documentation](https://bun.sh/docs/runtime/check).

The installed Next.js TypeScript guide was read before implementation.
It describes the separate project-local compiler used by `next build`; adding
this standalone Bun command does not replace that build checker.

## Verification

- All three checkers pass the corrected project in every timed sample.
- All three select identical project inputs and reject the four deliberate errors.
- Focused fixture tests: **2 files / 25 tests passed**.
- ESLint on the benchmark script and changed fixtures: passed with zero warnings.
- Prettier on all changed/new files and `git diff --check`: passed.
- These validation commands ran after the benchmark to avoid affecting timings.
