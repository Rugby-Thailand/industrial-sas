# Documentation

Architecture decisions and delivery contracts for Industrial SSA, derived from the approved
[PROJECT_PLAN.md](../PROJECT_PLAN.md).

**Read this first:** these documents describe what will be built. The repository currently
contains a toolchain scaffold, this documentation set, and the tenant security schema —
table declarations and the guards that read them, with no authentication, no authorization,
no Convex functions, and no deployment. **No warehouse management functionality exists.**
Each document states its own implementation status, and the
[coverage matrix](./specification-coverage.md) is the single place to see what is real.

## Where to start

| If you want to…                                    | Read                                                         |
| -------------------------------------------------- | ------------------------------------------------------------ |
| Understand why the architecture is shaped this way | [ADR index](./adr/README.md)                                 |
| Use the right word for a domain concept            | [Domain glossary](./domain-glossary.md)                      |
| Know who may do what, and under which policy       | [Permission catalogue](./permissions.md)                     |
| Know what still blocks a phase or the launch       | [Release gate register](./release-gates.md)                  |
| See what has been approved, and by what authority  | [Approval record](./approval-record.md)                      |
| Integrate or replace an external dependency        | [Integration contracts](./integration-contracts/README.md)   |
| Operate the system when something goes wrong       | [Runbooks](./runbooks/README.md)                             |
| Check what is implemented versus planned           | [Specification coverage matrix](./specification-coverage.md) |

## Contents

### Architecture decisions

Twelve accepted ADRs covering multi-tenancy and identity, the Convex tenant boundary, the
inventory ledger, quantity representation, warehouse and stock identity, authorization,
inbound scope, adapter ports, connectivity, Thai-first UX, asynchronous work and reporting,
and delivery. See the [ADR index](./adr/README.md) for the list and for how they map onto the
26 ADR topics in plan §11.

### Reference documents

- [Domain glossary](./domain-glossary.md) — the ubiquitous language, with stable term IDs,
  rejected synonyms, and the vocabulary that must **not** appear in MVP code.
- [Permission catalogue](./permissions.md) — code-owned permission codes, eight seeded
  roles with their default mapping, and the semantics of warehouse scope, thresholds,
  maker-checker, step-up, and disabled-by-default support grants.
- [Release gate register](./release-gates.md) — every gate in the approved plan with an
  owner, the evidence that closes it, and its status. Two gates are satisfied today; the
  rest are open, and the tenant security schema closes none of them.
- [Approval record](./approval-record.md) — the dated authorization the plan's §16 asks
  for: which decisions are accepted, what activity is authorized, and which approvals
  were **not** supplied and therefore remain open gates.
- [Specification coverage matrix](./specification-coverage.md) — plan requirements, B/D
  decisions, ledger invariants, and quality gates mapped to planned code, tests, and docs.

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
- **`PROJECT_PLAN.md` is immutable.** It is the approved decision baseline, excluded from
  formatting, and must stay byte-for-byte identical. Corrections belong in an ADR that
  supersedes a decision, not in the plan.
- **No secrets, no tenant data.** These documents name configuration keys and reference
  credentials by location, never by value.

## Keeping this current

When a decision changes, write a new ADR that supersedes the old one rather than editing
history. When implementation lands, update the affected ADR's status line, the coverage matrix
row, and — if the change closes a gate — the release gate register with a link to the
evidence.
