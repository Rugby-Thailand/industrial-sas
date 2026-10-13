# Navigation guard and reuse delivery — 13 October 2026

Implementation and merge were authorized by the user's subsequent instruction. [PR 87](https://github.com/Rugby-Thailand/industrial-sas/pull/87) merged as `2d164bc3`; the follow-up is [PR 88](https://github.com/Rugby-Thailand/industrial-sas/pull/88). The original checkout and the original plan worktree's untracked plan were preserved. Implementation used the separate `navigation-guard-reuse` worktree.

## Implemented behavior

- Save and continue now belongs to the guard owner, rather than a stale React action closure. A successful save covers its current registration only. Other dirty/pending work, or an observable clean-to-dirty renewal of the saving registration, keeps navigation behind a fresh decision. False/rejected saves preserve the prompt and draft.
- Deferred buffer removal rechecks current registrations. New requests invalidate an older approval even if the old decision covered unchanged registrations. Disconnect invalidates the earlier connection's save/intent/traversal; reconnect cannot replay its action or consume the next Back as an old completion.
- A same-page push/replace that overtakes removal cancels the old action and retains draft protection. For the Chromium push race, restoration first visits the known old buffer adjacent to its base, then uses the existing bounded traversal. No timer, fabricated popstate, Next router tree, new dependency, or larger correction limit was introduced.
- `useMediaQuery` replaces three subscription implementations. Domain wrappers, false server snapshots, same-list listener cleanup, stable subscriptions, viewport thresholds (1023/580/1099/850/1399), and Floor container measurements are preserved. This is code reuse, not a measured route-speed optimization.
- Owned buffer marker/URL/unknown-or-known depth now form one nullable private record. Orphan and overtaken entries keep separate lifetimes. Old coordinated fields and reset blocks are removed.
- The isolated Next regression app imports the production guard, history/query modules, Floor view hook, HR criteria hook and locale adapter. CI requires its production build and Chromium/Firefox/WebKit runs. Its fixtures remain outside shipped routes.
- Existing local performance tools now collect bounded samples and distinguish observed URL timing from actual loaded data readiness. They retain cancellation/error timing and fixed reasons, build/source provenance and numeric results without production telemetry or sensitive payloads.

## Evidence and review

The independent provider suite had 5 passing / 14 failing cases against `abc1e8e4`; all 19 pass with the correction. Additional lifecycle and native-regression controls are maintained in the existing provider test file.

A first real-Next run exposed the Chromium push race even after unit tests passed. Read-only history traces and independent plain-browser probes reproduced the browser mechanism: after queued Back plus two same-task pushes, Chromium temporarily exposes the old history range and silently drops the larger restoration request. Visiting the adjacent old buffer succeeds and exposes the updated range. Firefox can cancel the queued traversal; WebKit completes it. The maintained browser test permits Firefox's cancellation but retains its URL, query, pending-draft and next-Back assertions. The final native tests prove those visible outcomes; they do not assert private state-machine fields.

| Check                                   | Result                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Full Vitest (all projects)              | 4,173 tests in 316 files passed                                                                                   |
| Pinned type checker                     | Bun 1.4.3 / TypeScript 7.0.2, 948 files, no errors                                                                |
| ESLint / Prettier / test discovery      | Passed; 316 Vitest files and 14 Playwright spec files discovered                                                  |
| Credential-free production build        | Passed; normal 59-route manifest contains no navigation fixture routes                                            |
| Real Next production navigation harness | 32/32 passed: eight each desktop Chromium, mobile Chromium, Firefox and WebKit; no failures, skips or page errors |
| Normal browser smoke                    | 94 passed                                                                                                         |
| Workspace browser suite                 | 46 passed; two existing desktop-only cases excluded on the mobile project                                         |
| Convex generated code                   | Matches pinned CLI output                                                                                         |
| Dependency checks                       | Application and release audits passed with the repository's existing exact-chain, expiring exception policy       |
| Workflow validation                     | Action pins/actionlint and required navigation matrix checks passed                                               |
| Isolated authenticated app QA           | 17 passing scenarios on desktop/mobile; no page errors                                                            |

