# Verified English HR raw footage and independent acceptance

Three tutorial chapters pass: **9 preferred clips, 236.92 seconds total**. These are raw screen recordings for the coordinator's Kiro/Opus edit, with English UI and English event labels. No voiceover or HyperFrames edit was produced.

**Full browser acceptance is withheld:** the mobile HR-employee role case still redirects to sign-in during its final restored-admin check. Its preceding denial/self-service assertions and exact local-role restoration completed, but its final UI assertion failed. Cause unknown; it was not retried or patched. The original recording-time backend stall also remains unexplained.

## Chapters and files

| Chapter                                   | Verdict  | Preferred clips | Total raw duration |
| ----------------------------------------- | -------- | --------------- | ------------------ |
| 1. Company and organization               | **PASS** | 2               | 41.00s             |
| 2. Employee personal, contact and payment | **PASS** | 3               | 63.72s             |
| 3. Fixed shift and dated roster           | **PASS** | 4               | 132.20s            |

[Ordered clip manifest](/Users/macbook/.t3/worktrees/industrial-sas/t3-fe2d6cf1/output/hr-verified-english/evidence/chapter-order.json), [all takes](/Users/macbook/.t3/worktrees/industrial-sas/t3-fe2d6cf1/output/hr-verified-english/videos.json), [actual timestamped events](/Users/macbook/.t3/worktrees/industrial-sas/t3-fe2d6cf1/output/hr-verified-english/events.json), [media verification](/Users/macbook/.t3/worktrees/industrial-sas/t3-fe2d6cf1/output/hr-verified-english/evidence/media-verification.json).

| Order | Raw clip                                                                                                                                                                          | ffprobe duration |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1.1   | [company-save-reload](/Users/macbook/.t3/worktrees/industrial-sas/t3-fe2d6cf1/output/hr-verified-english/raw/company-save-reload-1793643325565-a77f2a8a.webm)                     | 19.20s           |
| 1.2   | [organization-save-reload](/Users/macbook/.t3/worktrees/industrial-sas/t3-fe2d6cf1/output/hr-verified-english/raw/organization-save-reload-1793642783902-a858e199.webm)           | 21.80s           |
| 2.1   | [employee-personal-save-reload](/Users/macbook/.t3/worktrees/industrial-sas/t3-fe2d6cf1/output/hr-verified-english/raw/employee-personal-save-reload-1793642896172-0298d0e3.webm) | 22.08s           |
| 2.2   | [employee-contact-save-reload](/Users/macbook/.t3/worktrees/industrial-sas/t3-fe2d6cf1/output/hr-verified-english/raw/employee-contact-save-reload-1793642896172-0298d0e3.webm)   | 22.04s           |
| 2.3   | [employee-payment-save-reload](/Users/macbook/.t3/worktrees/industrial-sas/t3-fe2d6cf1/output/hr-verified-english/raw/employee-payment-save-reload-1793642896172-0298d0e3.webm)   | 19.60s           |
| 3.1   | [fixed-shift-save-reload](/Users/macbook/.t3/worktrees/industrial-sas/t3-fe2d6cf1/output/hr-verified-english/raw/fixed-shift-save-reload-1793643049527-83f7ea35.webm)             | 28.24s           |
| 3.2   | [roster-shift-save-reload](/Users/macbook/.t3/worktrees/industrial-sas/t3-fe2d6cf1/output/hr-verified-english/raw/roster-shift-save-reload-1793643049527-83f7ea35.webm)           | 34.56s           |
| 3.3   | [roster-off-save-reload](/Users/macbook/.t3/worktrees/industrial-sas/t3-fe2d6cf1/output/hr-verified-english/raw/roster-off-save-reload-1793643049527-83f7ea35.webm)               | 34.44s           |
| 3.4   | [roster-clear-save-reload](/Users/macbook/.t3/worktrees/industrial-sas/t3-fe2d6cf1/output/hr-verified-english/raw/roster-clear-save-reload-1793643049527-83f7ea35.webm)           | 34.96s           |

Only preferred clips form the complete verified chapter sets. Earlier native/short pacing takes remain non-preferred; failed setup and original private takes are retained. Raw files are not cut to hide a failed ending.

## Actual save and reload evidence

