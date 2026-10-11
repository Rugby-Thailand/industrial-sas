# Bun migration research — October 11, 2026

**Target: use Bun by default wherever this repository can preserve compatibility and correctness.** This includes dependency installation, script execution, standalone type checking, compatible tests, Next development/build execution, CI and release tooling, and supported deployment runtimes. Start with the checker and package manager, then continue through the remaining areas rather than stopping at those two improvements. Local checking was about 15× faster than a full TypeScript 6 check, but surfaced three TypeScript 7 errors that must be resolved before adoption. Hosted Convex functions remain on the runtimes Convex provides. Faster tooling can shorten development and CI; actual loading/navigation improvements still need the application changes in the [Phase 2 performance plan](performance-next-steps-2026-10-11.md).

This is research, not an implemented migration. Execution follows the [Bun and Elysia delivery plan](bun-elysia-delivery-plan-2026-10-11.md) (Phase 1); its [T00 baseline](../reviews/bun-elysia/T00/handoff.md) records the current commands, installs and tests. First-party pages were checked during this investigation; versions and release dates below come from those pages and the installed packages, rather than assumptions based on the workstation date. Source pages can change. Local benchmark evidence is recorded separately below.

Kiro independently reviewed this plan on October 11; its [review and findings](../reviews/bun-migration-kiro-review-2026-10-11.md) are preserved separately. Codex checked the consequential suggestions against repository code and first-party sources, and incorporated the supported corrections below. The adoption target remains unchanged.

## Current repository

- [`package.json`](../../package.json): pnpm 10.33.2, Node 24.x, Next 16.3.8, TypeScript 6.0.3, Vitest 4.1.10; `typecheck` runs `next typegen && tsc --noEmit`.
- Development explicitly selects webpack in both `dev:web` and [`scripts/dev.mjs`](../../scripts/dev.mjs). Production `build` runs `next build` without that flag.
- [`vitest.config.mts`](../../vitest.config.mts) defines seven projects with Node, jsdom and edge-runtime environments, React/Vite transforms, and V8 coverage. Tests use `vi.hoisted`, fake timers, environment/global stubs and `import.meta.glob`.
- Root and [`tools/release`](../../tools/release/package.json) have separate pnpm lockfiles and security overrides. The release directory is an intentionally separate CLI install, not an ordinary workspace package.
- [`vercel.json`](../../vercel.json), CI scripts, and the workflow validator encode pnpm commands. Audit policy validates pnpm advisory objects and exact dependency paths; changing the executable alone is insufficient.

## What the new checker actually is

Bun's [1.4.3 release notes](https://bun.sh/blog/bun-v1.4.3), dated **October 10, 2026**, introduce `bun check`. This is a built-in port of Microsoft's native TypeScript checker, matching **TypeScript 7.0.2**, rather than just executing the project's installed TypeScript. Bun reports passing the complete TypeScript 7.0.2 conformance suite and publishes 3–6.4× speedups over native `tsc` 7.0.2 on a 16-core Apple silicon Mac. Those are vendor benchmarks on other projects, not estimates for this app. It does not emit JavaScript/declarations or provide an editor language server.

