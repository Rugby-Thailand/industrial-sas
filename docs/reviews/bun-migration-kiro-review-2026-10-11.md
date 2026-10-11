# Bun migration plan — independent review (Kiro, 2026-10-11)

Reviewed: [`docs/plans/bun-migration-research-2026-10-11.md`](../plans/bun-migration-research-2026-10-11.md). The goal stays maximum practical Bun adoption. This review looks for gaps that would stop the plan from reaching that goal safely. It does not lower the target.

Method: read the plan and `AGENTS.md`; the installed Next 16.3.8 docs and source (`02-typescript.md`, `proxy.md`, `config-shared.js`, `runTypeScriptCli.js`); `package.json`, `.npmrc`, `pnpm-workspace.yaml`, `tools/release/*`, `vercel.json`, `tsconfig.json`, `vitest.config.mts`, all workflows, the setup action, and `scripts/ci/*`, `scripts/release/*`, `scripts/lib/*` and `scripts/dev.mjs`; plus the benchmark artifacts. Checked first-party Bun, Vercel, Convex, GitHub, Microsoft and Vitest pages fetched on 2026-10-11. Bun is not installed on this machine (`which bun` returned nothing), so I ran no Bun commands. The only command I ran against the repo was a read-only `tsc --noEmit --incremental false`.

## Verdict

The checker section is accurate, and the plan is right that `bun --check` is the only safe form of the command here. The biggest gaps are in supply-chain parity and release mechanics. GitHub does not support Bun lockfiles for security updates or the dependency graph. The release controller overwrites `vercel.json` on every deploy. The Bun version used for Vercel builds cannot be pinned through the lockfile. Bun auto-loads `.env.local`. Bun built-in commands take precedence over most script names. The plan also skips one high-value middle step: running Vitest itself on the Bun runtime.

## Findings

### B1 — Blocker (before deleting `pnpm-lock.yaml`): GitHub security tooling does not cover `bun.lock`

- **Evidence:** Dependabot's ecosystem table lists Bun as supporting version updates but **not security updates** ([supported ecosystems](https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories)). The [dependency-graph ecosystem table](https://docs.github.com/en/code-security/reference/supply-chain-security/dependency-graph-supported-package-ecosystems) lists npm, pnpm and Yarn for JavaScript, but not Bun. This repository disables version updates and relies only on security updates (`.github/dependabot.yml`: `open-pull-requests-limit: 0`, covering `/` and `/tools/release`). The required PR job `dependency-review` (`quality.yml`, `fail-on-severity: high`, `allow-ghsas` checked against `dependency-exceptions.json` by `validate-workflows.mjs`) reads the dependency graph.
- **Impact:** If the pnpm lockfiles are removed, both automated security update PRs and lockfile-based dependency review are lost. The PR gate may also pass silently because it sees no dependencies.
- **Plan correction:** In step 6, make "remove superseded pnpm lockfiles" conditional on a recorded user decision between three options:
  - (a) Submit a dependency snapshot derived from `bun.lock` through GitHub's dependency submission API. This needs `contents: write` in a dedicated job. Verify that `dependency-review` and Dependabot alerts use the snapshot; security-update PRs will probably still not be created.
  - (b) Keep a pnpm lockfile, regenerated and checked for equivalence in CI, as a security inventory only.
  - (c) Accept the loss explicitly and compensate with a scheduled job using the new audit adapter (H5).
- **Confidence:** High on the documented support gaps. Medium on how well option (a) mitigates them; not verified.

### H1 — High: the release controller overwrites `vercel.json`, and Vercel has a dashboard install override