| Chapter/step      | Before                                                | Shown action and after reload                                                                                                                   | Evidence                                                |
| ----------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Company profile   | TRAIN Tutorial Company, v10                           | One UI Save; TRAIN Tutorial Company Guide, v11, retained after reload                                                                           | company-db.json; company-reloaded.png                   |
| Organization      | No matching training department                       | One UI Save; TRAIN Tutorial Operations e199, ACTIVE v1; exactly one matching row after reload                                                   | organization-db.json; organization-reloaded.png         |
| Employee personal | New unlinked TRAIN fixture; profile v0, empty profile | TRAIN Avery first name and nickname saved; profile v1; reload retained both                                                                     | employee-before.json; employee-personal-db.json         |
| Employee contact  | Same employee after personal save, profile v1         | Synthetic email/address saved once; profile v2; reload retained both                                                                            | employee-contact-db.json                                |
| Employee payment  | Same employee payment v0, null                        | Synthetic BANK details saved once to v1; authorized editor showed the synthetic number; reloaded summary masked it to the last four digits 6789 | employee-payment-db.json; employee-payment-reloaded.png |
| Fixed shift       | No matching shift on the new training site            | One UI Save; 08:00–17:00, break 60, v1; reload and site reselection retained it                                                                 | shift-db.json                                           |
| Dated SHIFT       | October 21 and 22: revision 0, weekly plan            | Both dates saved as SHIFT, revision 1; reload/readback matched                                                                                  | roster-shift-db.json                                    |
| Dated OFF         | Both dates SHIFT revision 1                           | Both saved as OFF, revision 2; reload/readback matched                                                                                          | roster-off-db.json                                      |
| Dated Clear       | Both dates OFF revision 2                             | Both cleared, revision 3; no assignment; weekly 09:00 plan restored after reload                                                                | roster-clear-db.json                                    |

Evidence above is actual authenticated local Convex readback, reduced to synthetic fields, versions and plan/assignment data. Fixture creation is off-camera setup, not UI acceptance. No employees, attendance or history were deleted or reset. The dedicated TRAIN roster site avoids the intentional 50-employee site bound; its data is additional local training data.

Scope: one department represents organization-master save/reload; positions/levels, branches, logo editing and employee lifecycle are not newly filmed. Lifecycle passed browser tests. Leave approval remains **BLOCKED by SELF_REVIEW** with the single authorized identity; no reviewer or policy bypass was introduced. Do not claim payroll, tax generation, geofence or legal-benefit correctness. Company bank wording is stored-primary only. Payment permission is hr.admin.manage; the full synthetic number is visible in the authorized editor, and only the summary is masked. Only claimed working dates are leave-locked; no new leave-lock video claim is made.

## Exact source and integration

Checkout: /Users/macbook/.t3/worktrees/industrial-sas/t3-fe2d6cf1; branch t3/hr-verified-recordings. Fast-forwarded the existing linear a2e964e2..3c818ae5744511c234ebb7c699ba0ca11f1e207b with all original commits and attribution. No branch switch, push, deployment, PR, child agent, shared HRZoft write or dependency reinstall.

Every preferred clip ran on **7d7b82a4627b7fbb4fd3399264f1d8d4ac7f690e, source_dirty=false**. This retains the proven EmployeesScreen committed-URL fix. Subsequent production changes: none. Local increments are harness/fixture changes:

- 7d7b82a4627b7fbb4fd3399264f1d8d4ac7f690e test(hr): reselect isolated roster site after real remount
- 659e128698ee19d26f522a14bbc1ef76c6e89358 test(hr): isolate roster fixtures from accumulated employee acceptance data
- 88049421b0f0917793f076e07460646cdd5776e7 test(hr): retain unique backend and web logs for every acceptance run

Ignored recorder variants are separately hashed and retained in [capture-helper-hashes.json](/Users/macbook/.t3/worktrees/industrial-sas/t3-fe2d6cf1/output/hr-verified-english/evidence/capture-helper-hashes.json). Native non-preferred footage used 88049421. Recorded browser/backend endpoints were only localhost:3110 and 127.0.0.1:3320/3321. Port 3100 was untouched. Eight applicable fields from the source's nine-field TEST allowlist were privately reused; the optional Clerk sign-in URL used its default. The designated real test user/org were verified. An offline copy of the source's stopped local Convex data became this checkout's private writable data; the source data was not changed.

## Browser runs — every failure retained

All runs: workers 1, retries 0; existing case 120s, expectation 30s, navigation 60s and global 15min limits. Each group had its own service lifetime and archived report. No global timeout fired. Pixel 7 means Chromium emulation, not a physical phone or Thai-UI acceptance.

| Bounded run              | Passed | Failed | Skipped | Exact source          |
| ------------------------ | ------ | ------ | ------- | --------------------- |
| employees                | 12     | 0      | 0       | 88049421; dirty=false |
| employee-recovery        | 12     | 0      | 0       | 88049421; dirty=false |
| employee-lifecycle       | 6      | 0      | 0       | 88049421; dirty=false |
| missing-mobile           | 2      | 2      | 0       | 88049421; dirty=false |
| roster-isolated          | 0      | 1      | 0       | 659e1286; dirty=false |
| roster-isolated-reselect | 1      | 0      | 0       | 7d7b82a4; dirty=false |

Thirty employee/recovery/lifecycle cases passed, including the exact delayed-RSC regression, the original unsent-reload case on both projects, query/hash restoration and genuine response-gated pending-write protection. The 51 caller checks separately cover header/native Back, explicit closure/next Back, direct links, locale, drafts, Forward and remount behavior; they supplement the real browser cases.

