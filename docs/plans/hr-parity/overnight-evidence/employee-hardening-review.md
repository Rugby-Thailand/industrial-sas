# Independent employee hardening review and integrated checkpoint

**Changes requested: two reproduced P2 defects remain.** The integrated broad gate passes **1,202/1,202 across 82 files**, but this does not approve F1/F2 or replace browser acceptance. No production fixes were made by this review. The coordinator can use this checkpoint for the subsequent browser/roster integration while assigning the two fixes below.

## Source, ownership and scope

- Review checkout: `/Users/macbook/.t3/worktrees/industrial-sas/t3-0318b436`, branch `t3/review-employee-hardening`. Initial HEAD `a2e964e2`; integrated production HEAD `3c22c75f2ffee8b598cfc17688536ed43904b0e3`. The final review commit adds only tests, retained probes and this evidence.
- Applied the complete linear `a2e964e2..88c2f1d5` range, then **only** `c30b87e04da1ef416b2060a9cc7222f631e20788`, `fbbd1f7a7a023f73d0e4da120b65971c8e06795b`, `245083a67389acf5420c6b8ed5b19819735925ec`. No duplicate employee/foundation baseline or roster/harness commits were applied.
- The local combined-base tree at `b6c33f4e` and source `88c2f1d5` are identical: `5a524bb44780354a2d09edfc9c3be3f07a6ec865`.
- One mechanical conflict: the `convex/hr/policies.ts` imports. Preserved Kiro's `WORK_RULES_EXECUTION` and `validatePolicyCapability`, alongside hardening's `isEmployedOn` / `employmentOf`. The only functional policy diff from the combined base replaces the two outer-date eligibility checks with the shared interval predicate. No work-rules semantics, API snapshots or generated files were regenerated to resolve the conflict.
- Read the main checkout's overnight plan, source `employee-hardening.md`, original independent `employee-lifecycle-review.md` including retained R/U probes, root AGENTS/CLAUDE, Back contract and relevant exact inventory entries, S03 spec, backend-compatibility/Bun-runtime documents, installed Next 16.3.8 forms and `useSearchParams` guides. Used the code-review and conflict-resolution skills; both review axes were performed personally, with no subagents.
- All writes were limited to this isolated checkout. No branch switching, shell-created checkout, changes to another checkout, production/shared-demo writes, push, PR or deployment. No browser services or listeners on 3100/3320/3321 were started. Roster review remains with the separately assigned reviewer; no roster changes were inspected or integrated here.
- Observed local timestamps span approximately 23:50 November 1 through 01:45 November 2 Bangkok. This exceeds the requested 45–60 minute wall-clock window. Adjacent command logs jump from 00:00 to 01:00, and the first broad invocation records 1,179.82 seconds with one test lasting 1,037,598 ms despite a 5,000 ms timeout. These observations do not prove a host-sleep or scheduling cause. This report retains the failed run and does not claim the requested timing bound was met. Freeze remains 06:30 and stop remains 07:00 Bangkok.

## Findings

### H1 — P2: Completing a section save asks to discard the unrelated employment draft (F1 acceptance incomplete)

**Exact location:** `src/features/hr/EmployeeProfileSections.tsx:774`; the same completion pattern is at 914 and 1070. The section Dialog completion owner is at 548–550. `useNavigationDraft.settle` explicitly routes its callback through the global prompt when another entry is dirty (`src/components/navigation/navigationDraft.ts:43`).

**Reproduced in the actual `HrEmployeesScreen` caller:** open an existing employee, edit the main **Display name** to `Unsaved employment name`, open Personal details, enter a nickname, return a successful profile mutation result. Instead of completing just Personal details while retaining the employment draft, the screen opens **Save changes before leaving?**. The retained probe fails specifically because that unexpected discard dialog exists. Its mutation was invoked once and returned success. No query version refresh is necessary for this additional ordering.

The call to `guard.settle(onSaved)` submits the section's local completion callback to the global transition guard before the Back-aware Dialog gets to consume its owned entry. Thus an independent, unsaved underlay can gate a successful foreground completion. This violates the explicit Back contract to preserve the retained underlay draft. The test proves the unwanted prompt; it does **not** claim automatic data loss or a browser result. Personal is directly reproduced; Payment/Lifecycle share the inspected pattern but are not credited as independently reproduced here.