There is an immediate command collision here: this repository already defines a `check` script. Bare `bun check` runs that script. Use **`bun --check`** for the standalone checker. Keep `next typegen` before it. Bun reads the selected tsconfig, exits unsuccessfully on errors, checks afresh without writing `.tsbuildinfo`, and offers `--threads` to limit CPU concurrency. It follows TypeScript 7 semantics regardless of the installed compiler, so compare diagnostics before replacing the current check. [Bun checker documentation](https://bun.sh/docs/runtime/check).

A future script could be `next typegen && bun --check`; this is a proposal, not a change made here. Do not replace the entire aggregate `check` script with type checking alone. Its formatting, lint and test gates must remain.

Keep TypeScript 6 available during the pilot for tools consuming its JavaScript API, including typescript-eslint. Microsoft explicitly supports running native TypeScript 7 alongside TypeScript 6 for that reason; the two implementations have different integration surfaces. Native TypeScript 7 is also a useful comparison candidate if Bun does not preserve diagnostics. [Microsoft TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).

Next 16.3.8's installed [TypeScript guide](../../node_modules/next/dist/docs/01-app/03-api-reference/05-config/02-typescript.md) explicitly supports TypeScript 7 with the project-local `tsc` CLI, enabled by default. [`config-shared.js`](../../node_modules/next/dist/server/config-shared.js) and [`runTypeScriptCli.js`](../../node_modules/next/dist/lib/typescript/runTypeScriptCli.js) confirm that path. This does **not** mean changing our standalone `typecheck` script automatically changes the checker inside `next build`: Next still invokes the project compiler. A build-checker migration is a separate decision, including the compiler API consumers.

During the first migration, retain the installed TypeScript 6 build gate and explicitly verify it inside `bun --bun next build`; the JavaScript `tsc` subprocess then runs under Bun. Keep both standalone and build gates passing. Native TypeScript 7 build checking may be evaluated separately with a verified setup that also preserves the TypeScript 6 API for consumers; it is not automatically blocked until a future TypeScript release.

## Adoption target and compatibility

The user's preferred outcome is **maximum practical Bun adoption**, with a consistent toolchain across local development, CI and deployment. A successful compatibility check is the condition for migration; a large speedup is not required for every individual script when using Bun also removes unnecessary tooling differences.

Standardizing on Bun can simplify setup and command execution. It does not automatically improve compatibility with packages written for Node. Verify each area's actual dependencies, subprocess behavior and outputs before switching it. Using `bun run` to launch a script that still invokes `node` is only partial adoption; record and resolve those remaining Node processes where supported.

Retain a different runtime or tool only for a concrete purpose or demonstrated compatibility gap. Record the affected command, the blocker, the evidence and the condition for revisiting it. Next's compiler/bundler, Playwright's browser automation, and ESLint/Prettier's rules/plugins remain necessary tools even when Bun executes their CLIs. Convex's hosted runtime is a platform boundary. TypeScript's compiler API and any test suites that cannot yet preserve their behavior are compatibility exceptions to track, rather than reasons to stop the broader migration.

## Migration matrix

| Area                        | Can Bun take over?               | Expected benefit and recommendation                                                                                                               |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standalone type check       | Yes, Bun ≥1.4.3                  | Best first pilot. Preserve route type generation; compare errors and cold/warm timings.                                                           |
| Dependency installation     | Yes                              | Can improve clean installs and CI. Benchmark against cached pnpm; migrate both separate lockfiles and policies.                                   |
| Script launcher             | Yes, subject to compatibility    | Migrate compatible scripts and subprocesses to Bun; inspect explicit `node` commands and child shebangs rather than changing only the launcher.   |
| Next dev/start runtime      | Supported by Bun                 | Benchmark isolated processes, hot reload and shutdown. Requires explicit Bun runtime selection.                                                   |
| Next build runtime          | Supported by Bun                 | Bun can run the Next CLI; retain Next's compiler/bundler pipeline. Full build speedup remains unmeasured.                                         |
| Next bundler                | Retain Next's bundler            | `bun build` is not a direct App Router build replacement. Investigate the current webpack dev choice separately.                                  |
| Vitest tests                | Bun runtime, then native suites  | First verify Vitest on Bun with its configuration intact; migrate compatible suites to native `bun test` after behavior and reports reach parity. |
| Playwright                  | Keep tool; verify Bun execution  | Bun 1.4 documents Playwright support. Verify our pinned version, browser installation and all test configurations on Bun.                         |
| ESLint/Prettier             | Keep existing tools              | Bun can launch them; adopting Bun does not migrate their rules, plugins or formatting policy.                                                     |
| Convex CLI/client           | Bun workflows documented         | Package installation and client scripts are viable pilots; retain local/backend lifecycle checks.                                                 |
| Hosted Convex functions     | No Bun runtime option documented | Functions remain on Convex's default runtime or its Node action runtime.                                                                          |
| Vercel Next Functions       | Yes, currently Beta              | Separate staging experiment after tooling; measure auth/SSR/streaming/proxy flows before production.                                              |
| Release/security automation | Possible, requires work          | Rework audits, workflow assertions and locked release tooling; preserve their existing guarantees.                                                |

The runtime and deployment support in this matrix comes from [Bun's Next.js guide](https://bun.sh/guides/ecosystem/nextjs), [Vercel's Bun runtime documentation](https://vercel.com/docs/functions/runtimes/bun), and the Convex sources below. Recommendations about this repository are engineering judgments based on its configuration, not vendor promises.

## Package manager and CI implications

Bun can migrate `pnpm-lock.yaml` into a committed `bun.lock`, retaining the original file. Current docs describe preserving resolved versions/integrities and migrating overrides from `pnpm-workspace.yaml`. It supports an isolated linker analogous to pnpm; choose it explicitly for this single-package repository rather than accepting a hoisted default. Do clean installs and inspect resulting versions before removing the old lockfiles. [Bun installation/migration documentation](https://bun.sh/docs/pm/cli/install), [lockfiles](https://bun.sh/docs/pm/lockfile).

Current Bun supports pnpm-style parent overrides such as `next>sharp` and version-scoped overrides, but only one parent level. The repository's root and release policies use these forms. Validate each migrated override and the resolved graph; source-level syntax support is not evidence that this exact tree has been checked. [Bun overrides](https://bun.sh/docs/pm/overrides).

Version selectors match a dependent's declared range rather than its resolved version, so compare the installed versions and parent edges for every override, including optional `next>sharp`. Nested/version-scoped overrides require Bun's lockfile version 3, which older Bun versions cannot read. Before every frozen install, assert the directory's committed `bun.lock` exists; Bun documents that `--frozen-lockfile` alone can install without a lockfile. Check that manifests and locks remain unchanged afterward. [Overrides semantics](https://bun.sh/docs/pm/overrides), [frozen installs](https://bun.sh/docs/pm/cli/install).

Lifecycle defaults differ. Bun implicitly trusts some popular npm packages. Defining `trustedDependencies: []` disables that default trust; an explicit nonempty list replaces it. Our pnpm configuration blocks reviewed build scripts and rejects newly unreviewed ones via `strictDepBuilds`. Reproduce the blocked-script behavior and add a check for newly introduced scripts; do not silently widen trust during migration. [Bun lifecycle scripts](https://bun.sh/docs/pm/lifecycle).

Start both installs with `trustedDependencies: []`, inventory blocked scripts through `bun pm untrusted`, and compare against a reviewed baseline in CI. Derive that baseline from clean installs in each directory; do not assume pnpm's five root entries or an empty release list covers every blocked Bun script. Keep exact dependency saves explicit (`save-exact` or `[install] exact = true`) and verify the isolated linker and peer resolution in both installs. [Bun configuration](https://bun.sh/docs/runtime/bunfig).

`bun audit --json` returns raw registry JSON; pnpm's current policy expects `metadata.vulnerabilities`, `advisories`, and exact `findings.paths`. Design an adapter that preserves chain-specific exceptions and expiry checks before changing the audit command. A plain GHSA ignore loses those constraints. Audit both independently locked installs. [Bun audit](https://bun.sh/docs/pm/cli/audit), [current audit policy](../../scripts/ci/audit-dependencies.mjs).

The adapter needs a lockfile graph resolver, not just renamed JSON fields: reconstruct affected installed versions, all relevant dependency chains and production reachability. Audit errors and vulnerabilities can share exit code 1; validate the response and treat request/parse failures as failures. Preserve expiry and exact-chain rules, including a vulnerable package appearing through both an allowed and an unallowed chain. Update `audit-summary.mjs` and `report-lib.mjs` too, and verify their reports against the same fixtures. [Audit response and exit codes](https://bun.sh/docs/pm/cli/audit).

**Keep GitHub security coverage before removing pnpm locks.** GitHub currently documents Bun version updates but no Bun security-update PRs; its dependency-graph table does not list Bun locks. This repo relies on security-update PRs and the required dependency-review check. Preserve a synchronized pnpm security inventory as a temporary compatibility exception until a replacement is proven to retain the required protections. Evaluate Bun-derived dependency submission for graph/review coverage, but do not assume it restores security-update PRs. Neither changing Dependabot's ecosystem nor a scheduled audit alone establishes equivalent coverage. [Dependabot support](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories), [dependency graph](https://docs.github.com/en/code-security/reference/supply-chain-security/dependency-graph-supported-package-ecosystems).

Update the composite setup action, frozen-lockfile installs, cache keys, test discovery/codegen subprocesses, release command and workflow-verifier assertions together. Preserve exact dependency pins and isolated release installs. Vercel recognizes `bun.lock` for package-manager selection; installing with Bun is a distinct change from deploying Bun Functions. [Vercel package managers](https://vercel.com/docs/package-managers).

The current action allowlist in `workflow-lib.mjs` excludes `oven-sh/setup-bun`. For a Bun setup action, update both validator and repository allowlists, pin its full SHA and track it with Dependabot; otherwise use a reviewed checksum-verified binary download. Assert actual Node/Bun versions explicitly before jobs instead of relying on pnpm's `engine-strict`. Update exact command assertions, cache keys and their tests together. Use **`bun run <script>`** for package scripts throughout CI and release commands: `bun build` and `bun test` invoke Bun's built-ins. Keep the standalone checker as `bun --check` and avoid a project-local `bun` package that could shadow the selected binary.

## Next runtime, tests and deployment

Bun's Next guide documents `bun --bun next dev`, `build`, and `start`. Running `bun run dev` alone is not proof that all child processes use Bun: our dev script explicitly starts `node` and launches executable Next/Convex shims. Pilot the Next runtime directly, then adapt the launcher when compatibility passes; test Ctrl+C, signals, child cleanup and local Convex sync. Bun documents residual Node API differences, so compatibility should be checked against this app's auth, uploads, image/WASM and stream usage. [Next.js on Bun](https://bun.sh/guides/ecosystem/nextjs), [Node compatibility](https://bun.sh/docs/runtime/nodejs-compat).

Disable Bun's automatic dotenv loading before migrating controlled scripts, using `env = false` in the relevant Bun configurations or an explicit equivalent. Preserve intentional development environment loading separately. Production operator scripts currently inspect Node's `--env-file` in `process.execArgv`; keep them on Node until Bun preserves those checks. Verify codegen's credential-free behavior and release environment contracts with the selected runtime. [Bun environment configuration](https://bun.sh/docs/runtime/bunfig), [operator contract](../../scripts/lib/productionOperator.mjs), [codegen contract](../../scripts/ci/check-convex-codegen.mjs).

Track these subprocess paths explicitly; remove each hard-coded pnpm dependency when its caller migrates:

| Path                                              | Required runtime decision                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `scripts/dev.mjs`                                 | Next/Convex shims, signals and child cleanup on Bun.                                  |
| `scripts/ci/check-test-discovery.mjs`             | Vitest/Playwright listing on Bun; extend ownership to native Bun suites.              |
| `scripts/ci/audit-{dependencies,summary}.mjs`     | Bun audit plus chain resolver and existing report contracts.                          |
| `scripts/ci/check-convex-codegen.mjs`             | Convex CLI and explicit environment-file handling on Bun; retain Node until verified. |
| `scripts/seed-local-test.mjs`                     | Local Convex selection and environment handling on Bun.                               |
| `scripts/release/run.mjs` and gated build command | Pinned Vercel CLI, Playwright and Convex children on verified runtimes.               |
| Production operator scripts                       | Node exception until `--env-file`/`execArgv` checks pass on Bun.                      |

`--bun` can affect descendant Node shebangs, so verify the entire child process chain rather than applying it globally before the inventory passes.

Next's installed [Turbopack guide](../../node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md) says Turbopack is the default bundler. Our development commands opt out. Establish why before trying its default: swapping JavaScript runtime and swapping development bundler are separate experiments. Do not credit Bun for an improvement actually caused by removing `--webpack`.

Vitest explicitly warns that `bun run test` executes the script whereas `bun test` invokes Bun's own runner. Live Vitest docs currently describe a newer major than our pinned 4.1.10; they are not a compatibility certification for that package version. [Vitest getting started](https://vitest.dev/guide/).

**First pilot Vitest itself on Bun:** `bun --bun vitest run`, followed by the existing shard/report commands and `--coverage`. Bun 1.4 documents Vitest (threads/forks and V8 coverage) and Playwright support. Verify our pinned versions, all seven environments/projects, discovered tests, failures, JUnit and coverage JSON against Node before switching. This increases Bun runtime adoption without first replacing the test framework. [Bun 1.4 compatibility](https://bun.com/blog/bun-v1.4).

Bun offers several `vi` aliases and DOM testing, but these do not establish equivalence with our seven-project configuration, hoisted mocks, Vite glob transforms or V8 coverage. Begin native test migration with a pure-test subset and compare discovery, assertions, reports and isolation, then expand to every compatible suite. Keep complex UI/Convex suites on Vitest until all semantics are verified, recording specific blockers for any retained suite. Convex's official test guide uses Vitest and edge-runtime. [Bun mocks](https://bun.sh/docs/test/mocks), [DOM testing](https://bun.sh/docs/test/dom), [Convex test guide](https://docs.convex.dev/testing/convex-test).

For native suites, explicitly exclude Playwright `tests/e2e/**/*.spec.ts` and give each tracked test exactly one logical runner/project owner. Preserve isolation and preloads, then port hoisted mocks, environment stubs and glob transforms only with equivalent behavior. Bun documents sharding, JUnit and GitHub annotations, but their CLI/report arguments differ. Its native coverage documents text/LCOV, while our reports require `coverage-summary.json` and include never-imported files at zero: retain Vitest coverage until equivalent outputs and scope are verified. Missing documentation for an API is a pilot requirement, not proof that no future port is possible. [Bun test discovery/reporting](https://bun.sh/docs/test), [native coverage](https://bun.sh/docs/test/code-coverage).

Vercel's current fetched documentation marks Bun Functions **Beta** and supports `bunVersion: "1.4.x"` explicitly for Bun 1.4; `"1.x"` currently selects the previous 1.3.14 line. Vercel manages patches, so the deployed runtime cannot be assumed to match an exact local Bun pin. Next with ISR also requires Bun build/dev commands. There are differences in automatic source maps and HTTP request metrics. Measure workload-specific behavior; the docs acknowledge cases where Node can be faster. [Vercel Bun runtime](https://vercel.com/docs/functions/runtimes/bun).

Change the generated configuration in `gatedVercelConfig()` and committed `vercel.json` together: `release/run.mjs` overwrites the file before deploying. Extend `cutoverState()` and its checks to verify reviewed install/runtime settings, and reconcile the recorded dashboard pnpm install override on both projects. Use `bun run build` inside Convex's `--cmd`. [Release configuration](../../scripts/release/lib/vercel-config.mjs), [controller](../../scripts/release/run.mjs), [platform evidence](../operations/ci-cd-platform-evidence.md).

Treat remote build Bun and managed Functions Bun as separate versions. Provide or verify the exact build-time pin before installation and again before `convex deploy`; fail if it differs, and record it in the release manifest. Lockfile detection and `bunVersion` alone do not prove that the remote install/build matches CI. [Vercel install selection](https://vercel.com/docs/package-managers).

The Functions selection applies across supported server functions/middleware, so stage the Clerk proxy, `/__clerk`, AI search, uploads and SSR/streaming together. Next 16 Proxy disallows a `runtime` option; do not copy older middleware configuration into `src/proxy.ts`. Actual Proxy behavior on Vercel Bun remains a staging requirement. Check bytecode caching and observability differences too. Record the last Node deployment ID; rehearse the existing frontend rollback to it when backend-compatible, verify runtime/auth restoration, then use a forward configuration change removing `bunVersion` if needed. Update the [release runbook](../operations/release-runbook.md) with the proven procedure before production adoption. [Vercel Bun configuration](https://vercel.com/docs/project-configuration/vercel-json#bunversion), [installed Proxy guide](../../node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).

## The Convex boundary and user-visible speed

Convex's [Bun quickstart](https://docs.convex.dev/quickstart/bun) demonstrates `bun add convex`, `bunx convex dev`, and a Bun client script. It is evidence for Bun tooling/client compatibility, not a Bun backend runtime.

Hosted functions run either in Convex's custom V8-based default runtime or in opt-in Node actions; the documented Node versions are 20, 22 and 24. There is no documented Bun setting for queries, mutations or actions. Moving our local CLI to Bun will not accelerate those hosted permission/database reads. [Convex runtimes](https://docs.convex.dev/functions/runtimes).

Likewise, the browser continues executing the shipped React JavaScript. Installing dependencies or checking types faster does not shrink our translation catalogues, remove shared motion dependencies, or eliminate permission round trips. The October 10 performance plan (`docs/plans/performance-improvement-2026-10-10.md`, present only in an unpushed local commit, not on `main`) identified those concrete loading/navigation candidates; the [Phase 2 performance plan](performance-next-steps-2026-10-11.md) carries the current evidence-gated version. Prioritize it if the intended outcome is a faster app for warehouse/HR users.

## Local measurements

Three wall-clock samples per command on this macOS workstation, using Node 24.19.0, pnpm 10.33.2 and the repository's existing dependencies/generated route types. Bun 1.4.3 and native TypeScript 7.0.2 were installed into temporary directories; repository dependencies, lockfiles and application code were unchanged. Bun reports `process.versions.typescript = 7.0.2`.

These describe the tree at the original measurement, not the later concurrent application changes. Before implementation, freeze a snapshot and record its commit plus working-tree state, regenerate route types, and rerun the checker comparison and input-scope checks. Preserve these original artifacts rather than relabeling them as new measurements.

Evidence: [raw benchmark results](../reviews/assets/bun-migration-2026-10-11/benchmarks.json), [Bun diagnostics](../reviews/assets/bun-migration-2026-10-11/bun-check-diagnostics.txt), [native TypeScript 7 diagnostics](../reviews/assets/bun-migration-2026-10-11/typescript7-diagnostics.txt).

| Checker                                                               | Wall-clock samples, seconds | Median       | Result                               |
| --------------------------------------------------------------------- | --------------------------- | ------------ | ------------------------------------ |
| TypeScript 6.0.3 full, `--noEmit --incremental false --pretty false`  | 15.393 / 12.850 / 13.403    | **13.403 s** | Pass                                 |
| TypeScript 6.0.3 warm incremental, separate temporary build-info file | 2.789 / 2.467 / 2.648       | **2.648 s**  | Pass                                 |
| Native TypeScript 7.0.2 full, same full flags                         | 2.432 / 1.761 / 1.857       | **1.857 s**  | Three errors                         |
| Bun 1.4.3, `--check --no-pretty`                                      | 0.895 / 0.738 / 1.709       | **0.895 s**  | Same three errors; 770 files checked |

The incremental TypeScript 6 run was primed once in **14.760 s**. Bun was approximately **15× faster than the full TypeScript 6 check**, **3× faster than its warmed incremental check**, and **2× faster than native TypeScript 7** by these medians. These are exploratory local process timings with a warm filesystem and some background work, including one overlapping helper process. They exclude fresh `next typegen`, package installation, full Next builds and tests; they do not establish CI or production latency. Matching diagnostics on this tree does not prove per-file scope equivalence; the pilot must compare discovered inputs too.

After removing Bun's summary, its diagnostic text matched native TypeScript 7 exactly:

- [`catalogueFilters.test.ts`](../../src/features/finishedGoods/catalogueFilters.test.ts), line 73: `TS2345`.
- [`unitNextAction.test.ts`](../../src/features/finishedGoods/unitNextAction.test.ts), lines 34 and 57: `TS2379`.

These are invalid move fixtures missing `activeMoveId`. TypeScript 6 passes the present tree, so replacing its successful gate with Bun immediately would make CI fail. Correct the fixtures without relaxing types, then rerun both old/new checks and the affected tests. This comparison supports a checker pilot; it does not support deleting TypeScript 6 or changing production runtime yet.

## Implementation order

1. Correct the three TypeScript 7 fixture errors, then add a pinned standalone Bun checker pilot alongside the current check, retaining `next typegen` and Next's build type checks; compare diagnostics and timings on clean and incremental TypeScript runs.
2. Benchmark clean/cached installs in an isolated checkout, then migrate compatible root and release installs, locks, overrides, lifecycle controls, graph-aware audit adapters and workflow validation together. Assert lockfile existence, versions and unchanged manifests. Preserve the synchronized pnpm security inventory until GitHub security coverage has a verified replacement; migrate action allowlists and setup pins with the workflows.
3. Migrate compatible repository scripts and Next dev/build/start execution to Bun. Audit shebangs, executable shims and subprocesses so the selected runtime is explicit. Benchmark Node versus Bun with the same bundler; investigate webpack versus default Turbopack separately. Verify shutdown, codegen, local backend sync and a complete production build.
4. Run Vitest and Playwright on Bun with their existing configurations and reports, then migrate native tests progressively from pure units through the remaining compatible suites. Preserve test discovery/counts, assertions, mocks, timers, environments, isolation, coverage and CI reports. Retain Vitest only for suites or report capabilities with recorded blockers.
5. Update the generated Vercel configuration and cutover checks, reconcile project install overrides, and assert the remote build pin. Verify Bun Functions on staging with the Clerk proxy, tenant isolation, AI search, uploads, SSR/streaming and browser flows. Rehearse a backend-compatible return to the recorded Node deployment before production adoption.
6. Remove superseded pnpm execution/setup and duplicate commands after the Bun paths pass end to end. Remove security-inventory locks only after their required protections have a verified replacement. Keep Node only where an identified tool or platform still requires it; track each exception and its revisit condition.

## Completion criteria

- Bun is the documented default for compatible installs, checks, scripts, tests, Next execution, CI and release commands; local and CI Bun versions are pinned consistently.
- Both dependency installs retain exact versions, security overrides, lifecycle restrictions and audit exception behavior.
- GitHub security updates, dependency inventory and dependency-review protections remain available; any temporary pnpm inventory is synchronized with Bun's actual graph.
- Every existing test suite remains covered, with equivalent failure/reporting behavior; no test disappears during runner migration.
- Type generation, application builds, deployment guards and browser flows pass with the selected runtime. Next's build type checks remain enabled.
- Controlled scripts do not auto-load developer dotenv files; generated release configuration preserves Bun settings and records the verified remote build version. A staging rehearsal proves the rollback behavior.
- Actual remaining Node processes and retained Vitest suites have named compatibility blockers or required capabilities. Hosted Convex and necessary framework/lint/browser tools are documented platform or tooling boundaries.
- Before/after timings and the deployment runtime's managed version policy are recorded; claims of faster app loading require separate browser/server measurements.

Most tooling can potentially use Bun. Completion means adopting every verified compatible path and documenting concrete exceptions; it does not require replacing the framework or moving hosted Convex functions to an unsupported runtime.