The first four-case mobile run passed supervisor authorization and fixed-shift persistence. It failed the employee-role final sign-in transition and the roster's initial row wait. Actual roster UI said the data could not be shown completely. The guarded fixture measured **at least 51 source-site employees against the supported limit of 50**; search happens after the bounded site scan. A new site allowed the first SHIFT to save and read back, then its real remount reset the view filter to the first site and exposed the old site's bound again. That follow-up failure is retained. The final harness correction reselects the isolated site after reload; the same mobile caller then passed SHIFT/OFF/Clear and newly recorded-cell deselection. No production bound, timeout or test assertion was relaxed.

Across the six runs there were **36 executions: 33 passes and 3 retained failures**. Among the 34 distinct requested cases, 33 have a passing final result and the employee-role case remains failed. This does not erase the old 49-pass/1-fail/1-interrupted/3-unexecuted evidence in the source handoff. No second foundation or full-repository test pass was run.

Reports, failed screenshots and authentication diagnostics remain private under .cache/hr-verified/acceptance-*/ and .cache/hr-browser/. Publication includes only sanitized [acceptance.json](/Users/macbook/.t3/worktrees/industrial-sas/t3-fe2d6cf1/output/hr-verified-english/evidence/acceptance.json) and [role failure metadata](/Users/macbook/.t3/worktrees/industrial-sas/t3-fe2d6cf1/output/hr-verified-english/evidence/role-failure-sanitized.json).

## Capture history and cuts

T3 preview opened and recorded a complete native company save/reload. A second organization take saved/reloaded but ran too quickly for tutorial use (2.58s); it remains private/non-preferred. Two native recording-start attempts failed; the observed error was “Preview automation recordingStart timed out after 15000ms,” followed by “No preview automation host is available.” A native stop attempt did not return and was bounded/terminated; final native tab closure later succeeded.

The fallback is **headed Google Chrome, 1280×800, slowMo 200, real CDP screencast in the same authenticated context**. Authentication, pinned identity/org checks, required-route warming and editor URL commitment occurred before capture. Actual JPEG frames were throttled to at most about 5.6 fps and encoded VFR with their timestamps; an unchanged final frame is held only through the actual capture stop time. ffprobe durations, SHA-256 hashes, source flags and event epochs were verified. No audio, mock scene, response fabrication or edited ending.

The first Chrome company segment passed, then the recorder attempted its next API token read before Clerk finished loading after navigation. It failed before any backend call. That setup failure, load snapshot and service logs are retained. A defined recorder-only readiness gate fixed this new harness error; only the missing organization segment was captured on fresh services. This does **not** explain or repair the older 1s backend timeout. A later company-only take improved pacing; the shorter 14.72s verified take is retained/non-preferred.

One chapter per service lifetime; fresh owned services between chapters and defined follow-ups. Raw scrolling, selector changes and reload loading are retained. The roster site/month/employee filters reset on remount and are reselected visibly; do not caption them as automatically retained. The company/organization settings page is long; final row/name views may show only the relevant section. The editor may trim reload/loading intervals bounded by actual reload-start and reloaded event timestamps, and idle holds, but must retain the saved/reloaded proof. All publication values are synthetic. Previous eight failed private takes remain at their original paths, referenced by prior-private-takes.json; they are not preferred.

Actual direct API measurements: 28 reads, approximately **30.5–93.4ms**; 30 total HTTP measurements including fixture writes. Successful local responses did not expose a server request ID in checked headers/body, so requestId is null, explicitly unavailable. No ID was invented. Matching time windows, backend/web logs and PID/PGID journals are retained uniquely under .cache/hr-browser/runs/*/ and .cache/hr-verified/. No recording-time backend timeout or app read-error was observed in the passing clips. The old recording stall's cause remains **unknown**; no host-cause claim or limit increase.

## Final checks and cleanup

After all owned services stopped: normal lint, navigation, discovery, TS6 and the focused EmployeesNavigation/EmployeeProfileSections caller tests passed (**51/51**). Navigation: 60 route/error policies, 309 owners, 26 intents; discovery: 397 Vitest files, 27 Playwright specs. Guard checks passed 23 initially and 27 after the isolated-site helper was added; these overlap and are not additive.

All **42 owned Clerk sessions are revoked**, with zero active or unknown lookups; unrelated sessions were not queried or revoked. Local roles before/final restoration were exactly ORG_ADMIN, HR_ADMIN, HR_EMPLOYEE. All 65 journalled process groups are gone. Owned headed contexts and the T3 tab are closed. Final loopback and wildcard preflight found 3110/3320/3321 free and no run lock. No private logs, credentials, Clerk IDs or private PII are included in this publication bundle. See evidence/final-checks.json, sessions-final.json, roles-final.json, process-groups-final.json and ports-final.json.

Observed post-capture clock gap: UTC was 18:19:06 at the checks/readback inspection and 19:49:15 at the next printed clock observation. Cause unknown. Captured frame/event epochs and ffprobe durations are retained verbatim; this post-capture gap is not represented as tutorial time or claimed active work time.

RESULT: company-org=PASS employee=PASS shifts-roster=PASS
