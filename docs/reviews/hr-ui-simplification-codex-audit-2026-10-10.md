# Independent Codex audit — HR UI simplification and Thai guide

Date: 2026-10-10 (Asia/Bangkok). **PASS for the audited local scope. No confirmed defect remains open.** Four P1 findings and one P2 finding were reproduced, fixed through Claude CLI, and independently verified. Every HR route family was checked in native T3 preview. The final frozen whole-project check and production build passed.

## Scope and baseline

The [authorized plan](../plans/hr-ui-simplification-claude-codex-2026-10-10.md) covers simpler HR steps/text, working features, and a Thai guide with full-view screenshots and highlighted controls. Claude CLI owns application changes; this Codex agent owns independent feature/UX QA, three consequence tests, and evidence. Guide author and manual reviewer are separate agents. No PR, push or deployment was performed.

Review used exact pre-pass files under `output/hr-simplification-implementation/baseline/`, `manifest-before.json` and `baseline-paths.json`, rather than the large pre-existing diff against HEAD. Code mirrors use `.ts.baseline` / `.tsx.baseline`; original bytes are archived. Existing dirty/untracked work was preserved. Root's [final protected-source check](../../output/hr-simplification-qa/root/protected-final-focus-verification.json) reports 209 protected files unchanged with no unexpected changes. The separately authorized explicit deep-link scrolling exception is recorded there.

## Verification

| Check                                     | Result                                               | Evidence and boundary                                                                                                                                                                                                                            |
| ----------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Independent isolated Convex integration   | 4 files / 48 tests passed                            | [Backend log](../../output/hr-simplification-qa/backend-regressions.log): authorization, org/site/account scope, self/foreign/stale rejection, corrections, idempotency, closed history and grounded Search. Synthetic `convex-test` data.       |
| Independent HR domain                     | 4 files / 42 tests passed                            | [Domain log](../../output/hr-simplification-qa/domain-regressions.log): timezone/calendar/overnight/duration/period/CSV rules. These first two runs preceded presentation freeze; their protected logic remained unchanged.                      |
| Independent guard consequences            | 3 files / 4 tests passed after fixes                 | [Guard log](../../output/hr-simplification-qa/guards-fixed.log): real guard provider, delayed mocked commands, no live writes.                                                                                                                   |
| Independent final Search focus regression | 1 file / 3 tests passed                              | [Focus log](../../output/hr-simplification-qa/search-focus-fixed.log): Claude-authored real Dialog/Provider tests rerun by Codex, including accepted normal/AI destination focus, refused destination and subsequent Escape.                     |
| Final root whole-project check            | 165 files / 1,504 tests passed; typecheck/lint clean | [Final check](../../output/hr-simplification-qa/root/check-final-focus.log), exit0, ESLint max-warnings0, after final SearchDialog freeze.                                                                                                       |
| Final root production build               | Passed, 45 static pages                              | [Final build](../../output/hr-simplification-qa/root/build-final-focus.log), exit0, separate `.next-build`.                                                                                                                                      |
| Native route/layout/function audit        | Passed                                               | [23 route/state reads](../../output/hr-simplification-qa/final-route-matrix.json), [live workflow states](../../output/hr-simplification-qa/live-workflows.json), [CSV byte proof](../../output/hr-simplification-qa/exports/verification.json). |
| Independent final guide audit             | All 20 pages passed                                  | [Every-page manual audit](hr-user-guide-th-independent-audit-2026-10-10.md): every final PDF page rendered and opened individually.                                                                                                              |

Independent runs total **12 files / 97 tests** across this pass. The whole-project count includes those tests; totals are not additive. [Structured results](../../output/hr-simplification-qa/test-results.json) separate simulated tests, persisted UI actions, and root checks.

## Every HR route

All nine route families below were checked at1280×800 and390×844, with one main heading and no page-wide horizontal overflow.

