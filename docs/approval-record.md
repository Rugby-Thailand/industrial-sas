# Approval record

The authorization the approved [PROJECT_PLAN.md](../PROJECT_PLAN.md) §16 asks for, recorded
here rather than in the plan because the plan is immutable (see
[documentation conventions](./README.md#conventions)). This is the evidence artefact for
`RG-001` in the [release gate register](./release-gates.md).

## AR-001 — Decision acceptance and local implementation authorization

| Field                | Value                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Date                 | 2026-08-03                                                                                |
| Authority            | Repository owner, acting as product owner for this repository                             |
| Conveyed by          | Written instruction to the implementing agent on `feat/mvp-inbound-slice`                 |
| Supersedes           | —                                                                                         |
| Gate closed          | `RG-001`                                                                                  |
| Gates left untouched | `RG-002`…`RG-010`, `RG-063`, `RG-064`, `RG-067`…`RG-070`, and every other `External` gate |

### Approved

- **All twelve Phase 0 blocking decisions accepted without exceptions.** `B-01` through
  `B-12` as written in plan §4 are accepted as the answers of record. No exception was
  taken to any of them.
- **All thirty recommended defaults accepted without exceptions.** `D-01` through `D-30`
  in plan §3.2 are accepted as written.
- **MVP scope and non-goals approved** as recorded in plan §2.1 and §2.3. The standing
  non-goals remain non-goals; nothing was promoted into scope by this authorization.

### Authorized activity

- Local implementation of the planned application against tested adapters, fakes, and
  mocks, with no vendor credentials present.
- Audits, reviews, and documentation work in this repository.
- Normal commits, and pushes to the `feat/mvp-inbound-slice` branch.
- Opening a pull request and leaving it unmerged.

### Not authorized

This authorization does **not** cover, and no part of it may be read as covering:

- Creating, provisioning, or paying for any cloud or vendor resource.
- Any deployment, to any environment.
- Creating or storing secrets, API keys, or credentials.
- Creating vendor or identity-provider accounts.
- Handling real tenant data of any kind.
- Merging the pull request.

### Not supplied — these gates remain open

The following approvals were **not** given and cannot be inferred from this record. Each
remains an open gate and must be closed by its own artefact:

| Missing approval                                  | Gates that stay open                                       |
| ------------------------------------------------- | ---------------------------------------------------------- |
| Pilot tenant and site confirmation                | `RG-063`, `RG-008`, `RG-009`, `RG-021`, `RG-024`, `RG-051` |
| Phase 0 budget and pilot-site authorization       | `RG-064`                                                   |
| Vendor selection and unit-economics approval      | `RG-007`, `RG-035`, `RG-036`, `RG-045`                     |
| Hardware procurement and the physical device work | `RG-002`, `RG-003`, `RG-004`, `RG-005`, `RG-029`, `RG-070` |
| Thai legal and PDPA counsel sign-off              | `RG-006`, `RG-048`, `RG-049`, `RG-056`, `RG-061`           |
| Confirmed success-criteria and envelope targets   | `RG-067`, `RG-068`, `RG-069`, `RG-066`                     |

`RG-064` stays open on its budget and pilot-site prerequisites alone. `AR-001` already
authorizes local repository initialization and implementation, so that half of the gate is
not what holds it open; the funding and pilot-site approvals it also requires have not been
supplied. `RG-036` is production Convex tier sizing from load-test evidence, so it belongs
with the vendor and production-sizing approvals, not with the Phase 0 budget.

External latency measurement, hardware spikes, vendor confirmations, legal counsel, pilot
site work, cloud provisioning, and credential handling are therefore still release-gated.
They gate production and pilot validation and the release itself — they do not gate local
implementation, which proceeds against fakes.

### What this record permits, precisely

Plan §1 makes domain schema and ledger implementation conditional on acceptance of the
plan §4 blocking decisions. Those decisions are now accepted, and
[ADR-0001…ADR-0012](./adr/README.md) are written and accepted (`RG-062`). Local
implementation of Phases 1 through 3 may therefore proceed, against adapters and fakes,
with no claim of production readiness. Nothing here asserts that any application
functionality exists; see the
[specification coverage matrix](./specification-coverage.md) for what is actually
implemented.

## Recording a further approval

Add a new `AR-` entry with its own date and authority. Never edit an existing entry:
supersede it, and name the superseding entry in the older one's `Supersedes` row. When an
entry closes a gate, update the [release gate register](./release-gates.md) in the same
commit and link back to the entry.
