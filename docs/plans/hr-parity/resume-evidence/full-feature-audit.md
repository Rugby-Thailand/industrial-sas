# Full HR feature audit (slices 01–09), 2026-11-02

Auditor: Claude Opus 5.5 via Kiro CLI. Read-only code audit of checkout `t3-513a7554` at `c5d21eaf` (branch `t3/hr-parity-recovery-audit`, merge-base with `main` `a2e964e2`). I changed no production or test code and started no server, browser or subagent. These docs are uncommitted and unstaged.

Outputs:

- `full-feature-matrix.json`: all 227 rows. The schema matches `feature-matrix.json` (`feature, slice, implementationStatus, verificationLevel, evidence, remaining`), and the row order and `feature`/`slice` values are identical.
- This file: method, what changed relative to `feature-matrix.json`, slice findings and storyboard corrections.

## Method

- I read the research task tables in `/Users/macbook/Development/industrial-sas/docs/plans/hr-parity/0{5..9}-*/spec.md`, the `seen/guess/unknown` labels, and `combined-audit.md`, `coordinator-review.md`, `final-handoff-2026-11-02.md` and `tutorial-storyboard.md`.
- I checked every slice 05–09 row against `convex/schema.ts`, `convex/model/hr/*`, `convex/hr/*` and `src/features/hr/*`, using function names and test titles. Test titles quoted in the matrix come from the actual collected test files. The only conditional skip in the HR suites is `tests/e2e/hr-local/workflows.spec.ts` line 48, where the clock case skips itself when the day's clock cycle is already used. There are no `todo`/`fixme`/`skip` markers in `tests/integration/hr-*`, `tests/integration/hr-parity`, `convex/model/hr` or `src/features/hr`.
- **Origin tags** in `evidence`: `[preexisting on main a2e964e2]`, `[branch change on t3/hr-parity-recovery-audit]`, `[absent on main and branch]`. The branch touched slice 05–09 files only to:
  - feed roster plans into `periods.ts`, `review.ts` and `self.ts`;
  - add gap-aware employment checks (`HR_OUTSIDE_EMPLOYMENT` in the day detail);
  - add `LEAVE_EMPLOYMENT_CHANGED` in `leave.ts decide`;
  - add the payslip employer block (`payslips.ts document`, `EmployeePayslipsScreen.tsx`);
  - add the employee payment section (slice 03).

  Everything else in slices 05–09 existed on `main` before this work.
- **Status rules**:
  - `delivered`, `partial` and `missing` describe our code against the row.
  - `blocked` means the research label is `unknown` and we have nothing for the row, so no parity target exists. Unknown rows where we do have related code keep that code's status and say in `remaining` that HRZoft's behaviour is unknown (the same rule the earlier generator used).
  - A missing implementation never upgrades an `unknown` HRZoft behaviour to "seen".
- **Verification levels** are only `none`, `registered-handler integration (convex-test)`, `… + jsdom caller tests` and `jsdom caller tests only (mocked Convex)`. A browser spec is named only where one exists, and every such spec is marked "not run on this source". Mocked jsdom tests do not count as backend verification. Skipped cases count as nothing.
- No percentage is given. Row counts measure rows, not effort.

## Changes relative to `feature-matrix.json`

Slices 01–04 and the cross-cutting rows are copied unchanged, with one exception supported by the code:

- **S01-07** (status unchanged, `partial`). The evidence now says that `convex/hr/payslips.ts document` returns `employer.primaryBankAccount = bankAccounts[0]`, but `EmployeePayslipsScreen.tsx payslipEmployer` renders only the name, tax ID and address. The bank account is never shown. `Payslips.test.tsx` passes a `primaryBankAccount` in its mock but asserts only the name, tax ID and address.

Slices 05–09: every row was re-audited. Seven statuses differ from the research baseline. The other 115 rows keep the baseline status, now backed by code evidence.

| Row | Baseline → now | Reason |
| --- | --- | --- |
| S05-11 | partial → delivered | The confirmed-time receipt exists (`SavedClock`, `HrScreens.test.tsx` "shows success only after the server confirms the saved time"). No browser verification on this source. |
| S05-18 | missing → partial | A `source` field exists on every punch but allows only `"ONLINE_SELF"`. |
| S07-09 | delivered → partial | The row asks for HRZoft's close and reopen rules, which are `unknown`. Our close/reopen is counted under S07-10 and S07-11. |
| S08-01 | partial → missing | There is no payroll period entity. Attendance periods and payslip import batches are not payroll periods. |
| S08-05 | missing → partial | The branch added an employee payment-destination editor (BANK/CASH, bank, account). There is still no salary, effective date or history. |
| S08-11, S08-12 | partial → missing | These are calculation rows. Attendance/leave inputs and frozen attendance versions exist, but nothing calculates or snapshots pay. |

