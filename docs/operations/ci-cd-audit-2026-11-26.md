# Yongkit CI/CD audit and improvement plan

Audited November 26, 2026 against `origin/main` at `89a8a28b`. The customer
workspace reached production in **5m 29s** with passing candidate and live
smoke. The release skipped authenticated staging. The previous three weekly
coverage jobs stopped at their 30-minute limit.
[Production run](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/45837310486) ·
[Weekly coverage job](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/45330003547/job/138228676904)

## Scorecard

Five areas carry two points each. Local verification earns implementation
credit. Hosted operational credit comes from workflow runs and provider settings.

| Area                         | Hosted baseline | Verified branch | Evidence and remaining gap                                                                                                                                            |
| ---------------------------- | --------------: | --------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merge gates and supply chain |             2.0 |             2.0 | Strict `check`, CodeQL for application and Actions, pinned actions, frozen installs, and main-only release environments.                                              |
| Test execution and evidence  |             1.3 |             1.8 | Five Vitest and five browser legs gate merges. The branch bounds coverage runtime and worker count, checks all three artifacts, and publishes aggregate results.      |
| Release safety               |             1.4 |             1.6 | A fresh snapshot, candidate smoke, exact promotion, and live smoke passed. Staging-only dispatch adds an authenticated rehearsal path. Automatic staging is disabled. |
| Backup and recovery          |             1.4 |             1.4 | Twelve daily runs passed and an older Convex snapshot was restored in a disposable target. Full recovery, external files, and business recovery targets need proof.   |
| Operational feedback         |             1.2 |             1.2 | Release manifests identify the SHA, smoke outcomes, and recovery actions. Delivery of release and backup failure alerts to an accountable operator needs proof.       |
| **Total**                    |      **7.3/10** |      **8.0/10** | Hosted and local results are recorded below.                                                                                                                          |

The fresh hosted run raises published `main` to **7.6/10**. Test execution
and evidence rises from 1.3 to 1.6 because coverage and the full browser
matrix both completed with usable artifacts. The next scheduled run will
show whether coverage also recovers on its regular cadence.
[Hosted Workspace matrix](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/45845637224)

The **8.0/10 local readiness estimate** adds 0.1 for bounded coverage
execution, 0.1 for rejecting incomplete reports and failed Vitest runs,
and 0.2 for the staging-only path and its release guards. Hosted credit
for those controls depends on the rollout acceptance checks below.

## Findings

1. **Coverage stopped producing weekly evidence.** The browser matrix passed
   on November 10, 17, and 24. Coverage hit its 30-minute limit each time. On
   November 24, one location-search integration file took about 13 minutes
   and reported a failed test before coverage was cancelled. That run predates
   the `convex-test` optimization in `56f857f4`. On current `main`, the file
   passed in 13 seconds in hosted CI without coverage and in 23 seconds in
   a focused local coverage run. A local full-coverage run with default workers
   finished in 3m 11s with one timeout in the job-scan capacity test.
   [November 10](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/42745908811) ·
   [November 17](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/44008108382) ·
   [November 24](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/45330003547) ·
   [Latest test shard](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/45837310486/job/139969473521)
2. **Automatic releases skip authenticated staging.** `STAGING_ENABLED` has
   been `false` since October 13, the date of the most recent successful
   staging deployment recorded in GitHub. The latest production manifest
   reports eight passes and one optional skip on each of candidate and live
   smoke. Staging adds authenticated writes, webhook delivery, JWTs, and
   tenant checks.
   [Latest production run](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/45837310486)
