# Database validation follow-through — 2026-11-03

Status: implementation in progress on `codex/database-validation-2026-11-03`, based on main `79c4de7b`. This closes the evidence gaps from [the research report](../reviews/database-design-2026-11-01/test-gaps-2026-11-03.md), following merged PR #119. See the [case ledger](../reviews/database-design-2026-11-01/verification-ledger-2026-11-03.md) for current evidence, including coverage added by PR #121 after the initial research. Existing CI and local acceptance remain valid.

The deliverable is reproducible coverage, fixes for any defects it exposes, and recorded operational evidence. A passing mock test, real-backend test, browser journey and cloud observation are distinct evidence levels.

## 1. Establish the current baseline and operational state

- Start implementation from current `origin/main` in an isolated checkout; preserve the unrelated dirty original checkout and retain the research report.
- Record the implementation SHA, deployed SHA, package versions and baseline checks. Reconcile any changes since the research before editing tests.
- Inspect existing cloud migration completion records and actual retention cron history. Traverse a complete payslip dry run on each relevant deployment; record measured zero if no rows exist.
- Use the existing owned staging-fixture lifecycle for synthetic data and identities. Keep operational receipts separate from public test fixtures; never commit credentials, token claims, payroll contents or raw snapshots.

**Done:** a case ledger maps all ten research items to an environment, existing evidence, planned test and observable pass condition. Cloud access failures are recorded explicitly and do not block independent local correctness work.

## 2. Make replay-expiry coverage deterministic and caller-specific

**Research item 2. Proposed commit:** `test: cover business retries at replay expiry`.

- Freeze `Date` in the boundary tests and restore it after each test. Exercise expiry minus one millisecond, exact expiry and plus one millisecond.
- Cover expired receipts both before and after sweeping; changed payloads; tenant/actor authorization; concurrent retries; and permanent HR recovery fences.
- Trace actual shared-helper callers. Build representative cases for inventory creation and movement, layout/zone/location creation, attendance, leave/corrections, period publication, payslip publication, and announcement/notification/preferences writes. Group only callers that demonstrably share the same side-effect and replay contract.
- For each case, declare the expected outcome at expiry: safe refusal or an intentional new execution. Expired ordinary keys do not promise permanent deduplication.
- Simulate a committed command whose response was lost. Assert business row IDs, quantities, balance movements, versions, holds, notifications and audit effects as applicable—not just a successful response.

**Done:** before expiry, retries have no second business effect; at/after expiry, each actual caller follows its declared contract; permanent fences remain effective. Any failure becomes a regression before changing production logic.

## 3. Complete CLOSING write and authorization coverage

**Research item 3. Proposed commit:** `test: cover every closing-period source write`.

- Exercise BUILDING, READY and CANCELLING against correction decisions, day certification, relevant leave submission/approval/cancellation/restoration, holiday deletion, employee changes and transfers into/out of a closing site.
- Include clock-in/out only in a reachable business scenario or explicitly labeled legacy-state guard fixture. Do not disguise impossible past-date journeys as end-to-end coverage.
- Cover boundary dates, overnight business dates, another site, another period, revision of an already-published period and overlapping legacy periods.
- Revoke a driver's role or site scope between steps. Verify current authorization is applied on the next command and protected read.
- Construct otherwise-valid inputs so the intended guard is reached. Some metadata-only transitions may remain allowed if they cannot change a frozen source.

**Done:** frozen sources cannot change; denied calls leave relevant business data unchanged; valid unrelated work continues; cancel restores appropriate editability and publication retains CLOSED rules.

## 4. Add a realistic attendance and export reference fixture

**Research items 4 and part of 9. Proposed commit:** `test: reconcile staged attendance and complete exports`.

- Build a deterministic 120-employee, 31-day fixture with normal and overnight shifts, breaks, outside-shift minutes, holidays, nonworking days, approved leave, corrections, certified absences, employment start/end boundaries and former employees between roster pages.
- Store independently calculated expected values for each employee/date. Do not generate the expected answer with the production attendance builder.
- Use actual business commands where possible; clearly identify any historical attendance seeded for the real-backend rehearsal.
- Compare every frozen row, disposition, original/effective punch, total and CSV cell. Parse CSV properly and compare the complete employee/date key set, so duplicate rows cannot hide omissions.
- Verify one header/BOM, quoting and Thai text, complete pagination, employee self-history, revision v2 and unchanged v1.
- Exercise meaningful boundaries: 25/26 employees per build step, 50/51 for one-command versus staged close, and an export that crosses the 2,000-row part bound without splitting an employee.

**Done:** integration and real-backend results match the independent expected dataset; valid scheduled attendance closes successfully; incomplete attendance refuses with the correct employee/date; CSV contents reconcile exactly.

## 5. Make real-user and multi-session acceptance repeatable

**Research items 5–6 and native acceptance. Proposed commit:** `test: verify database workflows through real user sessions`.

