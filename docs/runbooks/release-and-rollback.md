# RB-08 — Release and rollback

Status: **skeleton, never executed.** No preview, staging, or production environment exists,
and no deployment automation exists. Evidence gate: `RG-060` (rehearsed), `RG-059`
(environments separated).

## What exists today

The repository has trunk-based development, exact-pinned dependencies, and two
credential-free CI workflows (static analysis, test matrix, production build, Playwright).
`pnpm guards` runs the same checks locally. Deployment is **not** automated and no
environment is targeted. See [README](../../README.md) and
[ADR-0012](../adr/0012-delivery-release-and-quality-gates.md).

## Preconditions

- `TODO` Staging and production deployments exist and are separated — `RG-059`.
- `TODO` Deployment pipeline defined, with its own reviewed credential scope — the public
  workflows stay credential-free (`INV-0012-03`).
- `TODO` Alerting and SLI dashboards live — `RG-045`.
- `TODO` Migration runner and seed guards implemented — Phase 1/2.
- All standing merge gates green: `RG-031`, `RG-053`, `RG-054`, `RG-055`.

## Release procedure

1. **Verify the merge gates** on the commit being released. A release from a commit whose
   isolation tier was skipped is not a release; it is an incident in waiting.
2. **Review the migration plan.** Expand–migrate–contract only; forward-only; never a
   migration that rewrites ledger or audit documents (`INV-0012-06`).
3. **Stage first.** Deploy to staging, run the migration, and execute the smoke journey plus
   an isolation spot check against staging.
4. **Check the reconciliation state** on staging: zero drift before and after the migration
   (`INV-0003-10`).
5. **Choose the window.** Avoid the pilot site's receiving hours. Releases during a
   receiving peak convert a small defect into a stopped warehouse.
6. **Deploy production**, then run the migration's expand phase. Do not run the contract
   phase in the same release as the expand phase.
7. **Verify in production**: sign-in, one scan-to-ack measurement, one read of inventory
   history, job queue depth, and error rate. `TODO` verification checklist — blocked by
   `RG-045`.
8. **Watch.** Monitor the SLIs for the agreed observation period before declaring the release
   done.
9. **Record.** Commit SHA, migration steps run, verification results, and anything
   unexpected.

## Rollback

Rollback is **code-only**. Data is never rolled back, because forward-only migration plus an
append-only ledger means there is nothing to roll back to (`INV-0012-06`).

1. Redeploy the previous known-good commit.
2. Confirm the previous code tolerates the migrated data shape. Expand–migrate–contract
   exists precisely so this is true; if it is not, the migration was designed wrongly and the
   correct response is to fix forward.
3. Never re-run a contract-phase migration in reverse.
4. If data is genuinely wrong, use reversals and projection rebuilds
   ([`RB-03`](./ledger-drift.md)), not a restore, unless
   [`RB-02`](./backup-and-restore.md) says otherwise.
5. Record why the rollback happened and add the missing test.

## Blocked by design

- Deploying a commit that bypasses the isolation gate.
- Running expand and contract phases together.
- Deploying during the pilot's receiving peak without an explicit reason.
- Deploying a demo seed to production (`INV-0012-07`).

## References

- [ADR-0012 — delivery, release, DR, and quality gates](../adr/0012-delivery-release-and-quality-gates.md)
- [Release gate register](../release-gates.md)
- Plan §5 Q38, Q45, §10, §12
