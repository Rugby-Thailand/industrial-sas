# Documentation

Architecture decisions and delivery contracts for Industrial SAS. The
[current plan](./plan/README.md) owns active direction; [PROJECT_PLAN.md](../PROJECT_PLAN.md)
preserves the approved baseline.

**Status:** code through Phase 5A runs locally. Vendor and pilot proof remain open.
The [coverage matrix](./specification-coverage.md) records what is real.

## Where to start

| If you want to…                                    | Read                                                         |
| -------------------------------------------------- | ------------------------------------------------------------ |
| Read the active goal, rules, and work              | [Current plan](./plan/README.md)                             |
| Understand why the architecture is shaped this way | [ADR index](./adr/README.md)                                 |
| Use the right word for a domain concept            | [Domain glossary](./domain-glossary.md)                      |
| Learn how to use each implemented feature          | [Feature manuals](./manuals/README.md)                       |
| Train an operator or a supervisor, in Thai         | [Training materials](./training/README.md)                   |
| Know what the pure domain modules own              | [`convex/model/README.md`](../convex/model/README.md)        |
| Know who may do what, and under which policy       | [Permission catalogue](./permissions.md)                     |
| Know what still blocks a phase or the launch       | [Release gate register](./release-gates.md)                  |
| See what has been approved, and by what authority  | [Approval record](./approval-record.md)                      |
| Integrate or replace an external dependency        | [Integration contracts](./integration-contracts/README.md)   |
| Operate the system when something goes wrong       | [Runbooks](./runbooks/README.md)                             |
| Know what each environment class must hold         | [Environment contracts](./environments.md)                   |
| Check what is implemented versus planned           | [Specification coverage matrix](./specification-coverage.md) |

## Contents

### Architecture decisions

The [ADR index](./adr/README.md) owns architecture decisions and supersession history.

### Reference documents

- [Current plan](./plan/README.md) — one short owner per concern.
- [Feature manuals](./manuals/README.md) — one operating/integration manual per
  implemented backend or domain capability, with an explicit availability label.
- [Training materials](./training/README.md) — Thai-first session material for dock
  operators and shift supervisors, including the limits each role will meet.
- [Domain glossary](./domain-glossary.md) — the ubiquitous language, with stable term IDs,
  rejected synonyms, and the vocabulary that must **not** appear in MVP code.
- [Permission catalogue](./permissions.md) — code-owned permission codes, eight seeded
  roles with their default mapping, and the semantics of warehouse scope, thresholds,
  maker-checker, step-up, and disabled-by-default support grants.
- [Environment contracts](./environments.md) — the developer, preview, staging, and
  production classes, what each must and must not hold, and the guard that checks it.
- [Release gate register](./release-gates.md) — gate owners, evidence, and current status.
- [Approval record](./approval-record.md) — the dated authorization the plan's §16 asks
  for: which decisions are accepted, what activity is authorized, and which approvals
  were **not** supplied and therefore remain open gates.
- [Specification coverage matrix](./specification-coverage.md) — plan requirements, B/D
  decisions, ledger invariants, and quality gates mapped to planned code, tests, and docs.
- [Technology best practices and optimization](./technology-best-practices-and-optimization.md)
  — primary-source review of the pinned stack, historical findings, implementation
  status, measurement methods, and remaining deployment-dependent work.
- [Pure domain modules](../convex/model/README.md) — what `convex/model/**` contains, why
  it may not import Convex (plan §6.2), and which invariants it cannot enforce because
  they belong to a mutation.

### Contracts and procedures

- [Integration contracts](./integration-contracts/README.md) — `INT-01`…`INT-08`: Clerk,
  Convex hosting, `FileStoragePort`, `PrinterTransportPort`, `ObservabilityPort`,
  `JobQueuePort`, `RollupPort`, and the device capture adapters, each with timeouts,
  idempotency, privacy, and failure semantics.
- [Runbooks](./runbooks/README.md) — `RB-01`…`RB-09`: incident response, backup and restore,
  ledger drift, support access, tenant onboarding and offboarding, key rotation, release and
  rollback, and device failure. All are skeletons with explicit `TODO` evidence gates.

## Conventions

- **Stable IDs everywhere.** `ADR-0007`, `INV-0003-02`, `RG-025`, `G-041`, `INT-04`,
  `RB-03`, `SC-D12`. Later commits change status, not identifiers. Retire an ID with a status
  change; never renumber.
- **Code-owned guarantees are separated from operational assumptions.** A guarantee is
  something a test or static check can prove. An assumption depends on people, hardware, or
  vendors, and no amount of code closes it.
- **No claim without an artefact.** Implementation status lines and the coverage matrix must
  understate rather than overstate. If a status would be optimistic, use the lower one.
- **One owner per fact.** Active direction lives in `docs/plan`; link instead of copying.
- **`PROJECT_PLAN.md` is immutable.** It preserves approved history. Corrections require
  an ADR or the matching current-plan owner.
- **No secrets, no tenant data.** These documents name configuration keys and reference
  credentials by location, never by value.

## Keeping this current

When a decision changes, write a new ADR that supersedes the old one rather than editing
history. When implementation lands, update the affected ADR's status line, the coverage matrix
row, and — if the change closes a gate — the release gate register with a link to the
evidence.