- **Evidence:**
  - `scripts/release/run.mjs` `deploy()` writes `gatedVercelConfig()` to `vercel.json` before every deploy.
  - `scripts/release/lib/vercel-config.mjs` hard-codes `GATED_BUILD_COMMAND`, which contains `node … && pnpm exec convex deploy … --cmd '… && pnpm build'`.
  - `cutoverState()` checks only `buildCommand`, `git.deploymentEnabled` and `ignoreCommand`.
  - `docs/operations/ci-cd-platform-evidence.md` (line 26) records a project-level "frozen pnpm installation" setting.
  - Vercel: project install overrides apply to every deployment; a deployment-level `installCommand` in `vercel.json` overrides them ([package managers](https://vercel.com/docs/package-managers)).
- **Impact:** A `bunVersion`, `installCommand` or build-command change made only in the committed `vercel.json` is silently replaced at release time, and the release falls back to Node and pnpm. Committing `bun.lock` alone does not change what Vercel installs with while the dashboard override exists.
- **Plan correction:** Put every Vercel change in `gatedVercelConfig()` and its tests, together with the committed `vercel.json`. Add `installCommand` (and `bunVersion` when adopted) to `cutoverState()` as exact reviewed values. Read both projects' dashboard install settings back and update the platform-evidence document. The inner command must be `bun run build`, not `bun build` (see H6).
- **Confidence:** High.

### H2 — High: the Bun version used for Vercel builds is not pinned

- **Evidence:**
  - Vercel maps `bun.lock` to "Bun >=1.2" without an exact version ([package managers](https://vercel.com/docs/package-managers)).
  - `bunVersion` configures Functions and Routing Middleware, not the install or build tool ([vercel.json `bunVersion`](https://vercel.com/docs/project-configuration/vercel-json#bunversion)).
  - Bun writes lockfiles with nested or version-scoped overrides as `lockfileVersion` 3, "which older versions of Bun cannot read" ([overrides](https://bun.sh/docs/pm/overrides)). Both override policies use those forms (for example `next>sharp` and `js-yaml@>=4.0.0 <4.3.2`).
- **Impact:** The release could install with a Bun version that cannot read the lockfile or that differs from CI's pin.
- **Plan correction:** The `installCommand` must either install the exact pinned Bun (with checksum verification) or fail closed. In addition, add a pre-phase check to `scripts/release/assert-deploy-env.mjs` that refuses to run before `convex deploy` unless `bun --version` matches the pin, and record the version in the release manifest.
- **Confidence:** High on the documentation. Which Bun version the build image actually provides is unverified.

### H3 — High: Vercel Bun Functions are project-wide, include the Clerk proxy, and the rollback path is vague

- **Evidence:**
  - `bunVersion` moves "all Vercel Functions and Routing Middleware not using the Edge runtime" to Bun ([vercel.json](https://vercel.com/docs/project-configuration/vercel-json#bunversion)).
  - `"1.4.x"` is "the complete rewrite of Bun from Zig to Rust", with breaking changes ([Vercel Bun runtime](https://vercel.com/docs/functions/runtimes/bun)).
  - Vercel tells middleware users to set `runtime` to `nodejs`. Next 16's Proxy already defaults to Node, and setting `runtime` in a Proxy file "will throw an error" (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`, line 255). This repository's `src/proxy.ts` (Clerk) therefore moves to Bun with no per-route opt-out.
  - With ISR, the build must run as `bun run --bun next build`.
- **Impact:** Authentication and every server route change runtime in one switch. The plan's "with a Node rollback path" does not say how to roll back.
- **Plan correction:** State the blast radius explicitly. Run staging checks that cover the Clerk proxy, `/__clerk`, the AI search route, uploads and SSR streaming. Define rollback as:
  - `vercel rollback <last Node deployment ID>` (frontend only, per the existing runbook), only when compatible with the current backend;
  - then a reviewed forward PR that removes `bunVersion` from `gatedVercelConfig()`.

  Record the last Node deployment ID in the manifest and runbook. Add bytecode caching to the list of runtime differences.

- **Confidence:** Medium-high. How Vercel handles a Next 16 `proxy.ts` under Bun is unverified.

### H4 — High: Bun auto-loads `.env` and `.env.local`

- **Evidence:** Plain `bun` loads `.env`, `.env.<NODE_ENV>`, `.env.local` and `.env.<NODE_ENV>.local` automatically. This is disabled only with `--no-env-file`, with `env = false` in `bunfig.toml`, or when Bun is invoked as `node` (for example under `--bun`) ([environment variables](https://bun.sh/docs/runtime/environment-variables); Bun 1.4 upgrade notes).
  - A local `.env.local` exists and contains the developer `CONVEX_DEPLOYMENT` (`scripts/dev.mjs` requires it).
  - `scripts/lib/productionOperator.mjs` requires exactly one Node `--env-file` in `process.execArgv` and refuses ambient `CONVEX_DEPLOYMENT` and `CONVEX_DEPLOY_KEY`.
- **Impact:** Running scripts through Bun silently changes their environment. Operator, release and seed scripts would see local selectors (they fail closed, but become unusable). The same scripts behave differently under `bun` and `bun --bun`.
- **Plan correction:** Before any script is routed through Bun, commit `bunfig.toml` with `env = false` (root and `tools/release`). Keep `scripts/*-production.mjs` on Node as a named exception until `--env-file` and `process.execArgv` behavior under Bun is verified.
- **Confidence:** High on Bun's behavior. Medium on `execArgv`; not verified.

### H5 — High: the audit adapter is underestimated

- **Evidence:** `bun audit --json` prints "the raw JSON response from the registry", unfiltered. The same exit code 1 means both "vulnerabilities found" and "audit request failed" ([bun audit](https://bun.sh/docs/pm/cli/audit)).
  - I queried the npm bulk advisory endpoint with a synthetic `{"lodash":["4.17.20"]}` request. It returns `{pkg: [{id, url, title, severity, vulnerable_versions, cwe, cvss}]}`, with no dependency paths, no installed version, no totals, and the GHSA only inside `url`.
  - `scripts/ci/audit-dependencies.mjs` requires `metadata.vulnerabilities`, `advisories` and `findings[].paths`, and accepts exit codes 0 and 1. `audit-summary.mjs` and `report-lib.mjs` also parse the pnpm format.
- **Plan correction:** The adapter must:
  - fail closed on unparseable stdout or the "audit request failed" stderr message, instead of trusting the exit code;
  - derive each flagged package's installed version and every dependency chain from `bun.lock`;
  - apply `--prod` reachability itself;
  - preserve exact-chain matching and expiry checks;
  - run separately for the root and `tools/release`.

  Port `audit-summary.mjs` and `report-lib.mjs` as well. Do not use `--ignore`.

- **Confidence:** High.

### H6 — High: name collisions go beyond `check`

- **Evidence:** "If a built-in `bun` command has the same name, the built-in command takes precedence; use the explicit `bun run <script>`" ([bun run](https://bun.sh/docs/runtime)).
  - `check` is special-cased: the package script wins, except inside the `check` script and the scripts it starts, where `bun check` is the type checker ([type checking](https://bun.sh/docs/runtime/check)).
  - This repository's `build`, `test` and `check` scripts collide with Bun built-ins: `bun build` is Bun's bundler, and `bun test` is Bun's test runner.
  - A `"typecheck": "next typegen && bun check"` script, run by itself as `bun run typecheck` in CI, would execute the aggregate `check` script (format, typecheck, lint and all tests). An older `bun` in `node_modules/.bin` loops forever.
- **Plan correction:** Keep `bun --check` (verified correct). Require the `bun run <script>` form everywhere, including inside the Vercel `--cmd`, and enforce it in `workflow-lib.mjs`. Never add the `bun` npm package as a dependency. Assert the resolved `bun` path and version in CI.
- **Confidence:** High.

### H7 — High: native `bun test` cannot take over the current suite as configured; Vitest on Bun can come first

- **Evidence:**
  - **Discovery:** `bun test` collects `*.spec.*` files by default ([test runner](https://bun.sh/docs/test)). There are 11 tracked Playwright `tests/e2e/**/*.spec.ts` files, so a bare `bun test` would run them in Bun's runner.
  - **Environments:** Bun has no per-project environments. Its DOM guide uses a global happy-dom preload ([DOM](https://bun.sh/docs/test/dom)), whereas `vitest.config.mts` has seven projects using jsdom, node and edge-runtime.
  - **Mocking and transforms:** Repository usage includes `vi.hoisted` (56 calls), `vi.mock` (215), `vi.stubEnv` (36), `vi.stubGlobal` (21) and `vi.mocked` (8), plus `import.meta.glob` in 8 `convex-test` files. Bun documents only `vi.fn`, `spyOn`, `mock`, `restoreAllMocks`, `resetAllMocks` and `clearAllMocks` ([mocks](https://bun.sh/docs/test/mocks)). I found no Bun documentation for `import.meta.glob`.
  - **Coverage:** Bun's coverage reporters are only `text` and `lcov` ([coverage](https://bun.sh/docs/test/code-coverage)). `workspace-matrix.yml` uploads `coverage/coverage-summary.json` with `if-no-files-found: error`, and `test-report.mjs` reads json-summary. I found no documented Bun equivalent of Vitest's explicit `include` that reports never-imported files at 0%.
  - **Sharding and reports:** These have parity: `--shard=M/N` (since 1.3.13), `--reporter=junit --reporter-outfile`, and automatic GitHub annotations. However, `VITEST_SHARD_COMMAND`, `TEST_SHARDS = 3` and `check-test-discovery.mjs` (`vitest list --json`) are exact-match contracts.
  - **The missed step:** Bun 1.4.0 states that "vitest runs under Bun, including `--coverage`", and that the default v8 coverage provider "match[es] Node exactly" ([Bun 1.4](https://bun.com/blog/bun-v1.4)).
- **Plan correction:** Add a step before the native migration: run `bun --bun vitest run`, keeping all projects, shards, JUnit, the GitHub reporter and coverage. Compare test counts, the JUnit output and coverage JSON with Node. Then move suites to native `bun test` only if they use none of `vi.hoisted`, `import.meta.glob`, jsdom or edge-runtime. Configure `[test] root` and `pathIgnorePatterns = ["tests/e2e/**"]`, and extend the discovery check so every file is collected by exactly one runner.
- **Confidence:** High on the documentation. Medium on whether Vitest 4.1.10 with `@edge-runtime/vm` works under Bun; not verified.

### H8 — High: installing Bun in CI hits the Actions allowlist and loses `engine-strict`

- **Evidence:**
  - `isAllowedAction()` (`scripts/ci/workflow-lib.mjs`, around lines 219–226) and the repository allowlist (platform evidence) permit only `actions/*`, `github/codeql-action` and `pnpm/action-setup`.
  - The exact-string contracts include `VALIDATE_COMMANDS`, the Next cache key containing `hashFiles('pnpm-lock.yaml', '.nvmrc')`, the `isBuild` regex `(next|pnpm(?: run)?) build` and the step `pnpm -C tools/release install --frozen-lockfile`.
  - Bun's supported `.npmrc` options include `save-exact` but not `engine-strict`, `auto-install-peers`, `strict-peer-dependencies`, `dedupe-peer-dependents` or `resolution-mode` ([.npmrc](https://bun.sh/docs/pm/npmrc)). Today, `engine-strict` is what fails a wrong runner.
- **Plan correction:** Choose between:
  - allowlisting `oven-sh/setup-bun` (repository setting, validator, SHA pin and Dependabot entry); or
  - downloading a pinned, checksum-verified Bun the same way the actionlint download in `validate-workflows.mjs` works.

  Add an explicit Node/Bun version assertion. Update the validator constants, the composite action and the cache keys together.

- **Confidence:** High.

### M1 — Medium: lifecycle script policy does not carry over

- **Evidence:** pnpm migration carries over overrides, patched dependencies and workspace settings ([install](https://bun.sh/docs/pm/cli/install#pnpm-migration)), but not `ignoredBuiltDependencies` or `strictDepBuilds`. Bun has no "fail on a new script" mode, and `trustedDependencies: []` disables the default trust list ([lifecycle](https://bun.sh/docs/pm/lifecycle)). `bun pm untrusted` lists blocked scripts. Bun 1.3.2+ can also link native binaries directly (`nativeDependencies`).
- **Plan correction:** Set `trustedDependencies: []` in both `package.json` files. Add a CI step that fails unless `bun pm untrusted` matches a reviewed list: the five pnpm entries for the root, none for `tools/release`. Re-verify `@parcel/watcher`, `@swc/core`, `esbuild`, `msgpackr-extract` and `unrs-resolver` without their scripts.
- **Confidence:** Medium-high.

### M2 — Medium: frozen installs can fail open, and override semantics differ

- **Evidence:** With no lockfile at all, `--frozen-lockfile` "installs from `package.json` without writing one". Migration from `pnpm-lock.yaml` runs automatically whenever `bun.lock` is absent, with no opt-out ([install](https://bun.sh/docs/pm/cli/install)). Bun matches version-scoped override keys against each dependent's _declared range_ ([overrides](https://bun.sh/docs/pm/overrides)).
- **Plan correction:**
  - Before installing, assert that `bun.lock` exists in each directory; use `bun ci`; run `git diff --exit-code` afterwards.
  - Compare `bun pm ls --all` with pnpm's resolved tree for every override, including `next>sharp` (an optional dependency) and `@modelcontextprotocol/sdk@<1.31.0`.
  - Set `linker = "isolated"` explicitly; Bun's default for a new single-package project is hoisted.
- **Confidence:** High.

### M3 — Medium: Next's build checker cannot use `bun check`

- **Evidence:** `config-shared.js:257` has `useTypeScriptCli: true`. `runTypeScriptCli.js` resolves `typescript/package.json`, picks the `tsc` binary or any `tsc\d+` binary, and spawns `process.execPath`. Microsoft's side-by-side setup aliases `typescript` to `@typescript/typescript6`, which provides only `tsc6` ([TS 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)), so Next would still check with TypeScript 6. Under `bun --bun next build`, TypeScript 6's JavaScript `tsc` runs on Bun.
- **Plan correction:** Record that the build gate stays on TypeScript 6 until typescript-eslint supports TypeScript 7.1's API. Both gates must pass, which makes the fixture fixes mandatory. Treat "TypeScript 6 `tsc` under the Bun runtime inside `next build`" as an explicit pilot check.
- **Confidence:** High.

### M4 — Medium: subprocess inventory

- **Evidence:** These scripts hard-code `pnpm` or `node`:
  - `check-test-discovery.mjs` (`pnpm exec vitest` and `pnpm exec playwright`)
  - `audit-dependencies.mjs` and `audit-summary.mjs`
  - `check-convex-codegen.mjs` (`pnpm exec node --env-file=… node_modules/convex/bin/main.js`)
  - `seed-local-test.mjs`
  - `release/run.mjs` (`pnpm exec playwright`, and `tools/release/node_modules/.bin/vercel`, which has a Node shebang)
  - `dev.mjs` (`.bin/convex` and `.bin/next`)
  - the gated build command

  `--bun` replaces `node` with Bun for every descendant, through a `node` symlink ([bun run](https://bun.sh/docs/runtime)). That includes the Convex CLI, Playwright, the Vercel CLI and `tsc`. Bun 1.4.3 fixed macOS signal numbers for `subprocess.kill()`.

- **Plan correction:** Add this inventory as a table. Decide `--bun` or Node per entry, and require Bun ≥1.4.3 for the dev runner. Removing pnpm makes every `spawn("pnpm")` fail at once, so migrate all of these in the same change.
- **Confidence:** High.

### L1 — Low: benchmark accuracy

- **Verified:**
  - The medians (13.403, 2.648, 1.857 and 0.895 s) and the ratios (≈15×, 3× and 2×) match `benchmarks.json`.
  - After removing Bun's summary, a `diff` of the two diagnostics files is empty.
  - TypeScript 6 passes on the present tree: my `tsc --noEmit --incremental false` exited 0 in 14.5 s.
- **Caveat:** The tree changed during this review (an untracked `useCatalogueState.test.tsx` appeared). Re-run the comparison, including the 770-file count, on the final tree.
- **Confidence:** High.

## Claims verified

- Bun 1.4.3 was released 2026-10-10. `bun check` is a port of typescript-go matching TypeScript 7.0.2, passes the full 7.0.2 conformance suite, and is 3–6.4× faster than `tsc` 7.0.2 on a 16-core Apple silicon Mac. It does not emit files or provide a language server, writes no `.tsbuildinfo`, supports `--threads`, and ignores language-service `plugins`. A `check` script wins over the checker, and `bun --check` type-checks the project.
- Next 16.3.8 uses the project-local `tsc` CLI by default. Proxy defaults to the Node runtime.
- Bun's pnpm migration keeps resolved versions and integrity hashes and moves overrides. Overrides support only one parent level and support version selectors. The isolated linker exists. `trustedDependencies` replaces Bun's default list. `bun audit --json` returns raw registry JSON.
- `bun --bun next dev/build/start` is documented, `--bun` symlinks `node`, and `bun --bun next build` works on Next 16.3 with Turbopack (Bun blog).
- Vercel: Bun Functions are in Beta; `"1.4.x"` and `"1.x"` (= 1.3.14) are the valid values, and Vercel manages patch versions; ISR requires Bun `build`/`dev` commands; source maps, bytecode caching and request metrics differ; Node may be faster for some workloads.
- Convex: the Bun quickstart uses `bun add convex` and `bunx convex dev`. Node actions support Node 20, 22 and 24 (default 20). There is no Bun runtime option.
- Microsoft supports running TypeScript 7 side by side with TypeScript 6 through `@typescript/typescript6`.
- Vitest warns about `bun test` versus `bun run test`. The current Vitest docs are for 5.0.3, while this repository pins 4.1.10.

## Claims not verified

- Any Bun command on this repository: no Bun is installed here; the timings are from the plan's artifacts.
- Which Bun version the Vercel build image provides, and whether `bunVersion` affects build-time `bun`.
- Vercel's handling of a Next 16 `proxy.ts` under Bun, and whether `vercel rollback` restores the Node runtime of the earlier deployment.
- Vitest 4.1.10 projects, `@edge-runtime/vm` and v8 coverage under `bun --bun`.
- Bun's `process.execArgv` and `--env-file` behavior for the operator scripts.
- Whether `bun.lock` migration reproduces pnpm's tree, and peer-dependency behavior (pnpm's `auto-install-peers` and `dedupe-peer-dependents` have no Bun equivalent).
- How well dependency submission mitigates B1.

## Recommendations for Codex (in order)

1. Add B1 as a gating decision for the user before lockfile removal. Without option (a), (b) or (c), "remove superseded pnpm lockfiles" breaks existing security guarantees.
2. Insert "Vitest on the Bun runtime" (`bun --bun vitest run`, with shards, JUnit and coverage unchanged) as the step before the native `bun test` migration. Keep native `bun test` for qualifying suites only, with `pathIgnorePatterns` for `tests/e2e/**`.
3. Make Vercel changes only through `gatedVercelConfig()` and `cutoverState()`. Add an explicit `installCommand` and an assertion of the pinned Bun version before `convex deploy`. Use `bun run build` inside `--cmd`. Reconcile the dashboard install override.
4. Commit `bunfig.toml` with `env = false` and `[install] linker = "isolated"` before routing scripts through Bun. Keep the production operator scripts on Node as a recorded exception.
5. Specify the audit adapter as a lockfile-derived chain resolver that fails closed. Add the `trustedDependencies: []` and `bun pm untrusted` gate, and a check that `bun.lock` exists before installing.
6. Choose how CI installs Bun (allowlist `oven-sh/setup-bun`, or a checksum-verified download), replace `engine-strict` with an explicit version check, and update the validator's exact strings together.
7. Require the `bun run <script>` form everywhere, and add the subprocess inventory table from M4.
8. Define Bun Functions rollback as `vercel rollback <last Node deployment ID>` plus a forward PR that removes `bunVersion`. Name the Clerk proxy as covered by the staging checks.
9. Re-run the checker comparison on the final tree. Keep the TypeScript 6 build gate as a recorded dual-semantics requirement.

## Codex verification and disposition

Kiro reviewed through the CLI with `claude-opus-5.5`, high effort. Codex subsequently checked the consequential findings against local scripts and the linked first-party pages, and updated the [plan](../plans/bun-migration-research-2026-10-11.md). This is a plan review; the migration has not been implemented.

| Finding | Disposition                                                                                                                                                                                                                                                                                                                |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1      | Confirmed GitHub's table distinguishes Bun version updates from unsupported security updates, and its graph table omits Bun locks. Preserve synchronized pnpm security inventory until an equivalent replacement is proven. Do not ask to weaken existing protections or assume dependency submission restores update PRs. |
| H1–H2   | Confirmed the controller rewrites configuration and remote build-version parity is not established by lock detection. Added generator/cutover changes, install-override reconciliation, explicit remote version checks and manifest evidence.                                                                              |
| H3      | Added project-wide staging coverage and a rehearsed, backend-compatible rollback. Actual Next Proxy handling and restoration of the previous runtime remain unverified; these are acceptance checks, not proven behavior.                                                                                                  |
| H4      | Confirmed dotenv defaults and the operator's `execArgv` contract. Added explicit environment control and a temporary Node exception for operator scripts until parity is demonstrated.                                                                                                                                     |
| H5–H6   | Confirmed audit response lacks the required paths and script names collide. Added graph reconstruction, failed-request handling, report adapters and explicit `bun run` script invocation.                                                                                                                                 |
| H7      | Confirmed Bun 1.4's Vitest/coverage and Playwright support claims. Added a runtime pilot before native tests, explicit e2e exclusion and discovery/report parity. Missing documentation is not proof that a suite can never be ported; retained capabilities require concrete blockers.                                    |
| H8      | Confirmed the action allowlist and exact workflow contracts. Added setup/allowlist changes and explicit version assertions.                                                                                                                                                                                                |
| M1      | Accepted lifecycle-baseline checking, with a correction: derive each blocked-script list from its clean Bun install. The five pnpm entries and a guessed empty release list are not established Bun inventories.                                                                                                           |
| M2      | Confirmed missing-lock behavior and range-selector semantics. Added lock existence, unchanged-file and resolved-graph checks.                                                                                                                                                                                              |
| M3      | Keep TypeScript 6 in the initial build pilot. Narrowed the recommendation: installed Next supports native TypeScript 7, so a separately verified build/API configuration need not wait for TypeScript 7.1.                                                                                                                 |
| M4 / L1 | Added the subprocess inventory and a fresh measured snapshot before implementation. Original timings and diagnostics remain historical evidence.                                                                                                                                                                           |

Scope clarification: Bun was absent from Kiro's `PATH`; the earlier benchmark used a temporary Bun installation. Kiro's only validation run was TypeScript without emission/incremental writes, in addition to its read-only inspection commands. No Bun runtime, installation migration, live project setting, deployment or rollback was exercised in this review.