**Requested correction:** settle the saved section's own guard and complete its own live Dialog entry while preserving the employment underlay. Do not globally discard or settle the unrelated main form, weaken pending protection, or remove the prompt for real page departures. Add the exact caller case for dirty underlay → section success → retained underlay → next Back.

**Retained repro:** `employee-hardening-review-probes/underlay-completion.test.tsx.txt`. Copy to `src/features/hr/EmployeeHardeningUnderlay.probe.test.tsx`, run `pnpm exec vitest run src/features/hr/EmployeeHardeningUnderlay.probe.test.tsx --maxWorkers 2`, then remove the temporary test. On this checkpoint: **exit 1, one reproduced failure**, `/tmp/employee-hardening-review-underlay-final.log`, 01:02:13. The Next/Convex client hooks are mocked at the caller boundary; this is jsdom, not browser acceptance.

### H2 — P2: Direct day details invent an attendance exception inside the separation gap (F2 consumer coverage incomplete)

**Exact location:** `convex/hr/dayDetail.ts:133`–145, where an absent day gets `livePlan` and `evaluateDay` without employment eligibility. Both `convex/hr/self.ts:749` and `convex/hr/review.ts:529` use this result. The corresponding callers offer correction/disposition based on it (`src/features/hr/DayScreen.ts:102`, `src/features/hr/ReviewDetail.tsx:299`–308).

**Registered Convex reproduction:** hire an employee with a daily 09:00–18:00 schedule; offboard September 30; reinstate October 19. Query October 5, with no day or clock event inserted. Self history truthfully returns `rows: []`. Nevertheless **both** registered day-detail queries return `ok:true`, `plan.kind:SCHEDULED`, `status:EXCEPTION`, `issue:MISSING_RECORD`, `revision:0`. Registered correction and disposition writes for the same date both refuse `HR_OUTSIDE_EMPLOYMENT`.

**Actual caller reproduction using those exact registered responses:** `HrDayScreen` displays **No attendance**, offers **Send request**, accepts a filled proposal, then displays the refusal. `ReviewDetail` displays the same false exception and offers **Save disposition**. The two caller probes fail because those impossible write controls remain present. Their input is the retained, synthetic registered response in `gap-day.json`, not an invented test-only day shape.

This leaves the F2 fix inconsistent across consumers: period/history/queue and write eligibility exclude the gap, while a valid date deep link manufactures an obligation for it. No unauthorized write or frozen-output change is asserted. The shared detail helper existed before hardening; this is a missed required interval consumer, not a new line regression attributed to the import merge.

**Requested correction:** make direct details and their action eligibility interval-aware, particularly when no recorded day exists. Return an explicit outside-employment result or non-obligation view. Preserve genuine captured historical days, frozen outputs and earlier approved history; do not solve this by hiding all historical records or changing the original hire date.

**Retained repros:** `employee-hardening-review-probes/gap-backend.test.ts.txt`, `gap-caller.test.tsx.txt`, and `gap-day.json`.

```sh
cp docs/plans/hr-parity/overnight-evidence/employee-hardening-review-probes/gap-backend.test.ts.txt tests/integration/hr-parity/employee-hardening-review-gap.probe.test.ts
pnpm exec vitest run tests/integration/hr-parity/employee-hardening-review-gap.probe.test.ts --maxWorkers 2
cp docs/plans/hr-parity/overnight-evidence/employee-hardening-review-probes/gap-caller.test.tsx.txt src/features/hr/EmployeeHardeningGap.probe.test.tsx
pnpm exec vitest run src/features/hr/EmployeeHardeningGap.probe.test.tsx --maxWorkers 2
rm tests/integration/hr-parity/employee-hardening-review-gap.probe.test.ts src/features/hr/EmployeeHardeningGap.probe.test.tsx
```