Authenticated QA covered Floor, HR and Scan Keep/Discard and pending protection; actual sole Floor Save and continue executed once. It also covered HR dirty reload/query, dirty query push and pending query push. Two initial Floor failures were scratch-runner selectors: saving leaves the editor open. The runner reused the visible field and both focused reruns passed without application changes. The final count is 12 original passing cases, two corrected Floor cases and three additional HR cases.

Final native build and run used the same provider blob before and after: `7907f816139871faeac74179a931659c2152fbed`. Normal local checks completed before measurement. Authenticated production build uses a separate `.next-preview` output, test Clerk identity and owned loopback Convex data; no production data was changed. Its evidence is separate from the credential-free fixture.

Sol 6.1 Standards and Spec reviews accepted the pinned implementation through `9d35f976`. The Spec review's small error-timing evidence inconsistency was corrected and independently confirmed in `70dacc46`. Kiro Opus 5.5 implemented the production changes and completed a read-only final audit with no blocking finding; it requested explicit browser-proof and build-provenance limits, recorded here. Review hashes precede the safe rebase: the complete tree before/after rebase was identical (`06f21c8975ffdc3ec36b71502b5c2f26e2d366ba`). Rebased code head is `8ce8c9cc` (`9d35f976` maps to `71161837`; `70dacc46` maps to `8ce8c9cc`).

Final CI exposed an existing Sidebar test timing race: async drawer lookup could allow the real reveal frame to set `scrollTop` to 720 before the test sent wheel input, while its assertion assumed wheel came first. Yielding one frame before wheel reproduced the exact CI failure. The test now controls queued animation frames and cancellation, asserts the initial position, and preserves both reveal/reopen/focus controls and the wheel-before-reveal assertion. Production Sidebar behavior was unchanged. The 18-case suite, five focused repetitions, lint and formatting passed; the full CI gate was rerun on the final commit.

## Performance diagnosis

Authenticated local production build on Apple M1 Max / macOS arm64, Chromium 151.0.7922.34, Node 24.19.0 launcher and pinned Bun 1.4.3 app server; English; desktop 1440×900 and mobile 390×844; unthrottled loopback with isolated Convex fixtures and external Clerk test authentication. Two warm-ups precede each 20-completed-sample group. Cold means a fresh authenticated browser context with the source already loaded; warm means same-context revisits. Shared assets, automatic Next prefetch and OS/backend caches can remain warm. No simultaneous build or test suite ran during collection.

Timers start at the actual app control's programmatic click. URL-observed time is a URL proxy, not React commit; data-ready waits for actual loaded route content. The Scan return uses the Sidebar goods link on both widths. Mobile opens the real menu before the timer, so preparation is excluded; drawer closing/accessibility release can contribute to readiness. This is not a timed browser Back-button benchmark.

The first run produced 260 completed samples and three warm-up/setup failures caused by the mobile harness expecting a link inside the closed drawer. These failures are retained and excluded from latency percentiles; they do not demonstrate application latency failure. The measurement script now opens the actual menu before the same link action. Sol independently reviewed that correction and accessible-label precedence for the optional HR button; all 11 focused measurement tests passed. Supplemental mobile Scan results are recorded separately.

The supplemental run completed 80/80 samples with zero errors or cancellations. Across both collections there are 340 completed samples: the supplemental mobile goods→Scan cold group repeats an initially successful 20-sample group. The table selects the 240 desktop/Floor samples from the first collection and all 80 supplemental mobile Scan samples, giving 320 samples across 16 groups without double-counting. All 320 selected samples completed; the three original warm-up/setup failures remain disclosed separately.

Each table row contains 20 completed samples. Values are milliseconds, nearest-rank descriptive p50 / p95, rounded to one decimal.

