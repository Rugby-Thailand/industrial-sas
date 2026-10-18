# GPT-6.1 Sol functional audit — 14 October 2026

Audited the **current working tree**, including existing uncommitted work. This is a bounded audit, not a claim that every workflow is correct. No application source, existing test, configuration, backend data, or git state was changed. New artifacts are confined to this `sol/` directory.

Three current functional defects are confirmed. All six probes exercise real application components or registered backend handlers. UI probes replace the Convex subscription/transport with controlled responses; backend probes use the existing in-memory `convex-test` tenant fixture and real authorization/write logic. Their assertions deliberately capture the **observed defective behavior**. Passing these diagnostic probes means reproduction succeeded; it does not mean the desired behavior is correct.

| Priority | ID     | Finding                                                                                               | Evidence                                                                      |
| -------- | ------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| P2       | SOL-03 | A clean stacking-limit editor keeps old values after a live update and can overwrite the newer limit. | Real `StackScreen` plus registered `saveStackingLimits`/`getPallet` handlers  |
| P2       | SOL-01 | Reactive attendance revisions erase unsent HR review and correction drafts without a prompt.          | Real `ReviewDetail` and `HrDayScreen`, including the draft guard provider     |
| P2       | SOL-02 | Re-certifying unchanged displayed times truncates seconds and can increase recorded worked minutes.   | Real `ReviewDetail` payload plus registered `disposeDay`/`dayDetail` handlers |

## SOL-03 — Clean stacking forms silently restore an old limit

**Locations:** `src/features/finishedGoods/StackScreen.tsx:63`, `:64`, `:71`, `:75`, `:357`; `convex/finishedGoods/workflow.ts:2320`, `:2357`.

**Trigger/reproduction:**

1. Open the Stack screen for a stored lower pallet with no upper children or active move. Its editable maximum is 2.
2. Another permitted operator saves maximum 5. The reactive `stackOptions` response now contains 5, but the original clean form still displays 2.
3. Click **Save stacking limits** in the original form. It sends `maxStackLevels: 2` without a loaded revision/baseline.
4. The server accepts the stale payload and changes the persisted limit back to 2. No conflict or newer-data notice appears.

**Expected:** A clean form should adopt the live value. A dirty form should keep its loaded baseline and refuse a save when another operator has changed the settings, with an explicit reload path.

**Actual/user impact:** The user sees stale settings even while the rest of the stack preview uses live data. Saving can undo another operator's configuration. The same mechanism can also restore a higher limit after another operator reduces it; the report does not claim weight/load enforcement, which this product explicitly does not implement.

**Root cause:** `Limits` initializes `stackable` and `levels` with `useState` and never synchronizes them with later pallet props. Its React key is just the pallet ID. `saveStackingLimits` validates lifecycle and numeric bounds but has no settings revision comparison, so it cannot distinguish a stale edit from an intentional replacement.

**Suggested narrow fix:** Track a stacking-settings revision/baseline independently of the form's live props. Adopt query updates only for clean forms. Retain dirty values on updates and pass the original expected revision to the mutation; check it after exact receipt replay, before a fresh write. Do not solve dirty-form updates by revision-keying/remounting the editor.

**Verification:** `stack-ui.probe.tsx` reproduces a clean field staying at 2 after a live query changes to 5 and asserts the subsequent save payload is 2. `backend.probe.ts` invokes the actual authorized mutation with 2 → 5 → stale 2 and queries the final persisted value of 2. No test relies on a timestamp collision or concurrent network timing.

## SOL-01 — Live attendance revisions erase drafts

**Locations:** `src/features/hr/ReviewDetail.tsx:125`, `:132`, `:524`, `:530`; `src/features/hr/DayScreen.tsx:85`; `src/features/hr/CorrectionForm.tsx:111`.

**Trigger/reproduction, reviewer:** Open **Review again** for a certified unlocked day and type a new decision reason. A different reviewer re-certifies the same day, advancing its revision. The original reviewer receives the reactive detail update.

**Trigger/reproduction, employee:** Start explaining a correction for an expired day with a missing checkout. A supervisor certifies that day while the employee form is open. The detail changes from EXCEPTION revision 1 to READY revision 2; the unlocked day can still accept a correction.

**Expected:** Preserve unsent text and show that the underlying record changed. Require review/reload of the new revision before a decision can be submitted against it.

**Actual/user impact:** The reviewer form disappears and returns to **Review again**; its reason is lost. The employee correction form is remounted with an empty reason. No discard dialog appears, even when `DraftGuardProvider` is mounted. This happens through subscription updates, without a navigation action or user consent.

**Root cause:** Both callers include `detail.revision` in component keys. React unmounts the old form and initializes a new one when a live revision arrives; locally held text/time/choice state and the old draft registration disappear. Review branches can also replace an exception form with a certified-state gate.

**Suggested narrow fix:** Own unsent draft state by employee/business-date/request identity outside revision-controlled render branches, and retain its loaded revision. On a live update, keep the text but block stale submission until the user reviews/reloads the current record. HR-031 explicitly requires a changed displayed record to be reloaded before another decision, so simply preserving state while attaching the new live `expectedRevision` would be incorrect. Successful writes may deliberately consume their own draft; unrelated subscriptions must not.