Backend: **exit 1, one reproduced assertion**, `/tmp/employee-hardening-review-gap-final.log` (same invocation's 11 independent controls passed). Caller: **exit 1, two reproduced assertions**, `/tmp/employee-hardening-review-gap-caller-final.log`. The latter calls actual screen components with mocked client hooks and the registered response; it is not an authenticated browser/deployed-backend run.

## Independent acceptance matrix

| Finding | Checked on this integration                                                                                                                                                                                                                                                                                                                                          | Result / limit                                                                                                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1      | Original U1/U2; version advancement and temporary loading; Personal/Contact/Payment/Lifecycle pending ownership; Cancel/header/native Back; identity/tenant invalidation; direct link/query/hash/locale/Forward/remount caller cases. Added PROFILE_STALE and PAYMENT_STALE replies retaining drafts and original version.                                           | Original remount/data-loss defects no longer reproduce. **H1 remains** for a dirty main-form underlay. Actual caller components in jsdom; no real subscription/browser acceptance. |
| F2      | Original R5; repeated exits/rejoins; inclusive first-exit/rejoin endpoints; modern and legacy main edits; live periods, self history, clocking, leave dates, correction/disposition and review queue; policy opening/readiness and announcement audience; frozen period, earlier approved leave/payslip history. Added leap-day original-hire annual-account anchor. | Core interval seam and original history anchor pass. **H2 remains** for absent direct day details.                                                                                 |
| F3      | Original R1/R1b/R4; same-version transactional races; first/latest effective index; 104 real registered transitions at equal recording timestamps with display capped at 100; main date edits bounded by first/latest events; unchanged historic future probation plan retained through legacy and modern unrelated edits.                                           | No additional reproduced defect. In-memory Convex transaction scheduling is not a deployed distributed OCC proof.                                                                  |
| F4      | Original R2 and shared `validateEmployeeOrgReferences`; missing assignment leaves record/events unchanged; registered inactive assignment repair with replacement marker, legacy omission preservation, successful reinstate. Added actual caller refusal → Cancel/discard → main assignment edit producing INACTIVE/last-day/replaceOrgFields repair packet.        | No additional reproduced defect. Caller repair packet is verified at the client boundary; backend repair/retry is independently registered.                                        |
| F5      | Original R6/U3; all three client intent/registered operation mappings; ID-only reload COMMITTED/FENCED; late retired write; actor/tenant denial; all three admin-permission withdrawals with self permission retained; reconcile/command races in both orderings; no private browser payload persistence.                                                            | No additional reproduced defect. Existing receipt-scope policy remains excluded.                                                                                                   |
| F6      | Original R7 through registered clock-in, midnight offboard refusal, 06:00 clock-out and later offboard; ordinary closed shift and stale version. Added current-schedule edit after clock-in: refusal still uses captured 06:00 plan until 09:59:59.999; at exact 10:00 deadline self clock-out expires and offboard is allowed.                                      | No additional reproduced defect in the supported active final-shift path. No invented login-disable/settlement policy.                                                             |

The 11 added registered boundary tests are retained in `tests/integration/hr-parity/employee-hardening-review.test.ts`. Three additional passing caller cases are retained in `src/features/hr/EmployeeProfileSections.test.tsx` (28 total in that file). The negative repros remain archived as `.txt` so they are review artifacts, not silently skipped or passing implementation coverage. No timeout, fixture exemption, snapshot-update flag or navigation policy was changed.

Selected mutation check: temporarily changed `employmentOf`'s `intervals: employee.employmentIntervals` to `intervals: undefined`. Running only `independent main edits preserve two gaps...` failed as expected (exit 1; 1 failed / 10 filtered skips, `/tmp/employee-hardening-review-mutant-intervals.log`). A `finally` block restored the exact source bytes; SHA-256 `1a7cc872b7d309d1b119e885b24b3ba69fee44f9cd24462057b80aa4d6b366ce`. `git diff HEAD -- convex/hr/shared.ts` is empty after restoration. Skips are not credited as passes.

## Integrated gates and retained limitations

All commands ran from this checkout on Node 24.19.0 / pnpm 10.33.2 / Vitest 4.1.11. Tests use isolated convex-test tenants; no application database was contacted. Counts overlap and must not be added.

| Command                                                          | Result                                                                                    | Log                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                 | 0                                                                                         | `/tmp/employee-hardening-review-install.log`       |
| Original integrated retained/caller/exact-combined command below | 0; 70 tests / 5 files                                                                     | `/tmp/employee-hardening-review-original.log`      |
| Added registered controls                                        | 0; 11/11 (included again in broad final)                                                  | `/tmp/employee-hardening-review-gap-final.log`     |
| Final employee caller file                                       | 0; 28/28                                                                                  | `/tmp/employee-hardening-review-callers-final.log` |
| Broad HR+contracts command below, first invocation               | **1; 1,173 passed / 4 test timeouts, 1 worker-start error; 81 files, 1,179.82s**          | `/tmp/employee-hardening-review-broad.log`         |
| Same broad command once more, with other gates complete          | **0; 82 files / 1,202 passed, 48.45s, zero failures/skips/todos**                         | `/tmp/employee-hardening-review-broad-final.log`   |
| `pnpm lint` normal full ESLint, final tests included             | 0                                                                                         | `/tmp/employee-hardening-review-lint-final.log`    |
| `pnpm check:navigation`                                          | 0; 68 fixtures, 58 policies / 304 owners / 26 intents                                     | `/tmp/employee-hardening-review-navigation.log`    |
| `pnpm typecheck:ts6` final tests included                        | 0; Next typegen + TS6                                                                     | `/tmp/employee-hardening-review-ts6-final.log`     |
| `node scripts/ci/install-bun-checker.mjs`                        | 0; repo-pinned Bun 1.4.3 / TS 7.0.2, checksum verified, task-local `.cache/bun-checker`   | `/tmp/employee-hardening-review-bun-install.log`   |
| Pinned Bun first on PATH, `pnpm typecheck` final tests included  | 0; 1,086 files, no type errors                                                            | `/tmp/employee-hardening-review-bun-final.log`     |
| `pnpm exec tsc -p convex/tsconfig.json --noEmit`                 | 0                                                                                         | `/tmp/employee-hardening-review-convex-types.log`  |
| `pnpm ci:codegen`                                                | 0; generated bindings match pinned CLI; its credential-free disposable backend cleaned up | `/tmp/employee-hardening-review-codegen.log`       |
| `pnpm ci:test-discovery` after staging new tests/probes          | 0; 387 Vitest files / 17 Playwright spec files                                            | `/tmp/employee-hardening-review-discovery.log`     |
| Credential-free `pnpm build` below                               | 0; optimized Next production build completed                                              | `/tmp/employee-hardening-review-build.log`         |
| `git diff --check`                                               | 0                                                                                         | Final command output                               |

First broad timeouts: PolicyLeave explicit leave-history close; HrClientRecovery pending preference receipt; HrPagedRecovery editor/list page restoration; AnnouncementsNotifications Bangkok scheduling. Worker-start error: ShortcutCustomizeScreen. All are included in the passing final run. No causal attribution to baseline or changed production code is established. The second run changed execution conditions (other gates had finished), not assertions or source. No further broad runs were started after the coordinator's 01:44 scope steer.

Early new-test mistakes are retained in local logs: correction input initially used `time`/`date` instead of the exact registered `{minute,nextDay}` validator; the caller probe initially used `Clock-in` instead of `Correct clock-in`; repair-flow tests initially used the wrong Discard label and passed an element instead of a string to the select fixture. These were test-writing failures, corrected against production signatures/labels without production changes. A more complicated repair probe led to H1; its reduced standalone reproduction is retained above.

```sh
pnpm exec vitest run \
  tests/integration/hr-parity/employee-hardening.test.ts \
  tests/integration/hr-parity/combined-integration.test.ts \
  src/features/hr/EmployeeProfileSections.test.tsx \
  src/features/hr/EmployeesNavigation.test.tsx \
  src/features/hr/EmployeeForm.employment.test.tsx --maxWorkers 2

pnpm exec vitest run \
  src/features/hr convex/model/hr \
  tests/integration/hr-*.integration.test.ts tests/integration/hr-parity \
  tests/integration/public-function-contract.integration.test.ts \
  tests/integration/public-api-registered-coverage.integration.test.ts \
  tests/integration/production-schema-compatibility.integration.test.ts \
  tests/integration/schema-contracts.integration.test.ts \
  tests/integration/tenant-index-policy.integration.test.ts \
  tests/isolation/schema-policy-guards.isolation.test.ts --maxWorkers 2

PATH="$PWD/.cache/bun-checker/bun-v1.4.3-bun-darwin-aarch64:$PATH" pnpm typecheck

env -i PATH="$PWD/.cache/bun-checker/bun-v1.4.3-bun-darwin-aarch64:$PATH" \
  HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" CI=1 NEXT_TELEMETRY_DISABLED=1 \
  CI_EXTERNAL_TYPECHECK=1 pnpm build
```

The exact combined test remains unchanged (including the original six-field marker and logo revision/ABA protocol). Public function/schema/index tests ran against the committed snapshots without regeneration flags; Kiro's work-rules tests ran in the broad set. No full repository suite, authenticated browser, live Convex subscription, physical-device, real upload, deployed OCC, roster or full S03 parity claim is made. The excluded inherited pagination/receipt-policy observations were not reflagged. Browser/roster integration and the two reproduced fixes remain the coordinator's work.

## Source map

| Source commit                              | Local equivalent                           |
| ------------------------------------------ | ------------------------------------------ |
| `08d6065b691f85ea5a6bab0a9b649c6668961198` | `96a28f6c788e31fb5e93493f02054acc6e4b4d14` |
| `75e0c371bcf7fe1bd3ab321136515f8a8ee8883f` | `a822aad1d598608daf821692d3a703ae17dc8ba6` |
| `10da14271f319f9003a0b7d73ae9e462206e3641` | `a7c4c9e8e424bf4dda5b07d2246a6088dbc82ae8` |
| `6fcd71317246997d37dda565bde58fb84590a924` | `5eb6a7449ec605fe201bd8954e25ce8333f58a2e` |
| `d28ab2645a622df61bd63056c4c152e2af02b2f8` | `00a2350c308586a62af9920e3d160549431a8247` |
| `5cc53de69e6c4989d49868580c3ce45a5c9971d2` | `b133de4eba59e834dce898f216afa593de76cf84` |
| `9cf1d1e3600fca60e9d395dd83dbe0780e539a38` | `59ccc84ae9a7d075a2438cd4689a166e8559b833` |
| `0a11827fa317826ee42914a80dc6df752b504e3f` | `3f2bcf78f753b093185a99212fbf2656f1f7fd9a` |
| `22b474fd085e18c41e4b31ab1a0b4fdc46da4925` | `33c341b613a5da822e56e3130df587cee44bda14` |
| `6f8a85e088917d3e894182c14de3ad7b7de3e0c1` | `a624dbc8bc6de5e044ea96570e16d8ca63150f80` |
| `7b9697f5e7f9b76ea971eaec54534e0e42958b9d` | `241c2e6c1354fdfc47f079cab263779f2bce5d6a` |
| `fed39093366dcb207fbb738010dd27bde3662ee2` | `537419380721105799b011f4125887af0a94f88f` |
| `88c2f1d5e1cc2918742a52d68409bbb7753d6f0d` | `b6c33f4e1f812eced9e538534c81c672fe949908` |
| `c30b87e04da1ef416b2060a9cc7222f631e20788` | `d711042772e7a9e7ff037f4e4156acfba864c736` |
| `fbbd1f7a7a023f73d0e4da120b65971c8e06795b` | `6e2466eb27b555bebbf7559e97565c59eee8cf38` |
| `245083a67389acf5420c6b8ed5b19819735925ec` | `3c22c75f2ffee8b598cfc17688536ed43904b0e3` |

## Owned processes and cleanup

All install/test/check/build sessions were awaited and have completed. Long-running session IDs retained for ownership: install `58569`; original tests `94932`; Bun install `69645`; initial lint/navigation/codegen/TS6/Bun `89169`, `49256`, `90390`, `18794`, `12686`; boundary/probe iterations `47530`, `21859`, `30663`, `30936`, `81873`, `41712`, `32503`, `47109`, `71350`, `95323`, `46674`, `37518`; mutation `58336`; first broad `3352`; final lint/Bun/TS6/Convex types/build/discovery `62159`, `48821`, `56805`, `53925`, `67646`, `79311`; final broad `57570`.

Codegen owned its disposable loopback backend through the repository cleanup script. No application server, browser, watcher or detached job was started. An attempted exact-PID termination after the slow run returned “no such process” for all five listed children; subsequent session collection confirmed build, lint and both typechecks had already exited 0. No unrelated process was signalled. Temporary executable negative probes were removed; their exact source remains in the evidence directory. Dependencies, task-local Bun cache and `/tmp/employee-hardening-review-*` logs are retained locally.

Final process inspection found no matching process under this checkout's node_modules or task-local command names, excluding the inspection shell itself. All sessions are complete; zero owned survivors. `git diff HEAD -- convex/hr/shared.ts convex/_generated tests/integration/hr-parity/combined-integration.test.ts` is empty, confirming mutation restoration and no generated/combined-test drift. Final `git diff --check` passes. The evidence and maintained tests were checked with the repository Prettier; no production file changes follow the tested integrated head.