| Route                                      | Actual UI coverage                                                                                                                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Today — `/th/hr/today`                     | Pre-clock action, actual clock-in/out receipts, completed day, history link. Desktop clock56px, mobile48px.                                                                                           |
| History — `/th/hr/time`                    | Original/effective times, request/status links, date range, pre-employment empty range, persisted Oct10 record.                                                                                       |
| Date/correction — `/th/hr/time/2026-10-10` | Exact original timestamps, effective times, overnight controls and empty-reason validation without creating a request.                                                                                |
| Profile — `/th/hr/profile`                 | Correct employee/site/supervisor/employment/schedule; clear read-only ownership.                                                                                                                      |
| Review — `/th/hr/review`                   | Queue selection, pending comparison, Return reveal/reason validation/cancel, new WORKED disposition, certified view and closed-period lock. Expanded-sidebar1061px comparison/actions wrap correctly. |
| Employees — `/th/hr/employees`             | List, required validation, isolated creation/reopen, Save/Cancel URL chronology, weekly schedule/mobile editor and Search/AI schedule destination.                                                    |
| Periods — `/th/hr/periods`                 | New date/site draft, dirty/pending guard and persisted detail handoff. Mobile long table has a labelled horizontal region; the page fits390px.                                                        |
| Period detail — `/th/hr/periods/:id`       | Ready/close confirmation, closedv1, reasoned revision, draft/closedv2, historicalv1/export, old byte preservation. Version999 shows recovery and no export.                                           |
| Settings — `/th/hr/settings`               | Holidays Add/Delete, second-draft guard, access read-only inspection, policy disclosure and Search section focus. No live role grants.                                                                |

Checked mobile primary actions are at least48px high. Thai controls/text wrap correctly. Representative English/light Today and Review, and English/dark Review at desktop/mobile, were inspected; this does not claim every language/theme combination. Actual dark images were opened: [desktop](../../output/hr-simplification-qa/screenshots/review-en-dark-desktop.png), [mobile](../../output/hr-simplification-qa/screenshots/review-en-dark-mobile.png).

Normal Search was exercised with Command+K, typing, arrows and Enter to an HR subpage. Actual AI “แก้กะ วิภา” returns a grounded choice; choosing it opens EMP-DEMO-002 with `mode=edit&focus=schedule`, focuses `hr-focus-schedule`, and makes the section visible. AI navigates; later edits require saving. Escape and explicit Close restore the opener. Search navigation from a dirty QA editor prompts; “แก้ไขต่อ” retains the exact unsent name/URL. Cancel returns to the unchanged persisted list.

## Resolved findings

| Finding                                          | Reproduction and final proof                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1: Today pending navigation**                 | `TodayPendingGuard.independent.test.tsx` originally allowed the leave callback during a delayed clock response. Claude added the existing pending guard; the unchanged test passes, blocking pending discard until receipt/settlement.                                                                         |
| **P1: Create Period dirty/pending loss**         | `PeriodCreateGuard.independent.test.tsx` reproduced lost dates and leaving during creation. Existing guards, deliberate discard reset and saved navigation added; both unchanged tests pass.                                                                                                                   |
| **P1: Second holiday draft unguarded**           | `HolidayDraftGuard.independent.test.tsx` proved the previous SAVED state excluded the new draft. Settings resets a finished write on editable field changes, retaining locked uncertain-payload retry. Independent test and real second-draft prompt pass.                                                     |
| **P1: Schedule deep link below viewport**        | Correct direct/AI focus still left scroll0, targettop547.5/bottom922 in800px. Claude changed only explicit scrolling to auto. Fresh direct/reload/AI1280 pass at scroll547.5/top0. Final AI390 passes: active target, scroll987, rectangle65–735.5 inside844px.                                                |
| **P2: Search close overwrote destination focus** | Keyboard policy handoff first focused target, then opener about1second later. SearchDialog now suppresses close autofocus only after accepted navigation. Final trace ends on policy; actual AI target holds focus; later Escape/Close restore opener. Three real Dialog consequence tests pass independently. |

The first three were inherited gaps found during full-workflow QA. Failure/fixed logs remain in the evidence folder. Application fixes were made by Claude, not this reviewer.

An initial new-employee URL concern was **not reproduced in controlled final checks**. Fresh Save/Cancel/next Edit and a separately authorized new creation settle to matching list/editor URLs. Initial observation is retained; no speculative router/history fix was requested. Final claims use settled evaluated `location.href` and loaded identity, not early preview metadata.

