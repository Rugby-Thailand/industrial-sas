# Independent Codex final audit — HR Kiro improvement

Finalized 2026-10-11, Asia/Bangkok. **No verified new P0, P1 or P2 defect remains within this improvement phase.** The coordinator's final repository check and production rebuild both exited 0. This is an independent review of the implemented working tree; no commit, PR, deployment or live data change is claimed.

## Scope and preservation

The work was integrated onto `origin/main`, `c64a882239696122e593e493aea771a1792841e5`. The [rebase verification](../../output/hr-kiro-rebase-20261010-230124/rebase-verification.json) records all 372 pre-existing dirty files restored: 365 byte-identical at restoration and seven deliberate semantic merges or newer upstream supersets. Those restoration counts precede the subsequently authorized improvements. Exact originals remain in the retained safety archive/stash.

This audit compares the phase with the [post-rebase manifest](../../output/hr-kiro-improvement-20261010/post-rebase-manifest.json) and saved `.baseline` snapshots, rather than treating all differences from HEAD as this phase's changes. Existing HR, Search and unrelated work were inputs to the review. Final independent hashing found no missing manifest file and exactly 30 declared changes to existing files. All six mobile and six performance application files match their source-freeze hashes; the final six-file check follow-up and its report match the owner's final hashes. All 127 backend files and 56 frozen guide/deployment evidence files remain unchanged.

AGENTS.md and the installed Next 16.3.8 guides for client components, lazy loading and router navigation were read before recommendations. The independent reviewer made no application/test edits and ran no browser, server, Kiro CLI, git mutation, database operation or provider request. Only this new report was written.

## Accepted implementation

| Area                          | Independent conclusion                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Employee and period forms     | Employee start/end inputs use the existing canonical HH:MM parser and attach errors to the corresponding fields. Overnight schedules, payloads, server rules, pending/uncertain writes and retry identity remain intact. Box-bearing fieldsets restore spacing.                                                                                                                                                             |
| Employee registry             | Cards/table respond to available container width, so an expanded sidebar at 1024 px leaves usable cards and complete Edit controls. Wide tables and wrapping employee names remain usable.                                                                                                                                                                                                                                  |
| Guard cancellation            | HR remembers a usable focused field in the retained main region. Cancellation rejects stale, hidden, disabled, disconnected and transient-popup targets, then uses the retained field or existing main landmark. Accepted transitions preserve destination focus. Storage consumers retain the default guard behavior.                                                                                                      |
| Mobile navigation             | The hydrated mobile header contains menu, flag-only language selector and theme control. Workspace and Search/AI controls reside in the drawer. Search waits for drawer close, uses the connected header menu as its return target, and cancels queued opens when route, identity, scope or layout changes. Locale changes preserve query/hash through the existing draft guard.                                            |
| Performance                   | A 64-entry LRU caches only Intl formatter instances, keyed by locale and all formatter options. Search keeps one eager dialog/focus frame and loads its heavy body on first open, with loading/retry, query/caret handoff, composition handling and closed-dialog protection. Only Review readonly history defers mounting until first expansion; it stays mounted afterward. Default editing disclosures remain eager.     |
| Reviewed checks and telemetry | The six-file follow-up incorporates the preserved HR permissions and public surface without changing backend authorization. Literal role expectations retain planner/HR separation. Seven registered HR representatives verify real tenant payloads, denied contexts/grants, isolation and mocked-provider privacy. Telemetry adds exactly seven static route words; IDs, dates, queries and personal data remain redacted. |

The guarded contract refresh added exactly 32 public HR functions and two internal functions. All 93 prior public contracts remain structurally identical; there are no removals. The sole changed existing contract is the reviewed optional `rateLimit` argument on internal authorization preflight. Original warehouse-boundary assertions and existing contract-test logic remain intact. The readonly test consequence changes only the obsolete initial-mount expectation and preserves subsequent expansion/editing assertions.

The underlying actual-Kiro and wrapper evidence is linked here:

- [UX audit and implementation](hr-kiro-ux-audit-2026-10-10.md)
- [UI audit](hr-kiro-ui-audit-2026-10-10.md) and [UI implementation](hr-kiro-ui-implementation-2026-10-10.md)
- [Code-quality audit and full-check follow-up](hr-kiro-code-quality-audit-2026-10-10.md)
- [Performance audit and implementation](hr-kiro-performance-audit-2026-10-10.md)
- [Mobile navigation implementation](hr-kiro-mobile-nav-2026-10-10.md)

These reports distinguish actual installed Kiro CLI work from independent Codex corrections and verification. The follow-up diagnosis and implementation exited normally 0 after 1123.72 and 1690.8 seconds respectively. The performance report also records its interrupted audit-prose consolidation and filtered TypeScript invocation honestly.

## Verification

The coordinator's exact commands and exit results are recorded in the [final gate record](../../output/hr-kiro-improvement-20261010/root/final-gates.json), including `VITEST_MAX_WORKERS=1 pnpm check` and `NEXT_DIST_DIR=.next-build pnpm build`.

