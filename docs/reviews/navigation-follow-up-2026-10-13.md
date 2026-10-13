# Navigation follow-up implementation and verification

Execution started at 05:00 Asia/Bangkok on 2026-10-13 in the isolated `codex/navigation-audit-plan-20261013` branch. The original checkout was not modified. The [reviewed plan](../plans/navigation-history-follow-up-2026-10-13.md) permits shipping the independent fixes when the bounded Forward experiment fails.

## Scope and baseline

Fetched and rebased from PR #84 (`11c8c2cc`) onto `7491a2f44cd2774fca18f7ac93e5c2b5b7920a02`, incorporating PRs #85 and #86. Those changes affected Floor/Scan/HR surfaces but did not change the shared guard, history module or dependency pins. Regression tests reproduced the Back and unload defects on this newer baseline before implementation.

- **N2 implemented:** after a dirty Floor is reloaded and its editor is clean, Map/Table query replacement retains the orphan guard marker's ownership. First Back skips the duplicate and reaches the previous committed page. Ownership still expires when its marker, committed depth or route changes. Superseding writes still invalidate an in-flight restoration/removal.
- **P1 implemented:** the owner attaches `beforeunload` synchronously only while connected with dirty or pending work. Cleanup covers settlement, multiple registrations, unmount and StrictMode reconnect. This removes one Firefox document-cache eligibility blocker while clean; it does not establish that the application will always enter bfcache.
- **M2 implemented:** Back and HR pathname readers reuse one history-write-plus-popstate subscription. They retain different snapshots and existing fallback behavior. No new React context, dependency or backend change.
- **N3 found during final audit:** copying a legacy guard marker into a new query entry, then editing again, could restore by an impossible `go(2)` and leave Back stuck. Sol reproduced this on both the rebased baseline and the initial fix, including the real HR list-query hook. The follow-up drops copied markers on ordinary pushes and synchronously re-arms the new same-page entry while work is dirty or pending. It preserves genuine new guard entries, replacements, Next state and catalogue metadata. Stripping alone was rejected because it would remove protection from an already active editor; both dirty and pending-only regressions now cover the complete fix.
- **N1 unresolved:** the existing push-on-dirty mechanism can truncate an existing Forward branch. The bounded replacement experiment was rejected, as detailed below.
- **M1 deferred with N1:** no state-only guard rewrite around an unproven replacement.
- **W1/H1 remain conditional:** no production path established for the stale HR completion/remount or deferred manual error setter. No speculative request-identity changes.

## Forward feasibility gate: no-go

The candidate captured origin/destination Navigation API entry keys, restored the origin after a traversal, prompted there, and replayed the exact destination after approval. It created no synthetic dirty entry and guessed no history delta. A smaller hybrid would use that same branch when Forward was exposed and retain the legacy buffer elsewhere.

The actual installed Next 16.3.8 router registered its Window `popstate` listener before the candidate's layout-effect listener under Suspense/StrictMode. Chromium 151.0.7922.34 called the earlier bubble listener before the later capture listener at the Window target. Consequently A → B → C → Back B → dirty → Forward caused committed Next readers to observe **C then B**, even though the final URL and server page were B. `usePathname` observations were `A,A,B,C,B,C,B`. Firefox 153.0 and WebKit 26.5 suppressed that destination in the basic case (`A,A,B,C,B`). Checking only the final page would falsely pass.

Root independently used Chrome's actual toolbar Back and Forward. The native event reported `userInitiated: true`, `cancelable: true`, and `canIntercept: true`; the snapshot nevertheless recorded destination C reaching a normal pop listener before restoration to B on the deliberately exercised recovery path. This experiment does not prove that all browser traversals are cancelable. Cancelable interception could avoid this particular failure but does not establish safe protection on other paths.

The hybrid inherits the same failing recovery branch for the path it promises to fix. Its legacy fallback cannot repair this necessary condition. No partial production go is claimed. An earlier global interception seam or an explicitly bounded cancellation design needs a new reviewed gate.