Source review confirms disclosures keep children mounted and retain drafts/guards. Selected-version export labels are truthful; backend readiness, authorization/history/CSV payload remain authoritative. Search fix leaves provider/router/history guard/shared Dialog unchanged.

## Actual local persistence

Only explicitly authorized new local fixtures and Oct10 attendance events were changed. Old demo employees, previous punches, pending corrections, old closed periods and roles were preserved.

- **Oct10:** after the author captured pre-clock Today, actual clock-in/out were saved. Fresh date reload shows exactly two original events: `2026-10-09T19:02:13.448Z` and `2026-10-09T19:02:42.439Z` (ThaiOct10). Saturday shows work outside schedule;29seconds rounds to0whole worked minutes.
- **Employee:** unlinked inactive `HR-QA-20261010`, ID `jn7n9avjr9smnd84td6rh9vkhs8fyb0q`, Feb2only, LOCAL-DEMO, Monday08:30–17:30/break60. Created/reopened/saved. Separate authorized URL fixture `HR-QA-URL-20261010`, ID `jn7nqd2tmnkff6mwneb26v7qr98fyqa8`, inactive/unlinked Feb4only, outside the period.
- **Feb2 exception:** actually certified WORKED08:30–17:30, reason “ตรวจทดสอบคู่มือ: ทำงานตามกะ 08:30–17:30”. UTC01:30–10:30 yields480minutes. Disclosures retain unsent fields; after closing, Review shows lock/history.
- **Period:** preflight found no overlap or old employee eligible. New `k57kca6p047xva7y81756chw1h8fypfc` contains only QA employee,1day/8hours/0unresolved. Actual create→closev1→export→reasoned revision→closev2→historicalv1 export succeeds. Guide captures were coordinated before transient states were consumed.
- **Holiday:** new Feb3 “วันหยุดทดสอบคู่มือ HR-QA” saved, then only that own fixture deleted through its labelled UI trash button. Reload shows it absent; originalOctober2/September23 remain. Second unsent draft was never saved.

Actual UI-created CSV Blob bytes were observed with temporary standard DOM wrappers, restored afterwards. Files are545bytes, UTF-8 BOM/CRLF, one WORKED480-minute row/0outside minutes. V1 before/afterv2 is byte-identical, SHA256 `1cc1da04bce5f4925b45436794eefc87819b8aa14c69a25adef51e6a2bc058cc`. V2 differs only in its version field for unchanged work. [CSV verification](../../output/hr-simplification-qa/exports/verification.json) includes actual files/rows/hashes.

**Boundary:** existing correction Submit/Certify/Return and access-role changes were not submitted live. Their visible controls/input validation/source bindings and isolated mutation/permission tests were checked. Lost response/idempotency, stale state, foreign-role rejection and overnight rules are simulated tests, not claims of live outage or role experiments.

## Guide and browser limits

This feature reviewer read all20 instruction pages and matched labels/actions to actual UI and source/functional proof. The separate manual reviewer rendered/opened **every frozen PDF page1–20**; its [audit](hr-user-guide-th-independent-audit-2026-10-10.md) verifies full1280×800 native sources, correct highlights, no crop/zoom, Thai glyph/layout integrity, short steps and zero duplicated full instruction sentences. Root independently checked all20 images/anchors/fonts and HTML overflow at1280/390: [HTML review](../../output/hr-simplification-qa/root/manual-final-html-review.json). Checks are attributed to their actual reviewers.

All browser work used native T3. Intermittent host disconnections/screenshots were resolved with a fresh tab and exclusive browser window; no alternate browser was used. Settled DOM and persisted reloads support final outcomes. Native window is released; tab is Thai/light Review1280 with no draft.

[Console observations](../../output/hr-simplification-qa/console-observations.json) are capped snapshots, not complete historical logs. No actionable application error was observed there or in temporary window error/unhandled-rejection monitoring during final Search/mobile checks. Local Clerk development, font preload and CSP report-only notices are retained with sanitized URLs.

Source/tests were unchanged after declared final freeze. This completes independent feature/UX QA for the authorized local scope.