**Verification:** Two `hr-ui.probe.tsx` cases import the real components with the real draft guard provider. They assert that a typed reviewer reason disappears after revision 2 → 3 and that a typed employee reason becomes empty after supervisor certification 1 → 2. They also assert that no `alertdialog` was shown. This extends the prior employee-record draft finding to different callers; `EmployeesScreen`'s previous fix is present and is not re-reported.

## SOL-02 — Untouched re-review times change attendance minutes

**Locations:** `src/features/hr/ReviewDetail.tsx:514`, `:548`, `:550`, `:563`; `src/features/hr/TimeSideField.tsx:22`, `:40`; `convex/hr/review.ts:535`, `:542`, `:554`; `convex/model/hr/attendance.ts:69`.

**Trigger/reproduction:**

1. A scheduled day has an original clock-in of **08:30:50** and missing checkout.
2. The supervisor certifies WORKED with a missing checkout at **17:30:00**, retaining the exact original clock-in. With a 60-minute break, the registered detail query returns **479 worked minutes**.
3. Open **Review again**, edit only the reason, leave the prefilled 08:30 / 17:30 fields untouched, and certify WORKED again.
4. The component emits both sides as minute-only inputs. The backend stores a new effective start at **08:30:00**, and the real query now returns **480 worked minutes**.

**Expected:** Re-certifying unchanged time fields should preserve the exact previously certified instants and duration. Changing only the rationale must not silently add or remove attendance minutes.

**Actual/user impact:** The reviewer cannot see the seconds that are discarded. The saved effective interval changes despite untouched fields; its computed minutes can differ by one and can later flow into a newly frozen attendance period/CSV. This is attendance data correctness, not a payroll calculation claim.

**Root cause:** `sideFromInstant` marks the formatted HH:mm side as untouched, but `DispositionForm` explicitly calls `toLocalTimeInput(side, false)`, forcing serialization of both sides to minutes. The current mutation can fall back only to original clock events, not the current certification interval. A simple change to `true` would therefore fail or revert effective certification times when originals are missing or differ from the certification.

**Suggested narrow fix:** Add a narrow, revision-checked way to retain each exact current certification side during re-review (with original-event fallback only where appropriate). Send explicit edited local times only for touched sides. Preserve the expected revision guard and server-side date/order/future/duration validation; do not accept an arbitrary unvalidated client timestamp as the fix.

**Verification:** The UI observation probe asserts the actual unchanged `ReviewDetail` form sends `start: {minute: 510, nextDay: false}` and `end: {minute: 1050, nextDay: false}` even when the certification contains seconds. The backend probe creates a valid missing-checkout day, certifies it through the real handler, then applies the emitted minute payload. The real `dayDetail` result changes from 479 to 480. The earlier employee correction fix for preserving untouched seconds remains present; it does not cover `DispositionForm`.

## Commands and results

- `pnpm exec vitest run --config docs/reviews/system-audit-2026-10-14/sol/vitest.config.mts hr-ui --reporter=verbose` — 1 file / 3 observational cases passed; output in `hr-ui.log`.
- Initial `backend stack-ui` run — 2 backend cases passed; the UI probe had a selector typo (missing comma in the accessible label). Corrected only the new probe; this initial harness error is recorded in `backend-and-stack-ui.log` and is not counted as application evidence.
- `pnpm exec prettier --write docs/reviews/system-audit-2026-10-14/sol/vitest.config.mts docs/reviews/system-audit-2026-10-14/sol/hr-ui.probe.tsx docs/reviews/system-audit-2026-10-14/sol/stack-ui.probe.tsx docs/reviews/system-audit-2026-10-14/sol/backend.probe.ts` — passed, confined to new audit artifacts.
- `pnpm exec vitest run --config docs/reviews/system-audit-2026-10-14/sol/vitest.config.mts --reporter=verbose` — **3 files / 6 observational cases passed**; authoritative final output in `probes.log`.
- Parent verification: `pnpm exec tsc --noEmit --incremental false` — passed, exit 0 with no diagnostics. The parent also completed the existing full suite: 282 files / 3,315 tests passed. These checks were reported by the parent and are not claimed as independent runs by this reviewer.

Read AGENTS.md, installed Next.js Vitest/use-client documentation before writing probes, the Back contract and inventory, HR phase-1 requirements, and the prior daily audit plus implementation reports. Inspected finished-goods packing/batches, placement/recommendation/move/stack/scanning paths; storage position/zone/floor writes; HR attendance/review/employee/access/period flows; and shared async/task completion ownership. No `CONTEXT.md` or ADR files were found by the repository filename search.

## Exclusions and limits

- The 13 October audit's 23 implemented fixes were checked for current presence and excluded as stale findings. This report does not claim to retest every previous issue.
- Coincident rack/floor leaf surfaces were considered but excluded: no confirmed domain rule or material incorrect workflow outcome was established. Stacked surfaces at the same x/y and different z are legitimate.
- The parent agent owns browser/UI-copy review and the full existing test-suite baseline; those are separate evidence. No live server, production account, physical camera, provider API, deployment, or persistent backend write was used here.
- Controlled UI subscription replacements reproduce the real component behavior; they do not simulate Convex subscription scheduling or production OCC timing. Backend calls invoke real registered handlers through the project's local tenant harness.
- There are no confirmed new P1/P3 issues in this bounded functional review. Passing normal tests does not cover the new triggers above. Existing app/tests/configs were not modified to fix these defects.