## Row counts (full matrix)

| Slice | delivered | partial | missing | blocked |
| --- | --- | --- | --- | --- |
| 01 org/positions | 15 | 6 | 1 | 3 |
| 02 rules/calendar/roles | 1 | 14 | 7 | 3 |
| 03 employee/offboard | 7 | 11 | 5 | 2 |
| 04 shifts/roster | 10 | 6 | 5 | 4 |
| 05 clock-in | 2 | 6 | 13 | 2 |
| 06 requests/approval | 0 | 15 | 9 | 1 |
| 07 status/close/reports | 2 | 13 | 9 | 1 |
| 08 payroll/tax | 1 | 4 | 18 | 2 |
| 09 discipline/expense | 0 | 1 | 19 | 4 |
| cross-cutting | 1 | 1 | 3 | 0 |

## Slice findings (05–09)

**05 Clock-in.**
- What exists: basic online self clock only. `convex/hr/self.ts clockIn/clockOut` take only `requestId` and `expectedBusinessDate`. `hrAttendanceEvents.source` is `v.literal("ONLINE_SELF")`. The repeat guard (`HR_ALREADY_CLOCKED_IN/OUT`) and idempotent replay are covered in `hr-workflows.integration.test.ts` (A1, A2, A4).
- What is missing: GPS, geofence, QR, selfie, fingerprint device, workplace entity and device binding. The code contains no latitude/longitude/radius, camera, QR or device code. "fingerprint" in `periods.ts` is the period content hash.
- Supervisor view: `review.ts queue/queuePage` is an exception queue (code, name, site, date, status, issue, disposition), not HRZoft's all-employee daily board. In/out times appear only in the day detail. There are no late or on-time chips because lateness classification is INACTIVE.
- Browser: the clock case in `workflows.spec.ts` exists. Older runs included no-action skips. The later Sol baseline run on `0a07a193` performed two genuine desktop clock writes; mobile performed none and skipped. This is evidence on a different source checkpoint, not a run performed by this audit.

**06 Requests/approval.**
- Leave: a fixed list of nine leave types, whole days only, with a server charge preview.
- Corrections: a separate time-correction flow (submit, certify or return).
- Approval is one step. `shared.ts reviewAccess` lets the direct supervisor, or a holder of `hr.admin.manage` (site-scoped), who also has `hr.team.review`, decide alone. There is no ordered or configurable chain (S06-13 missing), no Reject status (RETURNED only), and statutory leave types cannot be returned.
- Withdraw and post-approval cancellation exist for leave only. Corrections cannot be withdrawn.
- Notifications are in-app only and go to the employee on a decision. Reviewers are not notified when a request is submitted. There are no external channels.
- Leave "evidence" is free text of up to 1000 characters, not a file upload.
- There are no WFH, holiday-change, shift-change, shift-swap or OT requests.

**07 Status/close/reports.**
- Attendance period close and reopen is the strongest area (S07-10 and S07-11 delivered at integration level). Close checks a fingerprint over server-recomputed rows, writes immutable `hrPeriodVersions/hrPeriodRows`, enforces closed-date guards, offers a site-scoped `exportCsv`, and `startRevision(reason)` opens the next draft.
- There is no browser test of close or export.
- Reports are absent apart from the CSV of one period version and the frozen totals (worked/leave/absent/nonworking). There are no time, OT, problem or team-leave reports and no Excel or PDF output.

**08 Payroll/tax.**
- There is no payroll calculation engine. Payslip import and display are a separate, non-calculating path, delivered at integration level (S08-22): `payslips.stage/publish` reconciles a 7-column aggregate CSV (`employee_code,period_from,period_to,payment_date,gross,deductions,net`) against per-employee PDFs and supports replacement versions and tickets.
- The employee payslip view shows only gross, deductions and net after fresh verification, plus the original PDF.
- No SSO, withholding tax, PND1/PND1Kor, 50 Tawi, provident fund, bank transfer file, earning/deduction catalogue or payroll state machine exists.

**09 Discipline/expense.**
- The schema has no tables and the code has nothing for warning letters, expense claims, installments or salary advances.
- The only partial row is S09-23, because employees can see their own payslips.
- Four rows are `blocked` (unknown in research).

## Tutorial storyboard corrections (`tutorial-storyboard.md`)

The tutorial is in English with on-screen captions and no voiceover. No footage exists. Video editing must follow the verified recordings, and a shot is dropped if its recording does not show the claim.