| Direction          | Width | Cache | URL observed p50 / p95 | Data ready p50 / p95 |
| ------------------ | ----- | ----- | ---------------------- | -------------------- |
| catalogue-to-floor | 1440  | cold  | 19.0 / 34.9            | 43.6 / 61.2          |
| catalogue-to-floor | 1440  | warm  | 13.0 / 15.7            | 15.9 / 30.3          |
| floor-to-catalogue | 1440  | cold  | 17.8 / 21.1            | 35.0 / 40.3          |
| floor-to-catalogue | 1440  | warm  | 7.2 / 10.4             | 17.5 / 20.4          |
| goods-to-scan      | 1440  | cold  | 13.3 / 52.7            | 25.5 / 67.5          |
| goods-to-scan      | 1440  | warm  | 5.1 / 6.4              | 13.4 / 14.5          |
| scan-to-goods      | 1440  | cold  | 17.8 / 20.1            | 47.9 / 63.0          |
| scan-to-goods      | 1440  | warm  | 6.1 / 9.0              | 12.4 / 14.2          |
| catalogue-to-floor | 390   | cold  | 18.0 / 33.8            | 39.0 / 43.7          |
| catalogue-to-floor | 390   | warm  | 10.6 / 13.4            | 14.7 / 17.7          |
| floor-to-catalogue | 390   | cold  | 17.6 / 20.5            | 36.6 / 40.9          |
| floor-to-catalogue | 390   | warm  | 9.8 / 15.0             | 17.6 / 20.8          |
| goods-to-scan      | 390   | cold  | 31.0 / 37.5            | 45.4 / 51.8          |
| goods-to-scan      | 390   | warm  | 7.1 / 13.2             | 16.4 / 25.7          |
| scan-to-goods      | 390   | cold  | 64.7 / 82.9            | 100.0 / 114.2        |
| scan-to-goods      | 390   | warm  | 10.4 / 13.6            | 16.9 / 23.0          |

Compiled source was clean `8ce8c9ccdf1f1a15e1cf364925b06c78984ed3b7`, tree `06f21c8975ffdc3ec36b71502b5c2f26e2d366ba`. Build ID: `UZpu289Yn37up-_hBNolq`; served build manifest SHA-256: `074bab4f520638efb125c2372e5a08b6dd9ba678d42cf7baa6af8246c4c44f6b`, verified against the fresh build bytes. The supplemental runner was clean `70a96f4e952710f692b01994e6142234d0375cfc`; its only changes since the compiled source were measurement scripts and their test. The app source, served manifest and guard blob `7907f816139871faeac74179a931659c2152fbed` were unchanged. Thus runner provenance is recorded separately from compiled-app provenance.

The selected groups' data-ready p95 values range from 14.2 to 114.2 ms; the slowest selected completed sample was 332.5 ms. The ten-second symptom was not reproduced in this environment. There is no before/after comparison or demonstrated deployed speedup. No controlled-network profile or HR latency batch was selected, so neither is claimed. A targeted latency change needs reproducible deployed route/device/network conditions and phase evidence; this change therefore delivers guard correctness and maintenance improvements without declaring the reported delay solved.

Raw numeric evidence is ignored under `output/performance/navigation-guard-reuse-local.json` and `output/performance/navigation-guard-reuse-mobile-scan.json` in the preserved worktree; build checks are in ignored `.cache/navigation-guard-reuse/qa-build-provenance.json` and `qa-supplement-provenance.json`. No credentials, session tokens, entity IDs, raw URLs or business payloads are copied into this report.

## Conditional decisions and remaining limits

- Defer the traversal-state union. Existing set sites exclude simultaneous restoring/removing; approval and overtaken-entry lifetimes span idle and traversal states. Rewriting those states would touch reentrant history ordering without a demonstrated behavioral or maintenance benefit. The private buffer record delivers the bounded simplification.
- Do not add a pagination framework. Shared `updateHistoryMetadata` already owns the common write. Two small HR blocks retain different payload/criteria handling, while catalogue has bounded array/legacy-slot policy. Extracting more does not yet justify another interface or changes to listener timing.
- Forward-branch truncation and broad multi-entry/Back-menu behavior remain unresolved under the earlier feasibility decision. The Chromium correction covers the tested overtaken single-Back path, not every browser-history interaction.
- Activity hide/reconnect and simultaneous draft registrations are provider-level contract tests. They do not establish that the current Floor UI exposes those exact races. Abandoned-buffer handling still has its previously noted history-step limits after interruption/remount.
- The current interface cannot detect new work that never changes dirty/pending flags. The implemented renewal check covers observable registration transitions; the existing sole saveable Floor owner disables editing while saving and retains its true-returning React-cleanup pattern. No generic domain-save policy was introduced.
- HR successor ownership/manual-setter changes remain conditional and deferred. No backend schema, dependency upgrade, global data cache, auth bypass or production test endpoint was added.
- Local measurements do not establish deployed latency or solve the user's reported ten-second symptom. Production route traces still need a reproducible route, device/network conditions and phase evidence before selecting a targeted optimization.
