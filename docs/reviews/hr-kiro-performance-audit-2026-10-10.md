# HR and shared Search performance audit — 2026-10-10

Audit of the preserved working tree after rebasing onto `origin/main` (`c64a882`). This phase makes no application, test, database, guide, or git changes. The installed Kiro CLI was invoked with `claude-opus-5.5`, `--effort high`, `--trust-all-tools`, and `--no-interactive`; its source audit and independently authored measurements were captured under `output/hr-kiro-improvement-20261010/performance/`. At the coordinator's request, Codex stopped further audit expansion after those measurements and consolidated this report; Kiro did not finish a separate final prose answer. `performance/kiro-audit.md` records that provenance explicitly.

## Evidence and limits

- Repository rules and installed Next.js 16.3.8 lazy loading, Server/Client Components, and boundary guides were read. The client provider is the correct location for a dialog dynamic import; a Server Component import does not provide the same automatic client split. Dynamic import alone does not defer a component that is immediately rendered.
- `performance/measure-baseline.cjs` uses the TypeScript AST for runtime local imports, executes the actual transpiled `format.ts`, and executes the actual extracted `loadSiteDays` and `holidayName` functions against safe asynchronous mocks. `baseline-measurements.json` records the result. No application or backend is called by this harness.
- Raw source bytes describe import reachability, not emitted bundle bytes, transfer size, or a promised bundle reduction. Shared UI and formatting already reached through HR and shell roots are excluded from the route graph's exclusive set.
- Root completed the current post-rebase production build with exit 0. `production-bundles-baseline.json` measures its `.next-build` route-entry manifests (written at 16:10 UTC), replacing the earlier artifact dated October 10 at 02:47:48. Root owns production builds, typecheck, and native T3 preview.
- No field Core Web Vitals, browser latency, Lighthouse score, database latency, or interaction time has been measured. Elapsed Node samples were deliberately excluded because concurrent audit/build work makes them unsuitable for a before/after latency claim.

Current production route-entry measurements deduplicate the JS files listed by each Next client-reference manifest. Compression is calculated locally; these are emitted file sizes, not observed network transfer. CSS, fonts, RSC/HTML, runtime queries, and later dynamic fetches are excluded.

| Route         | Initial JS chunks | Raw JS bytes | Local gzip bytes |
| ------------- | ----------------: | -----------: | ---------------: |
| Today         |                14 |      827,093 |          256,066 |
| Employees     |                14 |      844,549 |          260,695 |
| Review        |                14 |      861,450 |          264,261 |
| Period detail |                14 |      844,870 |          261,075 |

All four include `static/chunks/01swmc1twtf4b.js`, which contains the Search input and intent-resolver markers: 54,306 raw bytes / 17,695 gzip bytes. This mixed emitted chunk is baseline evidence of eager Search code, not a promise that the whole chunk can be removed.

## Ranked opportunities

### 1. Reuse bounded Intl formatter instances

**Evidence: measured deterministic operation counts.** `src/features/hr/format.ts` constructs `Intl.DateTimeFormat` inside every display helper. The current functions produce:

| Representative legal input                                          | Formatting calls | Formatter constructions |
| ------------------------------------------------------------------- | ---------------: | ----------------------: |
| Review's maximum 500 displayed date labels, Thai, weekday/short     |              500 |                     500 |
| 99 Monday–Friday employee schedules, two mounted responsive layouts |              198 |                     396 |
| 100 recorded-time cells, English, Asia/Bangkok                      |              100 |                     100 |

`workDaysLabel` constructs separate narrow weekday formatters for both endpoints of each consecutive working-day run. Date and time helpers are also used in historical period versions, attendance/correction evidence, holidays, history, and shared Search result labels. Reusing an immutable formatter by complete locale/timezone/format variant removes repeated constructor work without changing displayed values or any query.

Kiro's independent audit-only candidate comparison (`kiro-measurements.json`) checked 228 formatting outputs with zero mismatches. Warm-cache construction counts fell from 500 to zero for the Review cap, 396 to zero for 99 Monday–Friday employee schedules in both layouts, 594 to zero for non-consecutive schedules, and 310 to zero for a recorded 31-day History fixture. This demonstrates feasibility on isolated code, not a completed source change. Its scratch candidate uses an unbounded map; that shape must be bounded before acceptance in application code.

**Candidate ownership:** `src/features/hr/format.ts`, plus a new focused formatter regression test. Keep the cache bounded; include locale, timezone, and formatting variant in its key. Preserve Thai Buddhist years, English output, UTC calendar date labels, overnight time handling, `undefined` behavior, and the current failure behavior for invalid timezones. Do not cache employee data or query outcomes.