| Check                                       | Final result                                                                                                                                                                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tests executed by this independent reviewer | 11 focused files, 141 passed: employee validation, guard cancellation/default consumers, mobile/locale, Search loading/focus/context, formatter and disclosure behavior.                                                                                        |
| Separate quality-wrapper follow-up          | Six files, 217 passed, including existing job-scan-provider and location-image shared-fixture consumers; scoped ESLint and Prettier passed. [Frozen summary](../../output/hr-kiro-improvement-20261010/quality/fullcheck-followup/final-followup-summary.json). |
| Coordinator's complete `pnpm check`         | Exit 0: formatting, Next type generation, TypeScript and full ESLint passed; **234 files / 2814 tests passed**. [Final log](../../output/hr-kiro-improvement-20261010/root/final-check-after-regressions.log).                                                  |
| Coordinator's final production rebuild      | Exit 0, after the telemetry/test follow-up. [Final build log](../../output/hr-kiro-improvement-20261010/root/final-build-after-regressions.log).                                                                                                                |
| Final UI detector                           | Exit 0, no reported findings (`[]`). [Result](../../output/hr-kiro-improvement-20261010/root/final-ui-detector.json).                                                                                                                                           |

The independent reviewer inspected every accepted native PNG individually for all nine HR route families at desktop 1280×800 and mobile 375 px: Today, Time, day detail, Profile, Review, Employees, Periods, period detail and Settings. Blank transitional desktop Time/Review captures were rejected and replaced with visibly rendered captures in the [desktop matrix](../../output/hr-kiro-improvement-20261010/root/native-desktop-matrix.json). All nine [mobile captures](../../output/hr-kiro-improvement-20261010/root/native-mobile-matrix.json) were rendered and readable. Additional employee/sidebar captures at 1280 and 1024 px show complete Edit controls; mobile form captures and coordinator geometry confirm the restored spacing. The coordinator measured no body overflow or Next error overlay in the route matrices.

The coordinator's [native functional evidence](../../output/hr-kiro-improvement-20261010/root/native-functional-verified.json) confirms:

- Dirty locale and cold Search cancellation with **Keep editing** retain the exact employee draft, URL and page time origin, and return focus to the connected name input. The draft was subsequently cancelled without saving.
- Mobile drawer → Search leaves one dialog and no sheet, focuses the input, returns focus to the connected menu button on Escape, and focuses the holiday section after accepted navigation.
- Mobile AI opens one dialog with an empty input and disabled Ask button, without executing an AI request.
- English ↔ Thai switching preserves `?from=mobile-nav#hr-settings-holidays`.
- Review history has zero mounted headings initially, two after expansion, and the same two retained but hidden after collapse.

This consolidated evidence supersedes the agent-local root-pending items in the mobile and quality reports for these verified flows. Native QA made no live database writes.

## Final emitted-bundle evidence

The final build manifests are dated 18:15:59 UTC; the [fresh comparison](../../output/hr-kiro-improvement-20261010/performance/production-bundle-comparison.json) was measured at 18:18 UTC. It replaces the archived provisional measurements and matches the updated performance report. The independent reviewer recomputed actual emitted-file raw/gzip sizes, route sums, deltas and Search chunk hashes with no mismatch.

| Route-entry JS set | Raw bytes before → final | Raw delta | Local gzip delta |
| ------------------ | -----------------------: | --------: | ---------------: |
| Today              |        827,093 → 806,622 |   −20,471 |           −5,682 |
| Employees          |        844,549 → 824,428 |   −20,121 |           −5,617 |
| Review             |        861,450 → 840,997 |   −20,453 |           −5,697 |
| Period detail      |        844,870 → 824,399 |   −20,471 |           −5,715 |

Each entry set contains 15 chunks versus 14 before. The eager Search frame is 12,950 raw / 4,587 gzip bytes; the dynamically imported body is 30,027 raw / 10,484 gzip bytes. The explicit loader edge identifies the body, which is absent from all four route-entry and corresponding diagnostic first-load sets. These are combined-phase emitted-file measurements, excluding other first-load dependencies. They establish no observed network transfer, latency, cold-open time or field CWV improvement.

## Frozen guide and limits

The [Thai guide](../manuals/hr-user-guide-th/README.md) and [PDF](../../output/pdf/hr-user-guide-th.pdf) were preserved without regeneration. All 20 recorded manual captures use 1280×800 desktop viewports; their Search/AI sidebar controls and shortcuts remain present. All 56 frozen artifact hashes match. The PDF SHA-256 remains `19d92ccffad1c41fe2425cb4f85c846281810233f517e984ffc14fb87a459669`. The four prior HR review documents were changed only to the exact canonical Prettier output of their saved originals; the ignore file preserves its original prefix and adds eight precise immutable-artifact exclusions.

Native 320/390/768 px, cold pre-hydration header presentation, real IME input and context changes during the sheet's exit animation were not established by this pass. Composition/context invalidation have focused jsdom coverage. The preview disconnected after the completed core native checks; it was not restarted. Native partial-time-input behavior and live save/Return/close/export/provider execution are not claimed.

The pre-existing `hrCommand` refusal path stores a supplied warehouse ID as denied-attempt metadata. Read-only triage found no verified tenant access bypass or disclosure: the command refuses the foreign site, the audit row belongs to the caller's organization, and current employee history consumes only allowed entity-linked events. The security claim is closed as unsubstantiated; attempted-target versus validated-reference audit semantics remain an unverified backend documentation question outside this phase. No backend change or new defect finding was warranted.
