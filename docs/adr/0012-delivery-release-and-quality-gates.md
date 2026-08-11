# ADR-0012 — Delivery pipeline, schema evolution, disaster recovery, and quality gates

- ID: `ADR-0012`
- Status: **Accepted**
- Date: 2026-08-03
- Decision baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §3.2 (D-22, D-23,
  D-26, D-27, D-29), §4 (B-09, B-11), §5 Q38, Q40, Q42, Q43, Q45, Q50, §10, §12,
  §14
- Covers plan ADR backlog (§11) items: 19, 21, 22, 24
- Implementation status: **Partial.** The repository has trunk-based development,
  pinned exact dependencies, two credential-free GitHub Actions workflows, a
  workflow configuration guard, six Vitest tiers plus Playwright — all now running
  real suites rather than placeholders — and, as of this commit, the **environment
  contract** §2 asks for: the four classes and their required/forbidden variables
  as code (`src/lib/environmentContract.ts`), a guard that enforces the contract
  against `.env.example` in CI and against a real machine on request
  (`pnpm verify:environment`), and a cross-class comparison that reports a shared
  Convex or Clerk instance by variable name only.
  There are still **no** preview, staging, or production environments, no
  migrations, no seeds, no backups, no exports, and no legal documentation pack.
  The contract is therefore a specification those environments must satisfy, not a
  description of ones that exist ([environment contracts](../environments.md)).

## Context

The plan makes several delivery commitments that are cheap to state and expensive
to retrofit: forward-only schema evolution, environment separation, a blocking
tenant-isolation gate, rehearsed restores, and a Thai PDPA processor posture with
counsel sign-off before production (D-22, D-23, D-26, B-09).

Two of these carry hard external dependencies: Thai counsel (B-09) and a restore
rehearsal against a real backup (D-26). Neither can be satisfied by code.

## Decision

### Branching and pipeline

1. **Trunk-based development** on `main` with short-lived feature branches (D-23,
   §5 Q45).
2. **Four environment classes**: developer, PR preview, persistent staging, and
   production, with separate identity instances, Convex deployments, file-storage
   apps, and telemetry projects (§5 Q45, plan §14).
3. **Credential-free CI for the public guards.** Static analysis, all test tiers,
   the production build, and Playwright run with no secrets. A job that needs a
   secret to pass does not belong in that pipeline (repository convention, see
   [README](../../README.md)).
4. **Actions are pinned to commit SHAs** with the tag in a trailing comment, and a
   dependency-free configuration guard enforces pinning, no write permissions, no
   secret references, and the single source of truth for the pnpm version.
5. **Exact dependency pinning** with pnpm; no floating ranges (D-29).

### Schema evolution and seeds

6. **Expand–migrate–contract, forward only.** Add the new shape, migrate data with
   a resumable job, then remove the old shape in a later release (D-22, §5 Q38).
7. **No destructive migration without a reversal path**, and never a migration that
   rewrites ledger or audit documents
   ([ADR-0003](./0003-append-only-inventory-ledger.md)).
8. **Three seed classes, all idempotent**: code-owned reference data (permission
   catalogue, reason codes), demo data, and tenant onboarding data. Production
   guards reject demo seeds (D-22, §5 Q38).

### Quality gates

9. **The merge gate is the plan's §12 list**: formatting, lint, strict typecheck,
   dependency audit, unit/property/integration/isolation tests, a Playwright smoke
   journey, and the three static domain checks (no wrapper bypass, no ledger/audit
   mutation, no unbounded tenant scan).
10. **Tenant isolation is blocking.** A red isolation tier blocks merge
    independently of other tiers, and the matrix reports each tier separately
    (§12, `RG-031`).
11. **Test tiers are named and separable** — unit, a11y, property, integration,
    isolation, plus Playwright E2E — so a failure names its own cause (§5 Q40).

### Disaster recovery and retention

12. **RPO 24 hours / RTO 8 hours as initial targets**, backed by platform periodic
    backups plus independent encrypted logical exports to durable storage, with
    quarterly restore rehearsal (D-26, §5 Q42).
13. **Ledger and audit retention defaults to seven years**, pending Thai legal and
    accounting review; other operational logs have shorter documented retention
    (D-27).
14. **Independent exports exist because the backup window is shorter than the audit
    retention** (plan §13).

### Legal and production posture

15. **Thai PDPA working model**: the tenant is controller, the SaaS operator is
    processor. Required artefacts are a DPA, subprocessor register, ROPA, lawful
    basis, cross-border transfer safeguards, privacy notice, retention schedule,
    security measures, incident response, and a DPO assessment (§5 Q43, §14).
16. **Thai counsel sign-off is a production gate** (B-09). Legal summaries in the
    plan's source register are research inputs, not advice.
17. **Contracts must not promise** an unsupported region, true offline operation,
    point-in-time recovery, or unmeasured latency/RPO (plan §14,
    [ADR-0009](./0009-degraded-online-connectivity.md)).

## Invariants

### Code-owned guarantees

- `INV-0012-01` Every pull request runs formatting, lint (`--max-warnings=0`),
  strict typecheck, all Vitest tiers, and the production build before merge.
- `INV-0012-02` The isolation tier is a blocking gate; a failure cannot be waived by
  another green tier.