**After validation:** Replay the same harness and expect one formatter construction for each scenario's repeated unique variant in a cold cache, zero further constructions for a warm variant, and identical output for every sample. Add output equivalence across Thai/English, several zones, month/year boundaries, weekday styles, `undefined` values, and locale/timezone changes. Root validates real populated HR lists and Search date labels.

### 2. Load Search dialog code on first use

**Evidence: measured source graph and structural mount conditions.** `GlobalSearchProvider.tsx` statically imports `SearchDialog`. Across `DesktopShell`, `AppProviders`, and either the Today or Employees screen, six local runtime modules are reachable only through that import: `SearchDialog.tsx`, `results.tsx`, `useAiSearch.ts`, `matchDestinations.ts`, `recordQuery.ts`, and `resolveIntent.ts`; their combined raw source is 72,797 bytes. The provider alone reaches 32 local runtime modules. This is a source graph measurement, not a bundle saving.

`SearchBody` is already mounted only when the dialog is open, so the closed shell does **not** subscribe to Search record queries or initiate an AI request. The improvement is removal of eagerly reachable dialog/result/AI code from the initial shell path, not a claim of fewer closed-dialog subscriptions.

**Candidate ownership:** `src/components/shell/search/GlobalSearchProvider.tsx`, plus narrowly scoped Search loading/focus regression tests. Dynamically import the dialog in the client provider and render it on first use. Retain the loaded dialog wrapper after first use so its existing Radix close/focus behavior is preserved. Keep keyboard/trigger controls available immediately and ensure the first open has an accessible loading state. Consider intent-triggered preloading only after measuring the emitted split and cold-open behavior.

**After validation:** Root rebuilds and measures the initial chunk set before/after, confirms Search-specific resolver/dialog code moved to the deferred set, and records raw/gzip emitted bytes for the same routes. Targeted tests cover cold shortcut opening, AI opening, first-input focus, Escape return to opener, accepted-navigation focus, typing during loading, repeated opening, permission changes, stale records, identity changes, and Thai IME composition. Root native T3 preview validates cold opening and real search navigation. A chunk size gain must not introduce dropped input or a broken focus return.

### 3. Materialize readonly disclosure content on first expansion

**Evidence: measured current rendering/constructor counts.** `HrDisclosure` hides children with the `hidden` attribute while retaining their React subtree. That behavior is essential for forms but also applies to Review's readonly times, prior decisions, events, and correction history. `measure-readonly-disclosure.cjs` executes the actual extracted current `HrDisclosure` and `DayRequests` through React's server renderer, with harmless translation/presentation stubs and the real formatting functions:

| Fixture in an initially closed disclosure       | Rendered `li` nodes | Formatter constructions | Harness static markup bytes |
| ----------------------------------------------- | ------------------: | ----------------------: | --------------------------: |
| 1 correction × 2 history entries                |                   3 |                       4 |                       1,298 |
| Legal cap: 20 corrections × 200 history entries |               4,020 |                   4,040 |                     788,071 |

These are fixture subtree measurements, not live demo volume or route/network sizes. They show that a closed readonly disclosure can still perform substantial rendering and formatting at the supported history bounds. Defer **initial** materialization only for explicitly marked readonly existing disclosures, then retain their subtree after the first expansion. Keep form disclosures eager and mounted throughout.

**Accepted ownership:** `src/features/hr/HrUi.tsx` for an opt-in behavior; `src/features/hr/ReviewDetail.tsx` for its existing readonly details disclosure; `HrReviewCompletion.test.tsx` and new focused disclosure tests. Period detail is excluded from this implementation scope. No `DayDetailView.tsx` edit is needed: self-service evidence remains visibly expanded. Do not apply this behavior to period revision/version forms, employee/schedule forms, correction/decision forms, or any disclosure whose children publish a dirty/pending guard.

**After validation:** The same initially closed opt-in fixture should render zero correction/history list items and construct no formatter for its hidden contents. First expansion must render the complete same evidence, include incomplete-history notices and prior decisions, and remain mounted after collapse. Changing readonly props while open/closed must refresh the evidence. Controlled and initially-open disclosure cases must work, and default behavior must preserve mounted drafts/guards. Root verifies Review evidence expansion and historical period breakdown in native T3 preview. Existing dirty/pending regression suites remain required.

## Other inspected paths

