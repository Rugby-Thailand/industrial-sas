# Codebase optimization plan — October 8, 2026

Target finish: **October 9, 2026 at 07:00 Asia/Bangkok**
(`2026-10-09T00:00:00Z`). Deliver worthwhile changes sooner if the measured
backlog is exhausted; do not manufacture refactors to fill the time.

## Scope and ownership

Research each candidate, measure the existing behavior, decide whether the
benefit warrants the work, implement a small experiment, test it, and retain
only demonstrated improvements. The user subsequently authorized implementation,
focused refactoring through **Kiro CLI / claude-opus-5.5**, independent Codex
verification, opening a PR, and merging it after passing checks.

Use `/Users/macbook/Development/industrial-sas-optimization-20261008`, branch
`codex/optimization-2026-10-08`, starting at `278292a`. The original checkout
changed revisions during research; leave its existing work and local generated
files alone. Kiro handles scoped edits; Codex owns measurement, review, checks,
and GitHub delivery. Read installed Next guides before changing framework code.

## Actual stack and starting evidence

- Node 24, pnpm 10.33.2, Next 16.3.6, React 19.2.8, TypeScript 6.0.3.
- Convex 1.43.0 with Clerk organizations, tenant-aware accessors, indexed
  pagination, and maintained finished-goods summaries.
- Tailwind 4, Radix, next-intl Thai/English, SVG storage scenes, ZXing scanning,
  UploadThing, and OpenRouter job-ticket extraction.
- Vitest 4.1.10, Testing Library, convex-test, fast-check, axe, and an installed
  Playwright dependency. No checked-in Playwright configuration or browser specs
  exist at this revision.
- The initial standalone suite passed **126 files / 1,064 tests**, with a
  26.34-second Vitest duration and 27.54-second process duration. This is one
  local observation, not a reproducible benchmark or CI comparison.
- The original checkout's combined check stopped during TypeScript checking on
  generated `.next` / `.next-build` types for removed routes. Its HEAD changed
  during that run. First establish a clean baseline in the isolated checkout.
- Web Vitals are wired up, but the checked-in observability port supports only
  `none` and `console`; there is no durable field-performance history.
- Camera libraries already load on demand; translation namespaces are already
  route-scoped; query-local document read reuse and read-budget tests already
  exist. Verify these before proposing more work in those areas.

## Ranked experiments

| Order | Candidate                                    | Why investigate                                                                                               | Decision and verification                                                                                                                                                                      |
| ----- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Reproducible checks                          | Changing revisions and stale generated types make comparisons unreliable                                      | Frozen-lockfile install in an isolated checkout; capture clean check, build, and timing results before edits                                                                                   |
| 1     | Separate pure tests from DOM setup           | Pure domain/helper tests currently create jsdom and import React/Convex/axe setup                             | Move eligible tests to Node without losing test discovery or changing assertions; preserve `test:unit` behavior; compare three equivalent suite runs                                           |
| 2     | Reduce derived map work                      | Repeated position/geometry derivation can scale with visible locations and interaction frequency              | Profile representative scenes first; Kiro extracts a concise derivation seam only if duplication/work is verified; preserve pointer, keyboard, selection, collision, and geometry behavior     |
| 3     | Reduce remaining Convex read/payload fan-out | Some scene/occupancy paths still read large scoped collections; list pages already have several optimizations | Extend existing read-budget fixtures, measure response bytes and reads, then change one hot path; preserve authorization and full occupancy semantics                                          |
| 4     | Load optional UI only when needed            | Large client screens contain optional previews/dialogs                                                        | Analyze route bundles using installed Next tooling; defer a measured optional subtree; compare initial JS and interaction readiness                                                            |
| 5     | Compact duplicated feature logic             | Several feature/workflow modules remain large                                                                 | Extract a cohesive operation with real callers; justify by removed duplication and reduced change surface; file size alone is insufficient                                                     |
| 6     | React Compiler                               | Automatic memoization may reduce expensive rerenders                                                          | Controlled compatible compiler experiment after profiling; compare render work and build cost before deciding; experimental Rust compiler is incompatible with the current webpack dev command |
| 7     | AI extraction cost/reliability               | Ticket action has schema validation and a retry; accuracy is essential                                        | First create representative human-checked fixtures and mock failure tests; defer paid model/image-quality comparisons until cost and quality can be measured                                   |

Do not add generic caching around tenant data or replace the current stack as
an optimization. Check installed-version semantics, authorization scope, and
freshness for every proposed cache. Dependency removal requires proof that no
runtime, CLI, test, or deployment path uses the package.