| Shot | Problem in draft | Source fact | Corrected caption or action |
| --- | --- | --- | --- |
| 1.2 | "The first account is the primary account on payslips." It copies the UI hint `Hr.org.bankAccountsHint`. | The server returns `bankAccounts[0]` as `primaryBankAccount` in `payslips.document`, but the payslip view drops it (`payslipEmployer`). No payroll uses it. | "Add the company's bank accounts. The first one is stored as the primary account." Do not show or claim it on a payslip. The UI hint string also overstates this; that is a product follow-up, not changed here. |
| 1.3 | Fine as written. | | Show the reload on camera. |
| 1.4 | "The logo is saved as soon as you choose it." This is true only on success. | `CompanyLogoEditor.choose` reads the file asynchronously and then submits `saveCompanyLogo` on its own, separately from "Save company profile". Invalid type, over 256 KB, or `LOGO_STALE` refuses it and keeps the file, with "Apply selected file to current logo". Choosing is ignored while the logo query is still loading. | "Choosing a logo uploads it right away, separately from Save." Wait for the preview before captioning, then reload to show it persisted. |
| 1.5 | "Add the head office first" implies an enforced order. | `convex/model/hr/org.ts` enforces only HEAD_OFFICE ⇔ `00000`. It does not enforce an order. | "The head office uses branch number 00000." |
| 2.4 | "Payment details are visible to HR administrators only." "Shows masked" can read as hidden. | Reads and writes require `hr.admin.manage` (any role granted it) within site scope (`employeeProfile.ts employeePayment`). The summary shows `accountMasked`. The full number is returned to that user and prefilled in the edit dialog. The UI text says "No pay is calculated or transferred here." | "Payment details need HR administration permission. The summary shows the account number masked." Type a fake account number. Do not imply masking hides it from HR. |
| 2.5 | Gate. | Probation date must be on or before today (`LIFECYCLE_DATE_FUTURE`). | Keep the caption. |
| 2.6/2.7 | Gate. Needs data planning. | The last working day must be before today. Reinstatement must be after the last working day and on or before today (`convex/model/hr/lifecycle.ts`). | Use a last working day at least 2 days ago so a gap is visible. Caption "Reinstatement keeps the separation gap in history." |
| 3.4 | Labels. | The strings are "Assign shifts", then "Choose a shift or OFF", then "Save assignment". | Use those exact labels. |
| 3.5 | Fine. | `Hr.shifts.clear` = "Clear (use weekly schedule)". | Keep. |
| 3.6 | "Hover … both cells are disabled with their reason." "an active leave request" overstates which dates are locked. | The lock reason appears only in assign mode, as the `title` tooltip and `aria-label` of a disabled button (`ShiftsRoster.tsx`). Native tooltips on disabled buttons may not render, or may not appear in recorded video. Only the request's claimed working dates are locked (PENDING, APPROVED, CANCELLATION_REQUESTED). Non-working dates inside the request's range stay assignable. | Show the disabled cell. Use the caption only if the recording actually shows the reason text: "Dates with recorded attendance, or working days in a leave request, keep their plan." Otherwise caption "Locked dates cannot be selected." |
| "Not shown" lists | Incomplete for later videos. | | Do not record or caption GPS/QR/selfie/fingerprint clock-in, multi-step approval, payroll calculation, tax/SSO, reports, warning letters or expenses. None exists. A payslip-import video may show only the import, publish and employee view of imported totals, labelled "imported", never "calculated". |

## Limitations

- No browser verification on this source for any slice 05–09 row. Existing specs ran against other revisions. The later Sol baseline run on `0a07a193` includes two desktop clock writes and a no-action mobile skip; see `t3-ad7b5fc0/docs/plans/hr-parity/resume-evidence/baseline-acceptance.md`.
- I did not run any tests. Test coverage comes from the collected test files and titles, not from new runs. The earlier logs (`runs/hr-broad.log` 967/967) cover most of the files cited.
- I made no inferences about HRZoft write semantics. Rows labelled `guess` remain guesses about HRZoft. The status column judges only our code.
- The requested audit target was about 25 minutes. The launcher recorded approximately 56 minutes of wall time, including two reported model-stream stalls; no cause for additional elapsed time is assumed. Rows were checked by schema, function and test-title evidence, not by reading every handler line.

## Coordinator follow-up

The bank-account hint was corrected in English and Thai to say that the first account is stored as primary, without claiming payslip display. The source finding was confirmed in `payslips.document` and `payslipEmployer`. Tutorial wording must follow the corrected-caption column above. This is a copy correction only; no bank-account display or payroll behavior was added. The audit itself ran no tests, and its evidence references must not be presented as new test runs.