- `HrAccessProvider` memoizes its value and gates its one access query until auth is ready. `HrGate` gates data content; historical period views deliberately allow frozen history under an unsupported current timezone. Removing readiness/permission gates to eliminate the startup waterfall would weaken the current behavior and is not proposed.
- Search record query arguments and result derivations are memoized. Queries are gated by record text/range and granted permissions. Record errors are isolated by a boundary; results are keyed by text/date/identity/grants. AI output is similarly invalidated by account, grants, context, cancel, and unmount. These guarantees must remain intact.
- Review performs several array passes for selection/counts/current tab. With a maximum of 500 queue items, this is a measured cap but no browser bottleneck has been demonstrated; the repeated passes rank below Intl reuse and the loading path.
- `HrDisclosure` keeps its content mounted with `hidden`, deliberately preserving form drafts and leave guards. Closed period employee breakdowns still summarize up to 50 × 31 rows and mount up to 50 employee summary rows. Readonly first-use materialization is an explicit opt-in only, never a reason to globally unmount closed disclosures or remount dirty forms.
- Employees mounts both desktop table and mobile cards and hides one by CSS. The doubled schedule formatting is included in the formatter measurement. A hydration-dependent viewport rewrite risks a layout change and is not justified by a browser measurement here.
- Backend `recentVersions` performs serial exact indexed version lookups, and period listing/name resolution also have serial loops. Changing them requires separate output/read verification and is not bundled into the three scoped candidates.
- Actual extracted `loadSiteDays` and `holidayName` safe mock execution records 28 reads for 14 dates and 62 for 31, with peak simultaneous reads of one. This establishes serial structure only. Bounded concurrency would preserve the same read count; no actual Convex operation saving or measured environment latency benefit exists here. Backend scheduling is therefore optional follow-up, excluded from the ranked implementation proposals.

## Required root preview checks

Validate first-use Search keyboard/trigger opening, input readiness while a chunk is loading, Escape focus return, accepted destination focus, Thai IME, and readable Search date labels. Validate populated Review/Employee date/schedule rendering and historical period versions. Repeat dirty/pending navigation attempts on Today, corrections, holidays, employee editing, and period revision/creation after all agents' combined changes. Keep database mutations limited to explicitly authorized fixtures; this audit itself performs none.

## Implemented result and handoff

The accepted three-item implementation was performed by the installed Kiro CLI with `claude-opus-5.5`, high effort, trusted tools, and non-interactive mode. The main implementation completed normally with exit 0, as did a subsequent narrowly approved test consequence. Prompts, transcripts, completion records and Kiro-authored reports are saved under `output/hr-kiro-improvement-20261010/performance/`. Application source and tests are frozen. The coordinator's final whole-project check passed with 234 test files and 2,814 tests, exit 0; the final production rebuild also passed with exit 0.

- `format.ts` now reuses immutable Intl formatter instances in a 64-entry LRU cache keyed by locale and all sorted formatter options, including timezone. No formatted string, query outcome, or user data is cached. Constructor failures remain uncached.
- `GlobalSearchProvider` imports the light `SearchDialogLoader`. The single existing Dialog/focus frame lives there; its heavy Search body, record results and AI implementation are imported on first open. The direct `SearchDialog` API remains a thin eager adapter for existing real-dialog tests. Loading retains typed text and caret, waits for IME composition to end before replacing the input, and supplies dismissible loading/error/retry states. A late chunk cannot reopen a closed dialog. The destination-focus logic has one implementation.
- `HrDisclosure` has a default-off `deferUntilOpen` option, used only by Review's readonly details/history. It materializes the complete subtree on first open and keeps it mounted and updated after collapse. Default form disclosure behavior remains mounted while closed. No Period detail, backend, message, or guard source was changed by this implementation.

Owned changes are the six application files (`format.ts`, `HrUi.tsx`, `ReviewDetail.tsx`, `GlobalSearchProvider.tsx`, `SearchDialog.tsx`, new `SearchDialogLoader.tsx`), three new focused test files (`format.test.ts`, `HrDisclosure.test.tsx`, `SearchDialogLoader.test.tsx`), and the initial readonly-history assertions in `HrReviewCompletion.test.tsx` and `HrSimplification.test.tsx`. The latter assertion was explicitly added to ownership after its actual failure was captured. Its follow-up diff contains exactly that one assertion; all expansion, draft, guard and write assertions are retained.

`formatter-after-measurements.json` executes both the preserved formatter source and the actual bounded implementation with fresh per-scenario caches, followed by warm repeats:

| Replayed baseline scenario      | Before constructions | After cold | After warm | Cold/warm output mismatches |
| ------------------------------- | -------------------: | ---------: | ---------: | --------------------------: |
| 500 Review date labels          |                  500 |          1 |          0 |       0 / 1,000 comparisons |
| 198 employee schedule summaries |                  396 |          1 |          0 |         0 / 396 comparisons |
| 100 recorded-time cells         |                  100 |          1 |          0 |         0 / 200 comparisons |

The same extracted initially closed readonly cap fixture falls from 4,020 rendered list items and 4,040 formatter constructions to zero of each (`readonly-disclosure-after-deferred.json`). Harness markup falls from 788,071 bytes to 453 bytes; this remains a fixture-render result, not route/network evidence. The static source graph confirms that the six Search-only modules now sit beyond a dynamic import, while the light frame/shared UI remains eager. Production chunk measurements are recorded below; no transfer, latency or CWV saving is asserted here.

