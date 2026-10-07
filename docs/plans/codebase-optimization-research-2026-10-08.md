# Codebase optimization research — 2026-10-08

Research baseline: commit `278292a15c57dd519c4c49534273cb1512051a29`, inspected in the isolated `industrial-sas-optimization-20261008` checkout. The original checkout changed during the investigation, so earlier observations must not be combined into a benchmark. This note records source guidance and experiment hypotheses; it does not establish that any proposed change improves this application.

The pinned stack is Next.js 16.3.6, React 19.2.8, Convex 1.43.0, Clerk Next.js 7.7.4, TypeScript 6.0.3, Tailwind 4.3.3, next-intl 4.13.4, Vitest 4.1.10 and Playwright 1.62.1. Versions and scripts are recorded in [package.json](../../package.json). Installed Next.js documentation is the compatibility authority for this checkout, as required by [AGENTS.md](../../AGENTS.md). Public documentation can describe newer releases: the inspected React site labels itself 19.3 and the Vitest site includes a 5.0 migration guide.

## What the repository already does

- Catalogue reads use native range cursors, bounded scan helpers, summaries and tenant-scoped access. Request-scoped repeated document reads are already shared by [queryDocumentReader.ts](../../convex/lib/queryDocumentReader.ts), with [integration coverage](../../tests/integration/query-cache.integration.test.ts). These are existing optimizations, not new work to claim.
- Barcode camera libraries already load through `import()` inside [useBarcodeCamera.ts](../../src/features/finishedGoods/useBarcodeCamera.ts) and [DestinationScanner.tsx](../../src/features/finishedGoods/DestinationScanner.tsx).
- [RouteMessages.tsx](../../src/i18n/RouteMessages.tsx) and [clientMessages.ts](../../src/i18n/clientMessages.ts) already select translation namespaces for the shell and routes.
- [vitest.config.mts](../../vitest.config.mts) has separate unit, accessibility, property, Convex runtime, integration and isolation projects. However, the unit project places all `src/**/*.test.{ts,tsx}` and `convex/model/**/*.test.ts` in jsdom and runs [vitest.setup.ts](../../vitest.setup.ts), including React cleanup, Convex mocks and accessibility matchers.
- Playwright is installed, but this baseline has no tracked Playwright configuration or E2E specifications. Comments mentioning screenshot or narrow-screen coverage are not proof that those checks currently run.
- [WebVitals.tsx](../../src/components/system/WebVitals.tsx) reports through an observability port whose available sinks are `none` and `console`; [port.ts](../../src/lib/observability/port.ts) does not provide durable field telemetry.
- The live [extractJobTicket action](../../convex/finishedGoods/jobScans.ts) sends a job-ticket image to OpenRouter, requests a strict JSON schema, uses temperature zero and retries one HTTP 5xx response immediately. It does not set an explicit fetch deadline or record a representative accuracy/cost benchmark. The separate [model module](../../convex/model/finishedGoods/jobScans.ts) owns parsing and the prompt.

## Convex: constrain work before adding frontend memoization