- `INV-0012-03` CI workflows contain no `${{ secrets.* }}` reference and no write
  permission; every non-local action is pinned to a full 40-character SHA
  (enforced by `pnpm verify:workflows`).
- `INV-0012-04` Dependencies are exact-pinned; the lockfile is committed and CI
  installs with `--frozen-lockfile`.
- `INV-0012-05` No `.env` file or secret value is tracked; only `.env.example`
  names.
- `INV-0012-06` Migrations are forward-only, resumable, idempotent, and never
  rewrite ledger or audit documents.
- `INV-0012-07` Demo seeds refuse to run against production.
- `INV-0012-08` Reference-data seeds are idempotent and converge on the code-owned
  catalogue ([permissions](../permissions.md)).
- `INV-0012-09` Export jobs produce encrypted artifacts and record what was
  exported, by whom, and when.
- `INV-0012-10` `PROJECT_PLAN.md` is excluded from formatting and must remain
  byte-for-byte identical to the approved document.

### Operational assumptions

- `OPS-0012-01` Thai counsel reviews and signs off before production (B-09,
  `RG-006`, `RG-048`).
- `OPS-0012-02` Restore rehearsals happen quarterly and are recorded
  ([runbook](../runbooks/backup-and-restore.md), `RG-047`).
- `OPS-0012-03` Environment separation is actually configured in each vendor
  console; the repository cannot enforce it.
- `OPS-0012-04` Retention targets survive legal and accounting review (D-27).
- `OPS-0012-05` Reviewers enforce the static domain checks by hand until they are
  automated.
- `OPS-0012-06` Dependabot action-update PRs are reviewed as supply-chain changes
  (SHA diff, not tag trust).
- `OPS-0012-07` The B-11 scale envelope is validated by load tests before the pilot
  peak (`RG-037`).

## Consequences

- The pipeline stays credential-free, so deployment automation will need a separate,
  explicitly-scoped workflow with its own review.
- Forward-only migration means two shapes coexist during expand phases, and code
  must tolerate both.
- Quarterly restore rehearsals are recurring operational cost, and skipping one
  invalidates the RTO claim.
- Seven-year ledger retention interacts with PDPA erasure requests: business records
  are retained, personal profile data is erased or pseudonymized (plan §14).
- Because counsel sign-off gates production, engineering can complete Phase 1–3
  while the legal track runs in parallel — but launch cannot.

## Rejected alternatives

| Alternative                                  | Why rejected                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Long-lived release branches                  | Slows integration and hides drift; trunk-based with short branches is the plan (D-23).            |
| Backward migrations / down scripts           | Cannot un-migrate real warehouse data safely; forward-only with expand–contract is honest (D-22). |
| Editing ledger rows in a migration           | Destroys the audit trail the ledger exists to provide (ADR-0003).                                 |
| One shared environment for staging and demos | Real tenant data leaks into demos and vice versa (plan §10 Phase 1 gate).                         |
| Secrets in the public CI pipeline            | Turns every workflow into a credential exposure surface; guard forbids it.                        |
| Floating dependency ranges                   | Unreviewed upgrades reach CI and production silently (D-29).                                      |
| Relying only on platform backups             | Backup retention is shorter than the seven-year audit requirement (plan §13).                     |
| Assuming PDPA compliance without counsel     | A localization requirement can invalidate vendors and regions (B-09).                             |
| Promising point-in-time recovery             | Not supported by the chosen platform posture; contracts must not claim it (plan §14).             |
| Treating isolation failures as advisory      | The one defect class that ends the product's credibility (plan §13).                              |

## Verification

Partly present.

Present today (foundation only): `pnpm guards` runs the workflow guard, Prettier
check, ESLint, strict typecheck, and all Vitest tiers; `pnpm build` produces a
production build with no environment variables; Playwright runs two Chromium
projects. Every test currently asserts scaffolding, not domain behaviour.

Planned: dependency audit in CI, the three static domain checks, migration and seed
tests, export/restore verification, and the pilot-window measurements in plan §10
Phase 4.

## Release gates

- `RG-006` PDPA/legal gap assessment and cross-border-transfer decision.
- `RG-048` PDPA documentation pack complete with Thai counsel sign-off.
- `RG-014` No secret or real tenant data in demo/preview environments.
- `RG-031` Isolation suite blocking merge gate.
- `RG-036` Production tier sized from evidence.
- `RG-037` Concurrency ceiling exceeds pilot peak with headroom.
- `RG-047` Restore completed within the accepted RTO.
- `RG-048` PDPA documentation pack complete.
- `RG-049` Retention decision confirmed with legal and accounting.
- `RG-050` No unresolved P0 and ≤2 P1 defects in the final pilot week.
- Register: [release gates](../release-gates.md).

## References

- Plan §3.2 (D-22, D-23, D-26, D-27, D-29), §4 (B-09, B-11), §5 Q38, Q40, Q41, Q42,
  Q43, Q45, Q50, §10, §12, §13, §14, §15.
- [README — continuous integration](../../README.md)
- [Release gate register](../release-gates.md)
- [Runbook index](../runbooks/README.md)
- [Specification coverage matrix](../specification-coverage.md)