Kiro's main focused batch recorded 78 passed tests and the single expected obsolete initial-history assertion failure. Existing Search and destination-focus tests passed unchanged (30/30), and related draft/pending guard suites passed (51/51). The approved follow-up captured the old assertion failing, amended it, and passed its exact regression plus the full HrSimplification/HrReviewCompletion/HrDisclosure batch (25/25, exit 0). Owned-file Prettier and ESLint checks were clean. The new loading tests cover cold shortcut opening, unchanged dialog frame, text/caret handoff, Thai IME, close-before-load and opener focus, reopen, failure/retry, AI no-action-before-asking, and mid-load identity/permission changes. New disclosure tests cover absence before opening, retention/refresh after collapse, controlled open, and default draft/guard semantics.

First-use timing detail: handed-over loading text initializes the loaded body's settled query, so that initial current-text search can run immediately at readiness. Regular post-load typing retains the existing 250 ms debounce and stale-result guard. No AI action is sent by the handoff. This detail was flagged to the coordinator's independent review; the frozen source was left unchanged.

Provenance limit: the main Kiro run also executed and filtered `tsc --noEmit` despite the prompt's prohibition on a whole-project typecheck. This was reported to the coordinator immediately and was not repeated by the wrapper or test continuation. Its owned-path result is not a substitute for the coordinator's final required checks. Kiro's `kiro-measurements-after.json` compares current code with the audit-only candidate; use `formatter-after-measurements.json` for the actual frozen-source before/after proof.

`implementation-verification.json` confirms all six application hashes still match `application-source-freeze.json`, all four preserved baseline evidence hashes match, and the approved test continuation is exactly one assertion. Root performed the final full checks and production rebuild and owns native functional QA. No source or test work remains in this performance batch.

## Final production bundle comparison

Root's final production rebuild completed with exit 0 (`root/final-build-after-regressions.log`) after the passing whole-project check. Its final manifests are dated 18:15:59 UTC; `production-bundles-after.json` was measured at 18:18:07 UTC, and the comparison was refreshed immediately afterward. Both measurement commands completed with exit 0. `production-bundle-comparison.json` independently checks sums and compares the same deduplicated route-entry `entryJSFiles` metric with the preserved 16:10 UTC baseline. This metric excludes other first-load dependencies; it is not the complete browser first-load payload. Gzip/Brotli sizes are calculated locally from emitted files.

| Route         | Raw JS before → after | Raw delta | Gzip before → after | Gzip delta |
| ------------- | --------------------: | --------: | ------------------: | ---------: |
| Today         |     827,093 → 806,622 |   −20,471 |   256,066 → 250,384 |     −5,682 |
| Employees     |     844,549 → 824,428 |   −20,121 |   260,695 → 255,078 |     −5,617 |
| Review        |     861,450 → 840,997 |   −20,453 |   264,261 → 258,564 |     −5,697 |
| Period detail |     844,870 → 824,399 |   −20,471 |   261,075 → 255,360 |     −5,715 |

Each route's entry chunk count increases from 14 to 15, while raw bytes decrease by 2.374–2.475% and local gzip bytes by 2.155–2.219%. These totals include the combined UX/UI/quality/performance changes, so the differences cannot be attributed solely to lazy Search.

The eager light frame is `static/chunks/19c-opnktcrmd.js` (12,950 raw / 4,587 gzip bytes). Its compiled dynamic-import module explicitly names `static/chunks/03cjk-fvcuus9.js`, the Search body/resolver chunk (30,027 raw / 10,484 gzip bytes). That body chunk is absent from all four route-entry sets and all four corresponding Next first-load diagnostic sets. A fresh source graph check also finds zero of the six heavy Search modules in the static runtime graph of each representative route. Shared UI and the accessible loading frame remain eager. The former 54,306-byte mixed baseline Search chunk is not directly subtractable from this split.

An `INFERRED_YEAR` string also occurs in an unrelated emitted messages chunk; marker matching alone is insufficient to identify deferred Search code. The final comparison confirms the same explicit compiled loader edge and body/resolver chunk named above. The frozen baseline JSON is unchanged, and after-build provenance correctly names the after measurement. The earlier provisional UI measurements and comparison were archived byte-for-byte as `production-bundles-provisional-ui.json` and `production-bundle-comparison-provisional-ui.json`; `provisional-ui-archive-proof.json` records their preservation.

No actual network transfer, field CWV, latency, or cold-open time was measured. These figures are from the final successful rebuild after the regression/telemetry consequences, replacing the provisional comparison. This final follow-up only read the refreshed evidence and updated this report; it made no application, test, build, browser, database, or git change.
