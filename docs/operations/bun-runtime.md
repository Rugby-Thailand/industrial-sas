# Bun runtime

Status: partial migration (2026-10-11). Next.js runs on Bun for local
development, builds, `next start` and hosted Vercel Functions. Installation,
tests, Convex and the release tooling stay on Node and pnpm. Bun is pinned to
`.bun-version` (1.4.3) locally and in CI; Vercel manages the hosted `1.4.x`
patch.

`package.json` declares both `engines.node: "24.x"` for retained tooling and
`engines.bun: "1.4.x"`. Together with `vercel.json`'s `bunVersion`, this selects
Bun on Vercel. Declaring only the Node engine overrides `bunVersion` and selects
Node functions; it also leaves the older build-image Bun on PATH.

## What runs on Bun

| Surface                       | Command or configuration                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm dev` (Next part)        | `scripts/dev.mjs` runs `bun --bun --no-env-file node_modules/next/dist/bin/next dev`   |
| `pnpm dev:web`                | `BUN_OPTIONS=--no-env-file bun run --bun --no-env-file next dev --webpack --port 3100` |
| `pnpm build`                  | same prefix, `next build` (also inside the gated Vercel build command)                 |
| `pnpm start`                  | same prefix, `next start --port 3100`                                                  |
| Credential-free browser smoke | `playwright.config.ts` `webServer` runs `next start` with the same invocation          |
| Hosted functions              | `vercel.json` and the generated release config: `"bunVersion": "1.4.x"`                |
| Type checking                 | `bun --check` (unchanged; see README)                                                  |

Framework flags (`--webpack`, `--port`, `--hostname`) are unchanged.

`--no-env-file` stops Bun from loading `.env*` files before Next selects its
environment files (Bun would otherwise pick `.env.development` during
`next build`). Next re-spawns its dev server and build workers with its own
`execArgv`, which drops the flag, so `BUN_OPTIONS=--no-env-file` carries it to
those processes. Without it they would reload `.env*` files for any variable
not already set.

`GET /api/runtime` reports the serving runtime: `runtime` (`bun` or `node`),
`process.release.name`, the Bun or Node version, and `releaseSha` (the runtime
`RELEASE_SHA` value if it is a 40-character hex SHA, otherwise `null`). It is
public, dynamic and `Cache-Control: no-store`, and it returns no other
environment data. The smoke test `tests/e2e/smoke/runtime.spec.ts` requires
`runtime: "bun"` at the exact `.bun-version`, so a Node-served smoke run fails.
On Vercel, `RELEASE_SHA` is passed only as a build variable (`--build-env`), so
the hosted endpoint is expected to report `releaseSha: null`. The
`X-Release-Sha` header remains the release provenance check.
The production runtime smoke checks the same response's release header and
requires Bun 1.4.x on staging, the production candidate, and the live domain.

## Retained Node exceptions

- Node 24 and pnpm 10.33.2: `pnpm install --frozen-lockfile`, the exact lock,
  overrides and blocked dependency install scripts are unchanged. There is no
  `bun.lock` and no `bunfig.toml`.
- Vitest and the Playwright runner run on Node. Only the Next server under test
  runs on Bun. A Bun 1.4.3 / Vitest 4.1.11 compatibility probe passed 193 files
  but failed four cases in `catalogue-pagination.integration.test.ts` and
  `ci-codegen-isolation.integration.test.ts`. The same suite passes on Node.
  Revisit this exception when those error and process-isolation behaviors pass
  under Bun; no tests or assertions are removed to accommodate the runtime.
- The Convex CLI (`convex dev`, `convex deploy`) and the Convex hosted runtime.
- The release controller, `tools/release` Vercel CLI, backup, staging,
  candidate, promotion and live checks, and the `scripts/*-production.mjs`
  operator scripts.

## Setup

```sh
node scripts/ci/install-bun-checker.mjs   # checksum-verified, prints the PATH entry
export PATH="$PWD/.cache/bun-checker/bun-v1.4.3-<platform>:$PATH"
bun --version                             # 1.4.3
```

CI installs the same pinned Bun in `.github/actions/setup-node-pnpm` right
after the frozen install. Every job that installs dependencies therefore has
it, including the build and browser jobs. `scripts/ci/workflow-lib.mjs`
requires exactly one installer run there, after the frozen install, and none in
the validate job. Next's CI build cache is separated from previous Node builds
and includes `.bun-version` in its key.

## Release guard

`cutoverState` (`scripts/release/lib/vercel-config.mjs`) requires
`bunVersion: "1.4.x"` in the committed `vercel.json`. A missing or different
value returns `NOT_READY` before any mutation, so a release cannot silently go
back to Node. The release writes the same `gatedVercelConfig()` content it
checks. The build command, environment guards, same-SHA checks, backup, staging,
candidate, promotion and live checks are unchanged.

Vercel's Bun runtime is in Beta. The automatic release checks that functions
report Bun 1.4.x: the production runtime smoke is included in staging, candidate
and live verification. Staging stays enabled for this runtime cutover.
`convex deploy` runs its `--cmd` build before pushing the backend, so a missing
`bun` fails the build before the backend changes. A candidate that reports Node
fails before promotion.

## Rollback

- Local: `pnpm dev:web:node`, `pnpm build:node` and `pnpm start:node` run the
  unchanged Node commands. For the full `pnpm dev` runner, revert the Next
  spawn in `scripts/dev.mjs`.
- Hosted: make a reviewed forward-fix PR through the normal pipeline. Set the
  `build` script back to `next build`. Then remove `bunVersion` from
  `vercel.json`, `gatedVercelConfig()` and the `cutoverState` check together;
  changing only one of them returns `NOT_READY`. Remove the Bun expectations
  from both the local and production runtime smoke tests as well. `vercel rollback` restores a previous
  Node-built frontend only when it is compatible with the current backend
  (README, Production).

## Deferred

- Installing with Bun (`bun install`, `bun.lock`, lifecycle-script policy)
  while pnpm stays the source of truth.
- Running tests on Bun (`bun test` or Vitest under Bun).
- Elysia or other Bun-native servers, and further provider work.