| Gate row                                       | Measured result and limitation                                                                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing Forward branch, dirty then clean      | Original A/B/C keys retained in isolated fixtures and basic Next integration on all three engines.                                                             |
| Dirty Forward, Keep and exact approved target  | Native fixtures passed. Next cancellation isolation failed in Chromium; Firefox/WebKit basic case passed.                                                      |
| Multi-entry `history.go(-2)`                   | Exact-key replay passed in all three isolated engines.                                                                                                         |
| Rapid traversal while pending                  | Draft protection retained in all three; Firefox duplicated a prompt callback, requiring further work.                                                          |
| New protection before replay commit            | Restored in native fixtures; actual provider save/registration contract not approved.                                                                          |
| Null-state hash / skip link                    | Native fixtures passed; fragment navigation was allowed.                                                                                                       |
| Non-null unmarked entry                        | Hidden by the isolated candidate, but Chromium Next isolation failure prevents a production claim.                                                             |
| Query replacement / refresh during prompt      | Basic fixtures passed; complete superseding navigation semantics not approved.                                                                                 |
| Missing/disposed key                           | Missing key rejected without guessed fallback. Adversarial origin disposal before restoration could not recover; not established as an app-reachable sequence. |
| Cross-origin Forward                           | All three engines exposed no Forward entry while physical Forward still reached another origin. An empty API list is not proof of empty browser history.       |
| Unknown/direct-open / partial API              | Exact exposed keys only; full provider fallback not approved.                                                                                                  |
| Legacy buffers, reload, save failure, redirect | Full replacement integration not attempted after the necessary Next isolation condition failed.                                                                |
| Browser toolbar/menu and activation            | Actual Chrome Back/Forward checked. Menu jumps, rapid toolbar actions and mount-restored drafts before fresh activation not approved.                          |

The experiment used an isolated Next **development** app with actual router, Link and committed readers. It is distinct from production-mode application QA below. Its failed assertion remained in the scratch experiment, not as a skipped or red test in the application suite.

## Review and verification

Kiro CLI `claude-opus-5.5` with high effort implemented the production changes and focused regressions. Sol 6.1 independently wrote nine provider/Floor-adapter regressions, reviewed behavior, and performed separate Standards and Spec audits. File ownership was agreed before edits.

Standards audit: **0 hard violations, 0 actionable judgement findings**. Spec audit: **0 code defects, 0 scope-creep findings** in N2/P1/M2. A separate Kiro review accepted the scoped code subject to real-app QA, independently reproduced Chromium's native listener order and confirmed the Forward no-go.

Kiro identified two pre-existing concerns during review. The copied-marker defect is now addressed as N3 after baseline/current reproductions, a passing replace-mode control, and a narrow candidate verified with the actual HR query hook. The other concern remains open: a later-mounted legacy guard may expose a multi-entry Back destination to Next before restoration. Actual-app draft loss is not inferred from source alone. The inaccurate comment promising capture-listener precedence has been corrected. This PR makes no universal Back-menu safety claim. The existing marker-dropping, URL-changing Next `router.replace` path also remains outside this narrow fix; it was identified in source, not established as an additional failing user flow. Query helpers that retain the marker are covered separately.

| Check                              | Result                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Full Vitest suite                  | 313 files, 4,117 tests passed on the final source (`19d4b358`).                                              |
| Focused provider/Floor regressions | 62 navigation/history tests passed; baseline red and active-work regression red recorded before their fixes. |
| Pinned type checker                | Bun 1.4.3 / TypeScript 7.0.2, no errors.                                                                     |
| ESLint / formatting                | Passed; documentation formatting rechecked after the report update.                                          |
| Test discovery                     | 313 Vitest files and 13 Playwright spec files matched tracked tests.                                         |
| Generated Convex API               | Reproduced unchanged against the pinned local backend.                                                       |
| Dependency gates                   | Runtime, application and release-tool gates passed; existing exact-chain exceptions unchanged.               |
| Workflow validation                | Actionlint and pinned action references passed.                                                              |
| Credential-free production build   | `pnpm build` under the pinned Bun runtime passed (Turbopack).                                                |
| Authenticated QA production build  | Separate webpack build with test Clerk and isolated local Convex passed.                                     |
| Anonymous browser smoke            | 94 passed on desktop/mobile Chromium.                                                                        |
| Workspace browser suite            | 46 passed; two existing desktop-table cases are intentionally skipped on mobile.                             |

Authenticated Chromium QA passed ten core scenarios on both the initial scoped implementation (`625863aa`) and final behavior (`19d4b358`): desktop 1440×900 and mobile 390×844 each covered clean Back/Forward, authorized direct-open HR fallback, actual dirty Floor reload (including accepting the native unload prompt) followed by clean Table view and first Back to the catalogue, Scan Keep/Discard, and HR in-page Back while dirty and while a local mutation request was held pending. The pending case released the request and verified local save completion. No page errors were observed. Final Chromium 151.0.7922.34 verification added three passing HR scenarios: dirty reload → clean search push → redirty → Back/Keep → repeated Back/Discard, already dirty → search push → repeated Back/Keep, and pending mutation → search push → repeated Back with Discard disabled. All 13 final checks passed. They use native history traversal in the real authenticated Next production app, not fabricated popstate events. The initial HR reload probe failed on repeated Back before the N3 fix.

