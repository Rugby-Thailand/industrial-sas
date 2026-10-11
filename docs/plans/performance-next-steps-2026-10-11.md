# Performance next steps — evidence before PRs

Date: 2026-10-11, Asia/Bangkok. Released reference at planning time:
`9ac5da0e5ffc681e19a7dc5ad83da5d26bb61320` (historical).

> **Phase 2 status (T00 update, 2026-10-11).** The user authorized two phases
> in order: Phase 1 is the
> [Bun and Elysia delivery plan](bun-elysia-delivery-plan-2026-10-11.md);
> this document is Phase 2 and starts after Phase 1 closes. Before any Phase 2
> experiment, freeze a **new** reference: a merged and released `main` SHA
> that contains the delivered Bun/Elysia changes and the integrated HR/Search
> work (PR #67, `1deda8f`). Re-run step 0 on that SHA. Evidence from detached
> `9ac5da0` remains historical and does not approve newer combined code. The
> only clause superseded here is the earlier Elysia deferral (see
> “Technology decisions”); every other rule in this plan stands.

## Scope and delivery rule

Improve general loading and navigation first, then the most expensive measured
interaction. Keep the existing Next/React/Convex architecture. Each candidate
gets an isolated implementation worktree and an independent test worktree.
Complete the comparison and regression gate **before creating a PR**. Open a
small PR only when the evidence supports retaining that change; merge through
the protected workflow after required checks and review pass.

This document plans application changes; it does not authorize speculative
framework migration or claim the planned tests have already passed. At the start,
the original checkout had 508 unrelated changes and was excluded. During testing
that work was committed separately as local `8b0ef53`; remote main remained
`9ac5da0`. The independent worktrees stay frozen. HR/search needs its own pinned
reference after integration; it is not part of today's released baseline.

## What the previous release establishes

The earlier production-build comparison used six locale-pooled observations per
viewport, local fixtures, no network/CPU throttling, and normal prefetch. It
establishes costs under that protocol, not production speed or causality for
every library. See `../operations/performance-evidence-2026-10-11.md` and the
scheduled job's final evidence for release verification.

| Change                                          | Evidence                                                                                                                         | Decision now                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Remove full locale imports from storage clients | Net storage decoded JS fell 107,487 B (4.2%); usable timing did not improve consistently                                         | Keep; independently verify imports and both locales                                         |
| React Compiler across the app                   | Earlier, pre-final compiler control added approximately 56 KB catalogue / 116 KB storage decoded JS; interaction benefit unknown | Compare final released head on/off; consider opt-in only if profiling supports it           |
| One TanStack Table and one TanStack Form        | Behavior/release checks passed; combined catalogue decoded JS grew 116,035 B (5.4%)                                              | Keep pilots during evaluation; do not expand yet; separate maintainability value from speed |
| Lazy optional batch editor                      | Deferred 90,123 decoded B; one cold first-open took 889.3 ms                                                                     | Keep under evaluation; measure repeated cold/warm opening and intent warming                |
| Safe product optimism                           | Server confirmation, normalization and rejection rollback verified                                                               | Keep limited to description/reference; measure feedback separately from server completion   |
| Existing barcode worker                         | Already present before this release; photo timings barely changed                                                                | Keep; no additional worker justified yet                                                    |
| Speed Insights                                  | Delivery demonstrated; hosted SDK adds 12,567 uncompressed B excluded from local comparisons                                     | Use for observation; include its real cost in a separate production-like comparison         |
| Sentry                                          | Local privacy checks passed; external delivery/source maps/alerts unconfigured                                                   | Finish configuration when actual project credentials exist; no speedup claim                |

No consistent overall loading/navigation speedup has been established. The
reported sparse search took 136 sequential continuation requests per run;
approximately 26 ms **per request** is not total search completion time.
Independent summation of the saved request durations gives median totals of
4.254 s before and 4.245 s after, with 291,296 JSON response bytes per run.
These are summed HTTP durations, not a browser completion measurement; UI gaps
can add time. Backend catalogue source did not change, so the blank-query
28.9 → 52 ms observation does not attribute a regression to frontend adoption.

## 0. Establish a trustworthy comparison — first

1. Freeze commit, lockfile, Node/browser versions, fixture manifest, test
   identity and build-time telemetry flags. Keep the telemetry flags identical
   within compiler/library controls; compare production-enabled telemetry in a
   separate experiment. Never write production business data. Run optimized production
   builds, not development builds.
2. Separate three controls: pre-release source versus released source; final
   released source with compiler on versus off; individual proposed change versus
   its immediate parent. Do not use an earlier compiler control to attribute the
   final combined change.
3. Extend the existing numeric-only harness where needed. Record usable data,
   immediate feedback, confirmed save, typing/filter latency, actual transferred
   JS, decoded JS, parse/execute work, long tasks, and render work. Record each
   query's elapsed time plus total completion time, continuation count, total
   response bytes, and measured document reads.
4. Record route-only resources at readiness and later prefetch separately.
   Distinguish browser-context freshness from route/backend/OS caches. The old
   storage run followed catalogue/product in the same context, so it was a first
   storage visit with shared resources already warm, not a fully cold route.
   Give both variants the same discarded warm-up for browser-cold/server-warm
   comparisons; measure first-server-request behavior as a separate condition. Warm
   `goto` is a reload measurement, not sidebar navigation. Include sign-in to
   usable landing, warm sidebar transitions, direct links, Back/Forward and first
   dialog opening.
5. Run samples serially with no concurrent builds or tests. Use at least ten
   timed observations per locale/viewport/cache condition for decisions; repeat in reversed
   order or alternate stable prebuilt variants to expose drift. Report individual
   samples and median/spread by locale/device, not only a pooled score. Increase
   sampling when effects overlap noise. Do not claim field p95 from a small lab.
6. First compare desktop and emulated mobile, English and Thai. Add a fixed
   constrained-network/CPU profile after verifying the harness. Physical phones
   are a separate gate for camera/decoder changes.

**Acceptance:** a reproducible command, raw numeric evidence, pinned inputs,
explicit cache/throttle conditions and a decision that another tester can repeat.
An inconclusive experiment remains inconclusive; it does not become a PR.

## 1. Decide which new frontend costs earn their place

### 1A. React Compiler — S/M

Build the final head twice with only `reactCompiler` changed. Compare compressed
route/shared chunks and production input/update workloads: catalogue filters,
product form typing, map selection and one-location inventory updates. Test
draft/focus preservation and unchanged server contracts with both variants.

If broad compilation has no repeatable interaction benefit and increases loading
cost, test annotation opt-in on only the measured hot components, using the
installed Next documentation. Compare that third variant before recommending a
configuration change. Preserve existing manual memoization until evidence supports
removal. Build duration is a separate developer metric, not user speed.

**Acceptance:** repeatable reduction in interaction work or latency that justifies
the download/execution cost, with no compatibility or important journey regression.
Otherwise retain the evidence and propose a smaller scope or disablement.

### 1B. TanStack pilots — S/M

Trace which chunks contain Table/Form and when catalogue/product prefetch brings
them in. Compare one pilot at a time with equivalent behavior; never infer each
library's overhead from the combined +116 KB result. Profile updates, validation
and subscriptions, and assess whether the interface simplifies actual maintenance.

Keep server filtering, sorting and cursor paging authoritative. Do not make
global results depend on client sorting of a single page. Keep draft listeners,
pending guards and translated server errors. Expand Table/Form only for a clear
feature or demonstrated benefit; a maintenance improvement can be accepted with
an explicit budget even when speed is neutral.

**Acceptance:** filter/search/sort/paging parity, input/focus stability, dirty state
and submit correctness, plus an attributed route cost and documented reason to
retain the pilot. Do not describe maintainability as a measured speedup.

## 2. Remove shared startup work — small independent patches

Order these from traces, beginning with costs that affect most journeys.

| Candidate                     | Implementation                                                                                                 | Verification and acceptance                                                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remaining locale reachability | Check client graphs for full bilingual catalogues; use scoped provider messages where needed                   | Both locales/accessible names unchanged; prove affected graph and actual route cost shrink                                                                           |
| Toggle animation runtime      | Prototype equivalent CSS thumb/icon/morph motion if the toggle is the shared route's avoidable Motion consumer | Controlled/uncontrolled, disabled, keyboard/touch, all sizes/variants/themes/reduced motion; browser recording parity; route chunk reduction, not whole-package size |
| Navigation permission reads   | Resolve active roles once and perform bounded permission work within the request                               | Compare read/query count and access readiness; inactive roles, duplicates, foreign rows, overflow and immediate revocation; no persistent permission cache           |
| Launch/access readiness       | Verify manifest entry and HR-only landing detour; use an access-aware valid entry only if confirmed            | Explicit return/deep links, locale, no-access, storage-only/HR-only/mixed roles; no unnecessary storage download or extra redirect                                   |
| Loading/header stability      | Distinguish unresolved access from denial, reserve selector footprint and avoid hydration-inserted controls    | Desktop/mobile layout stability, accessibility and honest loading/error states                                                                                       |

**Acceptance:** a deterministic reduction in unnecessary shared work, or an
improvement exceeding repeated run variation, with equivalent UI and authorization.
The previous translation fix is already delivered; count only additional savings.

## 3. Reduce optional route cost without delaying common actions — S/M

Trace `StorageLayoutScreens` reachability and split screens along actual routes.
Keep the primary map/list eager. Split costly optional dialogs and preview paths
only when initial traces show they are loaded needlessly. Measure the batch
editor's cold and warm first-use before changing more lazy boundaries.

Test targeted warming on pointer intent, keyboard focus or explicit touch intent
for the batch editor if it reduces the observed first-open wait. Record downloaded
bytes when intent is abandoned; warming must not issue business mutations. Do not
disable prefetch across the app. Tune individual links only when traces show
contention or unused downloads; preserve immediate navigation feedback.

**Acceptance:** lower initial transfer/execution with cold and common warm
navigation protected. Editor drafts, opener focus, Escape/cancel, submission and
error recovery must pass. A newly delayed common action fails the gate even if
initial JavaScript shrinks.

## 4. Reduce search completion work — M, after measurement

Use blank, exact-code, common-name, sparse, no-match and Thai fixtures. Measure
the full journey, not just its median request. Count examined documents, reactive
dependencies, continuation requests and total bytes on identical results.

First try existing selective indexes and eliminate repeated presentation or
authorization work **inside** a request. Then consider bounded batches of scan
work per continuation to reduce sequential round trips. Preserve the existing
one-paginated-index-page-per-request contract, not only Convex platform limits.
Any multi-page batching requires an explicit design/contract change and retained
hard read ceilings before implementation. Check both empty/no-match
and late matches. If an index/projection is necessary, prove substring/token and
Thai matching parity before schema work; maintain it transactionally and define
backfill readiness and rollback.

Keep immediate local input echo, IME behavior, existing debounce, URL history,
explicit incomplete states and stale-result cancellation. Never silently truncate
matches or widen a query until it exceeds bounded read limits.

**Acceptance:** identical complete results/order and cursor behavior; lower total
completion time or request/read cost without exceeding per-request budgets.
Permissions, account/site switches and rapid typing must still invalidate results.
A larger payload or reactive invalidation surface must be reported and justified.

## 5. Optimize the next measured feature bottleneck — M/L, conditional

- **Storage:** reuse position/placement indexes and stable geometry; narrow
  subscriptions and active-move reads. Profile commits before memoization. Test
  collision/footprint union, source/target holds, camera retention, keyboard
  precision, final drag flush and cancellation. Compare small and large fixtures.
- **HR:** after the separate work lands, baseline its final head. Replace proven
  date-by-date reads with bounded range work and request-local reuse. Verify
  totals, ordering, frozen versions, fingerprints, CSV, late edits, transfers,
  period boundaries and concurrent close/retry correctness.
- **Scanning:** keep the existing worker. Profile capture, resize, decode,
  upload/provider and lookup separately. Only move additional measured main-thread
  work. Use a held-out image corpus and physical iOS/Android checks for accuracy,
  lighting, memory, cancellation and responsiveness. Emulation cannot satisfy the
  physical-camera gate.

**Acceptance:** improvement in the demonstrated hot path with unchanged accuracy,
inventory/payroll correctness and recovery. No extra worker, virtual list or
schema change without that evidence.

## 6. Make observation useful — parallel configuration work

Collect Speed Insights samples split by route/device; measure production-like SDK
overhead separately from telemetry-off lab controls. Preserve route allowlists,
redaction, CSP and bounded relay behavior. Field telemetry is an observation tool,
not an optimization by itself.

Activate Sentry only with the actual project configuration. Verify remote test
event delivery, source-map matching/symbolication, artifact privacy and alert
routing, as well as local post-enrichment privacy tests. Do not include business
data, credentials or replay. Missing external configuration is an explicit
incomplete item, not a passed integration test.

## Test matrix and pre-PR gate

For every candidate:

1. Implement in a clean branch/worktree from a frozen reference; retain the
   untouched baseline. Add a focused regression only for a real failure seam.
2. Run the relevant unit/integration/a11y tests during development. Exercise
   translated labels, focus, mobile layout, dirty state, authorization and error
   behavior affected by the patch. Do not weaken assertions or hide flaky cases.
3. Send the candidate to an independent agent in a separate worktree. It records
   the SHA/diff, repeats the comparison and evaluates both benefits and costs.
   Agents may inspect simultaneously; performance runs remain serial.
4. Run the final candidate's required gate using the repository's delivered
   commands after the Bun migration: full aggregate checks, production build,
   dependency audit, codegen freshness, test discovery and release-contract
   checks. Preserve the guarantees of the historical `pnpm check`, `pnpm build`
   and `pnpm audit:prod` gates without restoring superseded tooling. Run the anonymous
   and workspace browser suites when affected, plus authenticated local production
   journeys for changes to real Table/Form/optimism/auth/navigation.
5. Cover English/Thai, desktop/mobile, direct and warm navigation, Back/Forward,
   server rejection/normalization, permission revocation and cancelled async work.
   Record skipped/unavailable cases with their consequence. Device-dependent
   claims remain conditional until physical-device testing is complete.
6. Fix any new correctness, privacy or accessibility failure and rerun the
   affected checks plus the final gate. If timings overlap noise, gather more
   samples or reject the performance claim. Stop a candidate that has no supported
   benefit; do not keep changing it merely to produce a PR.
7. Recheck the intended base, integrate any concurrent changes in the candidate
   worktree, and repeat affected measurements and the required final gate on that
   exact integrated SHA. Detached old-head evidence cannot approve a different
   combined version. Only now create a small PR with before/after evidence, environment, commands,
   test counts, limitations and rollback. Register it with the thread immediately.
   Required protected checks/review must pass on its exact final head before merge.
8. Use the normal staging/candidate/live release checks. Confirm behavior and
   observation after release. Revert a harmful patch through a small protected PR;
   schema/index work needs a compatible rollback/backfill plan first.

Performance acceptance is defined before each experiment. A deterministic cost
removal may qualify without a visible latency change if no journey worsens.
Otherwise require repeated paired improvement beyond variation. Any repeatable
regression on an important journey is investigated before approval; do not hide
it behind an aggregate average or an arbitrary percentage threshold.

## Technology decisions

Use the existing partial Table/Form adoption and Convex reactive client. Consider
TanStack Virtual only for measured large-DOM cost; Query only for a real client
HTTP-cache requirement; Pacer for a measured scheduling/queue problem; Store for
a concrete shared-state problem. Charts/Hotkeys need a product feature first.
Defer TanStack Start/Router, a database migration and experimental Next
cache/prefetch changes until a separate architectural requirement justifies them.

**Superseded (T00, 2026-10-11):** this plan originally also deferred Elysia.
The user has since authorized Elysia for typed AI/integration HTTP contracts
under Phase 1 ([delivery plan](bun-elysia-delivery-plan-2026-10-11.md), T02 and
T11–T16). That supersedes only the Elysia deferral. Phase 2 does not introduce
Elysia changes of its own, and must not attribute Phase 1 tooling, runtime or
token-flow gains to Phase 2 browser optimizations.

## Independent testing in this planning session

Completed runtime report: [independent report](../reviews/independent-report.md)
(copied from the `industrial-sas-independent-perf-20261011` worktree by T00).
Its raw distributions/control evidence (`out/performance/independent-summary.json`
and companions) stay in that worktree's ignored `out/` directory and are not
part of the repository. The read-only measurement review
(`docs/reviews/performance-methodology-2026-10-11.md`) remains an uncommitted
file in the `industrial-sas-performance-plan-20261011` worktree, outside this
delivery; its findings are summarized below.

Two agents were dispatched: one runs final-head compiler controls and targeted
behavior verification in `industrial-sas-independent-perf-20261011`; the other
audits measurement/backend semantics read-only.

The completed read-only review independently summed the old sparse-search
artifacts and found the approximately 4.2-second request chain above. It also
confirmed that the earlier compiler fixture used 133 continuations rather than
the final fixture's 136, the storage cache label was too broad, and the catalogue
byte count included prefetch. These findings drive the corrected measurement
requirements; they do not establish a new implementation speedup.

The independent tester completed:

- Four targeted files / 93 passing tests (Vitest; not the Next compiler transform).
- Two passing optimized production builds, with only the compiler flag changed.
- Six actual authenticated flows **per compiler setting**, 12 total. These cover
  Table/Form search, paging, sorting, draft recovery and confirmed saves across
  English/Thai desktop/mobile; lazy-editor focus; and real Convex optimism
  confirmation, normalization and server rejection rollback.
- A matched A → B → B → A series: 480 numeric rows, ten observations per
  language/viewport/compiler setting, with 127 products fixed throughout. This
  fixture differs from the earlier release's 129 products, so it isolates the
  final-head compiler rather than remeasuring the whole release before/after.

Observed same-origin decoded JavaScript, including normal observed prefetch:

| Journey                               | Compiler on, B | Compiler off, B | Added with compiler, B |
| ------------------------------------- | -------------: | --------------: | ---------------------: |
| Catalogue                             |      1,433,344 |       1,376,639 |                 56,705 |
| Storage first visit/shared cache warm |      1,627,744 |       1,511,554 |                116,190 |

This confirms bundle cost on the exact released source. It does not establish
compressed network savings or fewer/more React renders. Cold catalogue block
medians were 1,338.7 → 1,027.5 → 955.7 → 940.6 ms across A → B → B → A, revealing
large chronological drift rather than a stable compiler loading effect. A local
input-to-two-animation-frames probe is not isolated render CPU or field INP.
The compiler's meaningful update benefit remains unproven and needs profiling
before deciding broad disablement versus selective opt-in.

The matched fresh sparse-search fixture needs 134 sequential requests and
290,684 JSON response bytes per run. Median summed request time is 3,988.7 ms
with the compiler and 3,780.3 ms without. Backend code/deployment is identical,
so this variation is not a compiler-caused backend gain. Both variants preserve
the several-second request chain. This is the strongest next search investigation.

A fresh lazy-editor observation again defers 90,123 decoded bytes, with one cold
open at 953.5 ms. One observation does not establish a distribution. All
fixture-mutating behavior checks were excluded from the matched timing sequence;
earlier trials are retained separately.

The full repository gate was not rerun for this planning-only session. It remains
mandatory on the exact integrated implementation candidate before creating a PR.
No new application PR has been created.

## Phase 2 ledger

Update at every state transition. States follow the Phase 1 delivery plan
(PLANNED → … → DONE, plus EXCEPTION/CONFIGURATION_PENDING).

| Item                                 | State   | Reference / evidence                                                                                                                   |
| ------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 2 start gate                   | BLOCKED | Waits for Phase 1 closure (T20) and a new merged/released reference containing Bun/Elysia and HR/Search                                |
| HR/Search integration                | MERGED  | PR #67 `1deda8f`; production `RELEASED` via `ca8c296` and `9675ae7` (T00 [baseline](../reviews/bun-elysia/T00/baseline-manifest.json)) |
| Historical `9ac5da0` evidence        | HISTORY | [Independent report](../reviews/independent-report.md); does not approve newer code                                                    |
| 0. Trustworthy comparison            | PLANNED | Re-run on the new frozen reference                                                                                                     |
| 1A–1B. Compiler / TanStack decisions | PLANNED | —                                                                                                                                      |
| 2–6. Candidates and observation      | PLANNED | —                                                                                                                                      |

No Phase 2 PR exists. Phase 1 T00 documentation [PR #70](https://github.com/Rugby-Thailand/industrial-sas/pull/70) is DONE: merged as `77ae110` and released to production through the automatic pipeline. It delivers no Bun/Elysia runtime. Phase 1 T01 (pinned Bun standalone type checker) has passed final local audits/checks on base `77ae110`; independent exact-commit comparison, Linux CI and delivery remain pending. Phase 2 remains waiting for the full Phase 1 release gate.

## Execution workflow for Phase 2

Every Phase 2 task follows the same required delivery cycle as Phase 1: recheck
Kiro model availability; implement with `claude-opus-5.5 --effort high`; Codex
independently audits standards/specification and fixes findings; Kiro uses the
same model/effort for a scoped refactor (a report that no refactor is justified
is acceptable); Codex audits the final implementation and runs the required
checks. Performance candidates additionally need an independent comparison in a
separate worktree before a PR. Timed comparisons run serially. Never silently
substitute a model.

Resolve the pre-PR gate commands (test-matrix step 4) from the final delivered
package scripts and CI policy,
recording exact commands and runtime versions for each candidate. Expected Bun
script entry points are `bun run check`, `bun run build`, `bun run audit:prod`,
`bun run ci:codegen` and `bun run ci:test-discovery`; verify that they actually
exist and preserve full coverage rather than adding aliases merely for this
plan. Audit both locked app/release scopes through their delivered guarded
policy. Release-contract coverage includes environment, entrypoint, orchestration,
API, browser release safety and workflow validators; the aggregate must still
execute those tests. Re-run affected authenticated/browser flows and all mandatory
gates on the exact integrated candidate before PR creation. Register each PR
with T3 Code, wait for protected checks and required review, match the audited
SHA to the head, merge normally and verify automatic staging/production release
before dependent work.

Each ledger entry records acceptance defined before the experiment, frozen
fixture/version/cache/telemetry conditions, source and audited SHAs, commands,
raw samples, independent result, test results, PR URL, merge SHA, release
outcomes and rollback. New integration or any candidate edit invalidates
earlier approval evidence; repeat affected comparisons and mandatory gates.