- Add durable tests under the existing staging Playwright suite rather than leaving the new acceptance flow only in private scratch scripts.
- Run the realistic HR fixture with two independent authenticated contexts. Race advance/advance, publish/cancel, cancel/advance and begin/source-write. Interrupt after a known committed write, reconnect and resume without relying on arbitrary sleeps.
- Observe period list/detail, global search, prior-version history and employee history across transitions. Interrupt a later export part; revoke scope before retry; never deliver a partial CSV as complete.
- For payslips, use an owned synthetic employee with a real supported Clerk verification factor. Test stale denial → actual provider challenge → refreshed token → successful reveal/download and original hash equality.
- Check challenge cancellation, expiry, logout, account/organization switch, supersession and policy changes. Supplied administrator identities cannot satisfy the real-provider acceptance case.
- Repeat affected Back/Close/refresh/download flows on desktop and mobile. Retry native computer use; if its service remains unavailable, keep that item blocked without relabeling Playwright as native coverage.

**Done:** each race yields one valid committed outcome; no partial version is published, no duplicate employee/day exists, and readers converge. Real provider verification succeeds for the owner and denies invalid access. Record browser actions together with backend assertions and sanitized diagnostics.

## 6. Verify migration and cloud-backup recovery

**Research items 1 and 10. Proposed commit:** `test: rehearse payload migration and cloud recovery`.

- On a disposable real backend, migrate at least 17 legacy rows across two synthetic tenants, including near-maximum PDFs. Interrupt, resume and repeat pages. Exercise corrupt and missing payload cases without altering real records.
- Retain a recoverable backup before any needed cloud migration. The user has already authorized necessary migration; follow the existing bounded runbook and record cursors and completion evidence.
- Verify from an empty cursor after migration: all pages complete, zero inline rows, zero missing payloads and zero integrity failures. Reconcile ownership and original hashes independently.
- Restore an actual cloud backup into an isolated deployment with compatible code. Include published and interrupted staged periods, migrated payloads, ordinary receipts and permanent fences.
- Verify document relationships/counts, selected original hashes, application reads, a synthetic PDF download and safe resume/discard of unpublished work. Record restore duration; do not claim an RTO/RPO that has not been selected and tested.

**Done:** every relevant deployment has a completion receipt, including measured empty deployments; cloud-backup restore is demonstrated without overwriting production. Keep the legacy field and close shim until the separate contract-release conditions are satisfied; removal is not bundled into this verification work.

## 7. Verify the deployed cron and backlog behavior

**Research item 7. Proposed commit:** `test: qualify retention scheduling and backlog recovery`.

- Record an actual daily cron invocation and scheduled chain from the deployed environment; distinguish cron evidence from manually calling the worker.
- In a disposable real backend, exceed 2,000 expired records in each scheduled table and cross the 25-organization dispatcher page boundary. Preserve future keys, permanent fences and business/source records.
- Exercise repeated dispatch, process interruption/restart, newly expiring keys, and active business writes during cleanup.
- Verify the configured 100-row page and 20-page tenant/table budget. Test later passes progressing through surviving records, including the exact 2,000/2,001 boundary.
- Measure backlog and arrival rate. Above-budget arrival rates require an explicit capacity adjustment; no test should claim the current daily budget can drain an indefinitely growing excess.
- If operational backlog/failure evidence is not accessible, add only the minimal durable metrics or alerting needed to identify it, with tests for that reporting.

**Done:** the actual cron fires, chains complete or expose a failure/backlog, work stays bounded, and protected records survive. Support-grant transitions remain operator-driven and retain history.

## 8. Measure a supported operating range

**Research items 8–9. Proposed commit:** `test: measure database contention and resource limits`.

- Define the intended dataset, concurrent operators and latency target before assigning a capacity pass/fail. Without agreed workload/SLOs, label the output a benchmark only.
- Use a disposable cloud backend matching the relevant deployment class. Start with a small controlled ramp; record the workload and resource budget.
- Mix same-warehouse inventory creates, reservations, moves, cancellations, replacements and product edits. Observe identity allocation, holds, totals, current/retired units, generation-invalidated cursors, summaries, search and subscriptions; include a quiet warehouse and another tenant as controls.
- Run the realistic HR fixture with dense history and maximum supported fields, both the small one-command path and staged chunks. Include near-max payslip versions/imports and full eight-row migration pages.
- Measure real transaction resources, conflicts/retries, latency and subscription work where the platform exposes them. Approximate fixture byte counts are not server measurements.

**Done:** invariant checks pass at the declared workload, supported requests stay within measured limits with documented headroom, and out-of-bound inputs refuse atomically. Change indexes, chunk sizes or reporting only where measurements demonstrate a need, then repeat the affected workload.

## Delivery and completion gates

1. Correctness PR: steps 2–4 and the research/case ledger. Small test commits; separate regression/fix commits when defects are reproduced.
2. Acceptance PR: reusable fixtures and real-user/multi-session tests from step 5. Reuse the expected dataset from step 4.
3. Operations/measurement PR where code is needed: migration/recovery/retention runners and workload measurements from steps 6–8. Sanitized operational receipts accompany the runbook; private data stays out of the repository.

For each actual defect: reproduce → add a failing regression → fix the smallest responsible behavior → rerun the affected cases. Do not weaken assertions, silently increase timeout allowances, or rewrite unrelated features to obtain green checks.

Run the relevant tests after each change. At final integration, run normal lint, formatting, pinned type checks, navigation checks for affected callers, codegen, full CI and the real acceptance suites. Review before merge; use the protected release path for production changes. Report the tested SHA and environment for every result.

Complete means each ledger item is either **passed with reproducible evidence** or **explicitly blocked with a concrete dependency**. Do not describe blocked provider/native/cloud evidence as fixed. Capacity qualification additionally requires a stated workload; passing correctness tests alone does not establish throughput.