The local QA hostname initially differed from its request URL, causing a self-proxy loop. Aligning the server hostname to `localhost` resolved that harness problem; it is not evidence of the reported production delay. The initial Floor selector also needed updating for the newly merged floor-menu UI. These failed setup attempts are excluded from passing results. The additional HR draft assertion initially used an accessibility-role locator while the modal made the background form `aria-hidden`; correcting that harness lookup retained live-form, exact-value and URL assertions and both cases passed.

The independent final N3 audit accepted the complete marker-strip plus same-page re-arm fix. Kiro verified 62 focused tests and 362 tests across history, navigation, hooks and HR. Sol independently verified the maintained dirty/pending cases and four scratch cases using the real HR query hook. Baseline results were two failures and two passing controls; marker stripping alone left one active-work failure; the completed fix passed all four. The nested Next wrapper test checks one router URL synchronization, preservation of the fresh buffer through Next's later replacement, one approved discard and subsequent orphan skipping. Real Next verification is reported separately above.

## Browser cache and conditional follow-ups

An additional authenticated Floor check on the initial implementation used native `history.go(-2)` from a client-entered dirty editor. Keep restored the Floor route and width draft. That single script-driven multi-entry pass is not a Back-menu or universal traversal guarantee.

The controlled Firefox 153.0 two-document experiment was run with document caching enabled in its profile. Dirty work produced a native unload prompt; clean work did not. Both clean and dirty documents nevertheless returned with `pageshow.persisted === false`, so this experiment does **not** measure a cache benefit. The clean control failing to cache makes the performance comparison inconclusive.

The authenticated application also has a separate `beforeunload` listener installed by Convex 1.46.0's sync client (`src/browser/sync/client.ts:399`). Its callback protects incomplete writes. This PR does not remove it or claim that the whole application becomes eligible for Firefox document caching; it scopes only the navigation owner's listener.

A separate HR fault-injection probe held a mutation response while delivering a later query transition. The old form disconnected and a new form became writable at the same edit URL. However, EmployeeForm's key and intent both include employee version, so this created a different intent, not the same-intent W1 case. The probe also deliberately reordered application delivery on one WebSocket, whose normal frame delivery is ordered. It establishes neither W1 app reachability nor production race frequency. W1 and H1 remain deferred.

The final authenticated Firefox listener-lifetime flow was **blocked by local test authentication**: Clerk reported an active session/user, but navigating to a fresh application document returned to sign-in. One focused correction using the installed official Clerk testing helper did not resolve it. The app-level dirty/discard listener transitions were therefore not verified in Firefox. This is separate from the controlled native Firefox experiment above, and no Firefox application cache or speed improvement is claimed.

## Local timing observations

Measured on the final authenticated production build with Chromium 151.0.7922.34, after all heavy build/test jobs stopped: desktop 1440×900, unthrottled localhost Next and isolated local Convex, warm authenticated context, retained caches, and two warm-up cycles before ten samples in each direction. Convex uses a persistent WebSocket; HTTP request counts do not describe its messages.

The timer starts immediately before a programmatic native click on an actual Next link. Animation-frame observers record pathname changes and route-specific loaded UI. **URL observed is a proxy, not a React commit timestamp**; loaded UI is the separate data-ready proxy. Values have roughly frame granularity. Percentiles use nearest rank and are descriptive for these samples only.

| Route pair            | Samples | URL observed p50 / p95 | Data ready p50 / p95 |
| --------------------- | ------- | ---------------------- | -------------------- |
| Finished goods → Scan | 10      | 5 / 6 ms               | 13 / 13 ms           |
| Scan → Finished goods | 10      | 7 / 8 ms               | 13 / 15 ms           |
| Catalogue → Floor     | 10      | 14 / 15 ms             | 14 / 30 ms           |
| Floor → Catalogue     | 10      | 7 / 11 ms              | 12 / 18 ms           |

Scan readiness required loaded location data, goods required its seeded item, catalogue required the seeded building link, and Floor required its loaded building toolbar. These warm local observations did not reproduce a ten-second delay. They are not a before/after comparison or evidence that a deployed latency problem is fixed. Production traces during the reported symptom are still needed to distinguish network, backend, hydration and other work before selecting another performance change.
