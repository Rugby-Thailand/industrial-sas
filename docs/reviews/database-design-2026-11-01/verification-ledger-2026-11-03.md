# Database verification ledger — 2026-11-03

Implementation baseline: main `79c4de7bb12faaf713adbe23a8dfbd934d2e268a` (through PR #122). The original gap report describes an earlier baseline; this ledger records subsequent evidence without treating source inspection or simulated transactions as cloud acceptance.

| Item   | Category                     | Current evidence                                                                                                   | Remaining pass condition                                                                                                           |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1      | Payslip migration            | PR #121 adds bounded legacy traversal and maximum-size PDF/CSV cases.                                              | Each relevant deployment has a complete dry-run receipt with zero inline, missing and corrupt payloads; measured empty is valid.   |
| 2      | Business retries             | 65 actual-caller retry cases pass, plus deterministic helper expiry boundaries.                                    | Remaining delayed move reserve/start and leave approval/cancellation retries; real-backend concurrent delivery.                    |
| 3      | CLOSING guards               | 17 source-guard cases pass across BUILDING/READY/CANCELLING; six holiday overlap regressions pass.                 | Real-user multi-session acceptance. Seeded legacy/otherwise unreachable states remain explicitly labeled guard fixtures.           |
| 4      | Attendance and exports       | Seven new registered-public-function integration cases pass with transaction limits enabled; details below.        | Promote the local browser rehearsal into durable staging tests; cover the leave approval workflow.                                 |
| 5      | Multiple drivers and readers | Local backend accepted one of two concurrent advance calls; browser resumed, refreshed and published the build.    | Independent user contexts and other races, committed lost-response recovery, export interruption and reader convergence.           |
| 6      | Clerk and private downloads  | Prior stale-session denial and supplied-identity positive backend checks.                                          | Actual provider challenge produces a fresh session that downloads the owned original bytes; invalid ownership/session cases deny.  |
| 7      | Retention operations         | Existing bounded worker tests and local manual sweep evidence.                                                     | Observe deployed cron chain; exercise dispatcher and per-table budgets, restarts and backlog beyond 2,000 rows.                    |
| 8      | Inventory contention         | PR #121 records 24 real requirement/reservation races and scale fixtures; the initial report predates this.        | Declared mixed workload, quiet-site/tenant controls, resource/latency observations and invariant checks. No throughput claim yet.  |
| 9      | Resource bounds              | PR #121 opts selected tests into convex-test transaction limits; new realistic attendance suite also enables them. | Real-backend resource and subscription measurements at a declared dataset/workload. Simulation is partial evidence.                |
| 10     | Backup recovery              | Prior disposable local backup/restore rehearsal.                                                                   | Restore an actual cloud backup into isolation and verify relationships, hashes, application reads and unfinished-close recovery.   |
| Native | Computer use                 | Native Chrome opened the published period, showed correct totals and reached the CSV save dialog at bc2e359f.      | Native save completion, Back/Close/refresh remain unverified: the focused save dialog changed to an unrelated file during the run. |

## Realistic attendance reference cases

Files: `tests/fixtures/hr-period-expected.ts` and `tests/integration/hr-period-realistic-close.integration.test.ts`.

The fixture seeds historical attendance, certifications and a holiday. It exercises registered public create, preview, begin, advance, publish, export, employee-history, revision and employee-save functions. It does **not** claim to test the creation/approval of leave or a real browser/provider session.

- 120 employees × 31 dates, six repeated profiles: ordinary day shift, early/late punches, overnight shift, corrected worked day, certified absence and certified leave. Weekends and the October 13 holiday remain nonworking.
- Independent worked examples: 21 scheduled dates per employee, 793,800 worked minutes, 12,600 outside-shift minutes, 420 absence days, 420 leave days and 1,200 nonworking days. Expected values import no production calendar, attendance, totals or CSV builder.
- Every exported record is compared in order to an independently assembled full CSV, including BOM/header, Thai names, escaped quotes, embedded CRLF, formula protection, UTC timestamps and all employee/date pairs. `csv-parse/sync` parses complete records and cells; the full byte stream is also compared. The test checks exactly one BOM/header, 3,720 unique employee/date keys, and disjoint employee sets across export parts.
- Export crosses 2,000 rows in two bounded parts containing complete employees. Assertions permit conservative packing rather than depending on an internal read slice size.
- Corrected self-history preserves original 08:30–17:30 punches and effective 09:00–17:30 certification, including reason, 9,450 worked minutes and ten nonworking days.
- 25/26 and 50/51 scheduled-employee boundaries preserve all exported rows through complete-preview and staged paths.
- Revision v2 reflects an employee-name correction; v1 export remains byte-identical and each employee-history version retains its own name and unchanged attendance. The public correction command refuses with HR_PERIOD_CLOSING during the revision build and HR_PERIOD_CLOSED after publication.
- An employee hired October 15 and ending October 20 contributes exactly six dates. A further 120 former employees interleaved in roster order do not truncate traversal. All 1,556 expected export rows are compared.

Local validation: seven cases passed with `transactionLimits: true`; changed-file ESLint passed. No production defect was reproduced by these cases, so no production behavior was changed. Initial failures corrected test assumptions about conservative export part packing, timestamp formatting, omitted optional fields and the existing one-command publication path; they are not presented as red-to-green product fixes.

## Verified audit findings and corrections

- The earlier baseline does **not** freeze the exact-expiry clock: `git show 79c4de7b:tests/integration/temporary-retention.integration.test.ts` still contains `Date.now()` and a 10,000 ms future margin. The approach audit accidentally attributed the concurrently edited working file to that baseline. The new deterministic change is retained once.
- Product creation with the same SKU and building creation with the same code refuse `DUPLICATE_KEY` after receipt expiry. They do not necessarily create a second copy as the approach audit suggested. Pallet and batch creation can allocate new identities after expiry; rack generation also respects occupied addresses. The registered-caller tests establish each actual contract.
- Holiday create/rename/delete bypassed a covering CLOSING lock when an earlier-ending CLOSED period overlapped it. Four of six new cases failed on the original code. `closingPeriodCovering` now checks all covering periods in the existing bounded end-date read. All six cases pass, including inclusive boundaries, unchanged holiday data on refusal, outside dates and another site. Commit `28f5b846`.
- An expired committed receipt, whether retained or cleaned up, yielded FENCED and the UI incorrectly said the write never applied. Both new UI/backend regressions failed before the fix. The UI now preserves COMMITTED/FENCED explicitly; FENCED states that the original result cannot be confirmed and the old request cannot run again. Original data remains saved, the old key is permanently refused, and no automatic fresh write occurs. English and Thai copy changed. Commit `166b3265`.
- No backend recovery status or public function contract changed. A fence prevents future execution; it is not evidence about execution before receipt retention expired.

## Correctness slice validation

Tested code head: `85201d35`, local macOS checkout with Node 24, pinned Bun 1.4.3 / TypeScript 7.0.2 and convex-test 0.0.54. Two combined affected runs passed **191 tests across 11 files** (97 audit-fix/adjacent tests and 94 retry/guard/attendance tests). Pinned typecheck, full ESLint, navigation checks and test discovery passed. Discovery initially refused untracked new files; after staging/committing them it accounts for 386 Vitest files and 17 Playwright specs. Full formatting and isolated, credential-free codegen also passed. Codegen ran from a clean archive of the tested commit, loaded the schema in a disposable local backend and found no generated-file drift.

The 65-case retry matrix covers pallet/product/building, batch, zone/location and rack creation; completed movement; attendance recovery; preferences/notifications; leave submission; period/payslip/announcement publication; certification; actor/tenant authorization and overlapping live deliveries. Outcomes and source-state assertions live next to each case. It does not claim permanent deduplication of ordinary expired keys or real-backend contention.

Implementation, independent final code review and cloud acceptance remain separate gates. Operational rows above remain pending rather than silently counted as passed by local tests. No cloud migration, production cleanup or deployment occurred in this slice. Subsequent local browser and partial native evidence is recorded below.

## Final source review follow-through

Independent read-only review at `a18454fb` found no blocking defects and recommended proceeding to PR, CI and browser acceptance. Two non-blocking notes were addressed locally: every CSV case now checks the expected byte stream as well as parsed cells, and the revised-period case checks CLOSING and post-publication CLOSED refusals. The seven strengthened attendance cases and changed-file ESLint passed. Existing `hr-period-staged-close.integration.test.ts` case “freezes attendance, correction, holiday and roster writes while closing” also checks CLOSED behavior after publishing the first version.

The review did not execute tests or verify browser/cloud behavior. This correctness PR remains separate from the pending operational and real-user acceptance work.

## Integrated local browser rehearsal — 2026-11-03

Tested application head: `bc2e359f0492f1e4a8e398b5ff43cdf68824f32b`. All PR #123 required checks passed on this head, including the repository browser lanes. A separate Playwright rehearsal completed at **2026-11-03 09:41:57 UTC** against a fresh disposable, pinned local Convex backend on loopback and Next.js development server. It used a real Clerk test-account browser session and authenticated public APIs for assertions. Administrator-supplied identity and local imports were used only to construct synthetic fixtures; they do not establish provider reverification acceptance.

Verified outcomes:

- Holiday rename and delete from HR settings refused while the date was covered by a legacy overlapping CLOSED period and a CLOSING period. Public reads before and after matched exactly. These overlapping periods are deliberately seeded legacy guard states.
- An expired, previously committed shortcut-preference request displayed the unknown-result message and permanent-fence explanation after **Check previous write**. The saved preference remained unchanged and replay of the original request returned `REQUEST_RETIRED`.
- Two `advance` mutations were submitted together with distinct request IDs and `skipQueue: true`, bypassing the HTTP client's default serial queue. Exactly one succeeded; the other returned `PERIOD_CLOSE_STEP_STALE`. This is one overlapping-delivery check using one authenticated actor, not the complete independent-session race matrix or proof of an observed server conflict/retry.
- The browser resumed the partially built 120-employee period, reached READY, survived refresh, published v1 and downloaded the full CSV. English desktop (1440×1000) and Thai mobile viewport (390×844) displayed the published period. No page errors were observed.
- The downloaded **3,720-row / 652,187-byte** CSV matched the independent expected byte stream, including BOM, header, quoting, embedded CRLF, Thai names and complete pagination. SHA-256: `8a4a4f4d179905740603cec0a27ea7efca6057057c8619ca286e9829b04049eb`. The period ID is part of the CSV, so another fixture run has a different expected hash.
- Published totals: 120 employees, 3,720 days, 793,800 worked minutes, 12,600 outside-shift minutes, 420 absence days, 420 leave days and 1,200 nonworking days.

The initial scratch-run failure was an overly exact accessible-label locator that omitted the required-field marker; correcting that locator allowed the run to pass without an application change. Historical attendance and certifications were seeded from the reference fixture; this does not cover the live leave approval or attendance-entry journeys.

Native computer use separately signed into the local app in Chrome, opened this published period and observed Closed v1, 120 employees, 3,720 days, 13,230 worked hours, 420 absence days and 420 leave days. Clicking **Download CSV v1** reached the operating-system Save dialog with the expected attendance filename. During the save-location step, focus changed to a dialog for an unrelated `profile` file. Interaction stopped to avoid affecting unrelated work. Native save completion and Back/Close/refresh are therefore **not passed**; the successful Playwright download does not substitute for those checks.

This was a one-off local rehearsal, with private scripts and sanitized result receipts under ignored `.cache/db-acceptance-123/`; it is not yet a durable staging suite. Cloud migration completion, actual cron execution, Clerk freshness challenge, cloud backup restore, capacity measurements and the other remaining ledger cases are still pending.