3. **Backups run successfully with variable spacing.** All 12 scheduled runs
   in the sample passed. The November 23 and 24 runs started 27h 58m apart.
   The historical 94.9-second restore measured a Convex data import. A timed
   rehearsal with application readback and UploadThing file recovery is open.
   [November 23 backup](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/45088441253) ·
   [November 24 backup](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/45325702558) ·
   [Backup runbook](release-runbook.md#backup-and-recovery-evidence)
4. **Recent green PR checks are already fast.** The November 26 and November
   24 application PR quality runs took 3m 11s and 2m 39s. The corresponding
   main release runs took 5m 29s and 5m 15s. These are individual samples.
   [November 26 PR](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/45836690940) ·
   [November 24 PR](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/45385411207) ·
   [November 24 release](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/45385984894)

## Improvement and rollout plan

| Priority      | Task scope                                                                                                                                  | Acceptance evidence                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 · Coverage  | Bound full-suite coverage to four workers and 15 minutes. Verify JUnit, coverage JSON, and LCOV before printing the summary.                | Local command passes every test project and validates all three files. After rollout, verify both Workspace matrix jobs and the summary on a hosted dispatch and the next scheduled run.                                         |
| 1 · Staging   | Add `release_target=staging` to the protected main dispatch. Require staging for that run and block production.                             | Local tests exercise failure, cancellation, skips, and untrusted branches. After rollout, observe `STAGING_PASSED`, fixture cleanup, and a skipped `Production release` job before deciding whether to enable automatic staging. |
| 2 · Recovery  | Set recovery targets and rehearse into an isolated Convex target. Include application readback and representative external file recovery.   | Record snapshot age, total recovery time, file recovery, and cleanup. Compare the times with approved targets.                                                                                                                   |
| 2 · Alerts    | Route release, backup, and coverage failures and overdue backups to a named operator.                                                       | Generate controlled release and backup alerts and confirm delivery and acknowledgement.                                                                                                                                          |
| 3 · CI timing | Measure PR gate and main release time, including queue time and failed or cancelled attempts, over the next 20 completed runs of each type. | Record p50/p90 and the slowest required job. Investigate regressions before changing job or suite selection.                                                                                                                     |

After merge, run the staging-only rehearsal through the
[release runbook](release-runbook.md#release-path). The repository variable
still applies to automatic production releases.

## Re-audit evidence

- Four-worker full coverage passed **6,389 tests across 499 files** in
  **5m 24s** on macOS with Node 24. The report verifier accepted JUnit, JSON,
  and LCOV. V8 measured 88.70% lines and 82.79% branches across the coverage
  configuration's included paths.
- 183 workflow, release controller, entrypoint, and backup tests passed locally.
- Workflow policy, six upstream action pins, actionlint, and the locked
  release-tool schema compatibility check passed.
- Full formatting, ESLint, Bun and TypeScript 6 typechecks, navigation checks,
  and test discovery passed.
- Anonymous Convex codegen matched the checked-in bindings. Both guarded
  application and release-tool dependency audits passed. The runtime audit
  passed its high-severity gate and reported three moderate advisories.
- The hosted dispatch on `89a8a28b` passed both jobs. Coverage finished in
  **7m 23s** with **6,384 tests passed**. The branch's verifier accepted the
  downloaded JUnit, coverage JSON, and LCOV. The browser matrix finished in
  **8m 09s** with **161 passed, 4 skipped, and zero failures**.
  [Hosted Workspace matrix dispatch](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/45845637224)
- Hosted execution of the new workflow and the staging-only rehearsal
  remain rollout acceptance checks.

## Final review follow-up

The coverage summary now requires a successful Vitest step and a JUnit
report with valid counts and at least one executed test. The verifier lists
each missing or invalid artifact. The workflow and release controller both
check the dispatch target before starting a deployment. Local regression
cases cover failed Vitest steps, all-skipped reports, missing counts,
unknown dispatch targets, and production refusal on a staging dispatch.
The follow-up passed 367 CI, release, and backup tests. The revised verifier
accepted both the local and downloaded GitHub coverage reports.

## Platform references

- [Active main ruleset](https://github.com/Rugby-Thailand/industrial-sas/rules/24799747)
- [GitHub workflow dispatch inputs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatchinputs)
- [Vercel staged production promotion](https://vercel.com/changelog/stage-and-manually-promote-deployments-to-production)
- [Convex backup and restore](https://docs.convex.dev/database/backup-restore)