## Is a change worth implementing?

These are proposed project decision rules, not vendor guarantees:

1. Record the affected user/developer workflow, its frequency, the baseline,
   the expected gain, and the regression risk before writing code.
2. Prefer a recurring bottleneck that can be improved in one reviewable patch.
   Estimate developer time saved over 30 days, or reads/bytes/latency saved per
   normal operation. Record assumptions when usage and billing data are absent.
3. For noisy timings, use the same machine, dependency lockfile, fixtures,
   worker settings, and cache conditions; run sequentially and compare at least
   three observations. Retain changes only if the improvement exceeds observed
   run-to-run variation. A 10% suite improvement or 20% hot-path improvement is
   a useful initial target, not a reason to overclaim small samples.
4. For deterministic costs, count actual document reads, derived geometry calls,
   response bytes, or initial-route JS. Keep full results and access controls.
5. For a maintenance refactor, show the duplicated operation eliminated, the
   simpler caller interface, and behavior checks. Shorter code that hides rules
   or adds indirection has negative value.
6. If the benefit is absent, too small, or offset by risk, discard only the
   experiment's owned edits and record the result. Keep the measurement.

## Which tests are worth the cost?

Keep and extend tests for tenant/warehouse isolation, revoked access, mutation
retries and request identity, placement/collision rules, summary consistency,
cursor/filter boundaries, and the Thai/English UI behaviors affected by a change.
These protect outcomes where a regression is expensive.

Use Node for pure functions; jsdom and Testing Library for interactions;
convex-test for adapter/index behavior; existing property tests for geometric
invariants; and a small production-build browser smoke suite for real routing,
hydration, focus, layout, and async Server Components. Installed Next guidance
does not support testing async Server Components directly with Vitest.
[Next Vitest guide](https://nextjs.org/docs/app/guides/testing/vitest)

Avoid coverage-percentage targets, snapshots of implementation details, or tests
that merely repeat a reversible style change. A regression test should fail
for the actual old bug or enforce a meaningful cost/behavior contract. Preserve
test isolation and browser cleanup while reducing unnecessary environment work.
[Vitest performance guide](https://vitest.dev/guide/improving-performance.html)

## Execution loop

1. Pick the highest-value measured candidate and read its official/installed
   guidance. Timebox initial investigation to about 30 minutes.
2. Write the hypothesis, scope, acceptance test, and measurement in a run log.
3. Let Kiro Opus 5.5 perform the bounded edit/refactor. Keep edits cohesive and
   readable; preserve error states, units, locale behavior, and authorization.
4. Codex reviews the diff, runs targeted checks, and compares the measurement.
   Reject unsupported improvements; fix real regressions before moving on.
5. Run the combined suite, production build, and production dependency audit
   for the retained patch. Use focused formatting checks for touched files;
   report any pre-existing repository-wide format failures separately.
6. Open and link the PR to the T3 thread, report evidence, wait for required CI,
   inspect the final diff against current main, and merge only passing work.
7. Reassess the backlog after each accepted or rejected experiment. Stop on
   exhausted worthwhile candidates, unresolved prerequisites, or the deadline.

Do not start another experiment after **06:00 Bangkok on October 9**. Reserve
the remaining hour for final verification and a report of accepted/rejected
changes, measurements, PRs, and remaining limitations. Bound external calls and
subprocess runs so a single hung task cannot consume the deadline.

## Overnight execution feasibility

An active T3/Codex session can carry out these steps, but this session exposes
no native T3 scheduling tool, so scheduling or guaranteed resumption has not
been established. A local runner needs the Mac powered on, network access,
working CLI authentication, and the process kept alive. `codex exec` supports
scripted jobs and JSONL logging; a sequential runner can persist state after
each cycle and enforce the deadline. A successful finished patch does not need
to wait idle until morning.
[Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)

ChatGPT desktop scheduled tasks are a separate supported option for local
projects/worktrees and require the computer on and app running. Their presence
does not establish availability in T3 Code.
[Scheduled tasks](https://learn.chatgpt.com/docs/automations)

## Completion evidence

Store a concise review record under `docs/reviews/` with base/final revisions,
the Kiro model, exact commands, pass/fail outcomes, before/after observations,
discarded ideas, and PR outcome. Keep detailed transient logs in `.cache/`.
Research references live in
`docs/plans/codebase-optimization-research-2026-10-08.md`.