**Established guidance.** Index conditions narrow the documents considered; a subsequent filter still examines the documents in that range. Compound-index fields must be constrained in their declared order. Index changes also affect ordering and deployment backfill, so a prefix index is not automatically redundant when queries require a different sort order. [Convex indexes](https://docs.convex.dev/database/reading-data/indexes/)

Convex recommends collecting only small result sets. Broad collections increase database bandwidth and dependency sets, which can trigger query reruns or mutation conflicts. Pagination or maintained aggregates are alternatives for growing datasets; the documentation's example of 1,000 documents is guidance, not a universal safe limit. [Convex best practices](https://docs.convex.dev/understanding/best-practices)

Native pagination supports `maximumRowsRead` and `maximumBytesRead`; an output page size alone does not bound every scan. Those options exist in the installed [Convex pagination source](../../node_modules/convex/src/server/pagination.ts). The app's custom tenant/cursor helpers must preserve continuation behavior before adopting them. [Convex pagination](https://docs.convex.dev/database/pagination)

`useQuery` subscribes reactively, updates its component when the result changes and manages subscription lifetime. Passing `"skip"` disables the query without violating hook ordering. One-off reads are available through `useConvex().query()`. A newly allocated argument object with unchanged serialized values is not sufficient evidence of subscription churn: the installed [React client](../../node_modules/convex/src/react/client.ts) keys its query memoization on serialized arguments, query name and skip state. [Convex React API](https://docs.convex.dev/api/modules/react)

**Application hypotheses.** Measure high-traffic catalogue hydration, job-scan location search and simultaneously mounted summary/detail subscriptions first. `searchLocations` currently filters and slices after reading warehouse zones; whether that is worth changing depends on actual zone cardinality and read cost. Replacing substring search with a prefix or token index changes semantics and must not be presented as an equivalent optimization. Smaller response projections can reduce browser transfer and rerenders, but projecting fields after reading a document does not by itself establish reduced database reads.

**Evidence needed.** Use fixed synthetic tenant/warehouse sizes and repeat the same user journey. Record rows/documents read, database read/write bytes, query executions and duration, response bytes, and browser WebSocket bytes/update counts separately. Convex exposes execution-time and database-I/O counters in log-stream events; plan availability must be checked before depending on that integration. Browser traffic is a user-experience metric and should not be equated automatically with a current billing line item. [Convex usage attribution](https://docs.convex.dev/platform-apis/track-usage)

Correctness checks should cover tenant separation, warehouse scope, permissions, stable ordering, page boundaries, cursor tampering, repeated reads and changing data. Denormalized summaries need invariant tests for every mutation that changes their inputs. The existing request-scoped document cache must stay inside one authorized query snapshot; extending it across requests or mutation writes needs a different correctness argument.

## Next.js: measure the actual module graph and preserve tenant boundaries

**Established guidance, checked against installed docs.** A `"use client"` boundary pulls its imports into the client graph. Keep noninteractive rendering server-side when that removes real browser work; provider placement and server-rendered children can keep boundaries narrow. This does not make interactive Convex consumers server components. [Installed server/client guide](../../node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md)

Installed 16.3.6 supports experimental `next experimental-analyze --output`, which exports Turbopack analysis under `.next/diagnostics/analyze`. Webpack uses the separate `@next/bundle-analyzer` plugin. Select the analyzer that matches the measured build. `lucide-react` is already optimized by default, so adding it to `optimizePackageImports` is not a demonstrated win. [Installed package-bundling guide](../../node_modules/next/dist/docs/01-app/02-guides/package-bundling.md), [installed import optimization reference](../../node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/optimizePackageImports.md)

Conditional dynamic imports can defer client components and optional libraries. The installed guide warns that dynamically importing a client component from a server component does not currently provide automatic client code splitting; `ssr: false` belongs in a client component. A separate chunk rendered immediately is not the same as delayed network work. [Installed lazy-loading guide](../../node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md)

**Application hypotheses.** Use route-specific import chains to find expensive optional panels, QR/print paths and motion/UI packages. Large source files are inspection leads, not evidence of large delivered bundles. Preserve camera imports already deferred. Compare initial compressed JavaScript, parse/evaluation cost, route navigation and first use of the deferred feature; a smaller initial bundle can move latency to a frequently used action.

next-intl supports server-rendered labels and selectively passing messages to client providers. Its documentation recommends measurement because serializing messages contributes to page markup and client work. Existing route namespace selection means further splitting is justified only by a measured message payload or parsing problem. [next-intl server/client guidance](https://next-intl.dev/docs/environments/server-client-components)

**Caching is a separate, higher-risk hypothesis.** `cacheComponents` is not enabled in [next.config.ts](../../next.config.ts). Enabling it changes prerendering and request-read requirements. In the installed documentation, plain `use cache` cannot read cookies/headers; session-derived cached functions receive explicit identifiers after authorization. Arguments and tags are stored in plain text. `use cache: private` can deduplicate matching calls within a production request and retain rendered output in browser memory, but does not store results in a cross-request server cache. [Installed authentication/caching guide](../../node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md), [installed private-cache reference](../../node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache-private.md)

For this application, cache keys must preserve every relevant tenant, warehouse and authorization dimension. Sign-out, organization switching, permission revocation and Convex updates need an explicit invalidation/freshness model. A Next cache does not automatically inherit Convex's reactive update semantics. Do not add a second cache solely because the framework supports it.

## React: profile a compiler trial instead of blanket memoization

**Established guidance.** React Compiler automatically memoizes eligible components and values. React recommends retaining existing manual memoization or testing carefully before removing it, since removal can change compiler output. Profile genuinely expensive work before adding complexity. [React Compiler introduction](https://react.dev/learn/react-compiler/introduction)

Incremental adoption supports annotation mode with `"use memo"`, exclusions with `"use no memo"` and runtime gating. A small trial can validate behavior and compare performance before broader adoption. [React incremental adoption](https://react.dev/learn/react-compiler/incremental-adoption)

The installed Next `reactCompiler` option supports annotation mode; the standard implementation needs `babel-plugin-react-compiler`. The native Rust implementation appeared in Next 16.3.0, remains experimental, requires Turbopack and throws with Webpack. Since this repo's `dev:web` uses `--webpack`, enabling Rust compilation globally is incompatible with that script. Compiler adoption and changing bundlers are separate experiments. [Installed compiler reference](../../node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/reactCompiler.md), [installed Rust compiler reference](../../node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/turbopackRustReactCompiler.md)

**Evidence needed.** Profile the same filter, select, scan and panel interactions before/after a compatible opt-in compiler trial. Compare commit counts and `actualDuration`, interaction latency, CPU/heap behavior and build duration. React profiling adds overhead and is disabled in normal production builds; compare equivalent profiling builds, then confirm user-facing results in an ordinary production build. [React Profiler](https://react.dev/reference/react/Profiler)

Compiler optimization cannot remove broad database subscriptions or expensive work outside the eligible React graph. Preserve behavior tests for effect dependencies, controlled inputs, stale closures and external-store updates. Fewer renders alone are not a sufficient benefit if the user interaction is unchanged.

## Testing: protect expensive failures and measure test overhead

**Established guidance.** Vitest distinguishes Node execution from jsdom's browser emulation and edge-runtime emulation. Pick environments according to the APIs exercised. [Vitest environments](https://vitest.dev/guide/environment.html)

Vitest recommends inspecting runtime phases before changing worker pools, parallelism or isolation. Reducing isolation can reduce startup/import cost, but it changes shared-state behavior. The current website also documents `vitest doctor` and experimental diagnostics; neither was found in this installed 4.1.10 CLI/type surface, so this plan does not depend on those newer features. [Vitest performance guidance](https://vitest.dev/guide/improving-performance.html), [installed Vitest CLI](../../node_modules/vitest/dist/cli.js)

**First measurable hypothesis.** Move genuinely pure domain, policy, parsing and utility suites to a Node project with minimal setup. Keep DOM/component/accessibility tests in jsdom and Convex runtime tests in edge-runtime. Classify by imports and behavior, not just `.ts` versus `.tsx`: browser storage tests can need jsdom despite using a `.ts` extension. Keep isolation initially because the existing global Convex mocks and DOM stubs make a blanket `isolate: false` change hard to justify.

Compare multiple runs with fixed worker settings and no competing build process: wall time, setup/environment/import phases where available, memory and test-file/test counts. Every prior suite must still run exactly once. Avoid claiming a faster project-specific run is a faster full test suite.

`convex-test` is useful for function logic but is a mock: it does not enforce real size/time limits and simplifies runtime/search behavior. Validate performance, real limits and client/backend interactions against a disposable real backend as a separate check. [convex-test limitations](https://docs.convex.dev/testing/convex-test), [Convex real-backend testing](https://docs.convex.dev/testing/convex-backend)

Playwright advises isolated tests that assert user-visible behavior with resilient locators. Its `webServer` configuration can start the app's configured command. For this repo, a proposed release check should build Next and use `next start` with isolated synthetic tenant fixtures; reusing a development server cannot establish production performance. [Playwright best practices](https://playwright.dev/docs/best-practices), [Playwright web-server configuration](https://playwright.dev/docs/test-webserver)

**Our ROI heuristic, not an upstream prescription.** Prioritize tests where expected avoided loss exceeds creation, maintenance and execution cost: tenant/permission leakage, duplicate writes, inventory invariants, cursor correctness and scan/save recovery. Add regression coverage for a demonstrated defect or changed behavior. A small production-browser journey covers auth, organization switching, filter/navigation state and one idempotent write that mocked unit suites cannot validate together. Do not add tests that merely repeat the implementation of a reversible cosmetic change or use coverage percentage as the optimization target.

## TypeScript and Tailwind: diagnose existing tooling before replacing it

TypeScript's `--extendedDiagnostics` describes overall compile cost; `--generateTrace` provides event/type traces for deeper analysis. First measure file inclusion, parse/check time and memory, then investigate expensive types or generated-file pollution. [TypeScript diagnostics](https://www.typescriptlang.org/tsconfig/extendedDiagnostics.html), [TypeScript tracing](https://www.typescriptlang.org/tsconfig/generateTrace.html)

Installed Next defaults to calling the project-local TypeScript CLI and checks the complete configured project, including tests and generated development route types when included. Stale `.next*` references after branch changes are a reproducibility issue; a clean isolated build distinguishes those from source defects. Keep type checks enabled and current strictness intact. A TypeScript 7 migration requires a separate compatibility/performance study, not an assumed overnight win. [Installed TypeScript CLI reference](../../node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/useTypeScriptCli.md), [tsconfig.json](../../tsconfig.json)

Tailwind 4 scans source text and automatically excludes certain paths. Explicit source roots can narrow scanning, but removing paths can drop classes; dynamically concatenated utility names are not statically detectable. [Tailwind class detection](https://tailwindcss.com/docs/detecting-classes-in-source-files)

**Conditional hypothesis.** If CSS output or scan time is material, inspect whether docs, fixtures or previews introduce unused utility tokens. Measure production compressed CSS and build time before narrowing sources, then check every visual route, locale, theme and state. Keep complete static class names and required external component sources. No Tailwind migration is needed: the app already uses v4.

Clerk documents that `currentUser()` calls its Backend API and consumes rate limits; `auth()` exposes server-side authentication state. Audit redundant full-user calls only if profiling identifies them and the narrower session data is sufficient. Preserve server/backend permission enforcement and avoid forwarding the full user object to clients. [Clerk currentUser reference](https://clerk.com/docs/reference/nextjs/app-router/current-user), [Clerk auth reference](https://clerk.com/docs/reference/nextjs/app-router/auth)

## AI extraction: accuracy and accepted-result cost come first

**Established guidance.** OpenRouter structured-output support is endpoint-dependent and can change; `strict` enforcement varies by provider. Its routing guidance describes `require_parameters: true` for compatible endpoints. Schema conformance does not establish that text, dates, identifiers or quantities were read correctly. [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)

Task-specific evaluations need representative inputs, independently checked ground truth and metrics aligned to the actual task. Include failures and calibrate automatic scoring with human review. Use the methodology, not a provider-specific platform dependency: the current OpenAI guide also announces retirement of its Evals platform during October–November 2026. [Evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices)

**Application hypothesis, deferred behind deterministic improvements.** Create a portable, offline fixture harness for the existing parser and a separately bounded paid evaluation of the real action if representative labeled tickets and spending authorization exist. Include Thai text, Buddhist-era dates, glare, rotation, blurry images, empty fields and similar order/barcode identifiers. Hold out tickets before tuning the prompt.

Record field-level normalized accuracy, exact order/barcode accuracy, numeric/date errors, whole-ticket acceptability, correction time, schema/parse failures, latency distribution, tokens, cost and retries. Use cost per correctly accepted ticket rather than cost per API call. Temperature zero is not evidence of deterministic correctness. Compare model, image size and prompt changes one variable at a time; reject savings that worsen critical-field accuracy. Do not guess current model availability or pricing from a model string in source.

Deterministic failure tests can justify a small boundary extraction around the current action: timeout/network rejection, 5xx-then-success, repeated failure, malformed JSON, missing choices and unsupported structured output. A configurable deadline, retry backoff or stricter endpoint routing should be a separately tested behavior change. This research did not send images, call paid inference, change provider settings or alter retry behavior.

## Evidence required to call an optimization worthwhile

This is our proposed decision protocol, not a vendor guarantee:

1. Pin the commit, lockfile, Node/pnpm versions, environment, bundler and fixture sizes. Establish a clean passing baseline before attributing failures or gains.
2. State one falsifiable hypothesis and the primary metric it should improve. Capture baseline data and estimate implementation, maintenance and regression cost.
3. Make one reversible change. Run checks for its affected behavior, then the required full release checks.
4. Repeat the same workload on equivalent conditions. Separate cold/warm runs and end-to-end timings from individual phase timings; a handful of local samples is not production percentile evidence.
5. Keep the change only when the benefit is larger than observed noise and matters to user latency, operating cost or developer feedback time, with no correctness or secondary-metric regression. Otherwise revert it and record the negative result.

Research makes a change plausible. A before/after artifact plus preserved behavior makes it defensible. No deployment, migration, production-data extraction or paid inference was performed for this research.
