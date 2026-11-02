# Integrated database validation — 2026-11-02

Integration base: `9b86fd96`. Implementation and integrity follow-up through `fb65cbd1`. Tests use synthetic records in disposable loopback Convex deployments, with a Clerk test account. No production data cleanup or manual deployment was performed.

## Automated checks

- Navigation fixtures and inventory, repository formatting, full ESLint, pinned Bun type checking, TypeScript 6 checking, test discovery and production build passed.
- Credential-free code generation passed in a clean archive of the committed tree, using the pinned local Convex backend. Running that guard in the browser checkout correctly refused its local environment file.
- Production dependency audit passed its high-severity gate: two moderate vulnerabilities remain.
- Integrated affected checks passed 278 tests across seven files. The additional migration corruption regression passed in the five-test payload suite after failing before the fix.
- The first complete integrated run passed 5,109 tests, with one navigation timeout and two worker startup errors. All three affected files passed immediately in isolation (17 tests). A second complete run passed 5,112 of 5,118 tests, with six failures across five files (five timeouts and a subsequent missing-element failure). All five files passed on rerun: 135 tests in 23.68 seconds. The full runs took 834 and 2,928 seconds, while isolated reruns finished in seconds. These results are consistent with local execution stalls, but neither full run is counted as a clean pass; CI remains the merge gate.

## Real backend and browser acceptance

- Finished goods: real layout/product/reservation/verification/storage/move writes; occupied storage-condition denial; eight concurrent pallet creates with distinct identities.
- The checked-in Playwright history helper exercises 22 revisions across two pages, refresh, batch details, Close, and the next Back preserving the original query and hash, in English desktop and Thai mobile views. The final integrated rerun passed at 2026-11-01 23:37 UTC with no page errors. The harness explicitly selects its fixture warehouse after HR acceptance added more sites.
- HR: 120 employees and 3,720 days. Cancellation removes the staged attempt without consuming a version. Employee writes are refused during closing. Reopening drives an interrupted build to ready; refresh preserves it; explicit publication produces a complete 3,720-row CSV. Thai mobile history renders without page errors.
- An incomplete scheduled-attendance fixture was correctly refused with `PERIOD_NOT_READY`. The successful scale fixture contains employees without scheduled work; actual attendance rules are separately covered by the HR integration suites.
- Payslips: real staging/publication stores private payloads and omits bytes from metadata. The Clerk test sign-in lacks accepted freshness and correctly returns `REVERIFICATION_REQUIRED`. Positive ticket/download and exact hash checks use an explicitly administrator-supplied local test identity; this does not certify the live provider re-verification flow.
- Native computer use passed the baseline finished-goods navigation checks. The post-integration retry was blocked by the computer-use service returning `cgWindowNotFound` with Chrome open. Updated native acceptance remains unverified; Playwright coverage is recorded separately.

## Migration, retention and recovery

- A legacy inline payslip was migrated on the real local backend. Dry-run detected it, a repeated page did not migrate it twice, and the final verification reported no inline bytes, missing payloads or integrity failures.
- Export/import restored all 63 application tables and 7,609 documents exactly. Original PDF bytes matched their SHA-256 after migration and after restore. The restored application reader returned the published 3,720-day period.
- Seven bounded business-key audits reported no duplicates in the synthetic dataset. Retention dry-run deleted nothing; execution removed three expired keys and preserved the future key and permanent fence. Scheduler budget/restart behavior is covered by integration tests.
- Private snapshots, screenshots and raw execution logs are retained locally under `.cache/db-acceptance/`; they are excluded from version control. This report contains no credentials, session tokens or real payroll records.

## Independent review

Read-only source review of `97e6fddf` against `9b86fd96` found no actionable issues in the inspected schema, staged-close, migration and retention changes. It did not independently reproduce test results. The requested isolated test reruns and final integrated history browser rerun are now recorded above.

## Release limits

Deploy through the protected release pipeline with no active sessions. Refresh old clients because large CSV exports and paged history have changed contracts. Run and record the payslip migration completion pass separately for each cloud deployment before removing the optional inline field and compatibility close shim. Roll forward after migration. No production load result or external file-store recovery result is claimed.
