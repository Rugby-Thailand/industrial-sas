# Current project plan

Updated: 2026-08-16

Code through Phase 5A runs locally, plus partial full-flow P1–P9 vertical slices:
shared operator work, opening/count, stock-ready delivery, transfer, and repeat
production execution, requirement readiness, revision impact, operational reporting,
HR attendance/leave, and provider-neutral integration health/recovery
([Delivery](./delivery.md)). Vendor, hardware, legal, load,
restore, and pilot proof remain open.

## Concerns

| Concern              | Owner                                                         |
| -------------------- | ------------------------------------------------------------- |
| Goal and scope       | [Project goal](./project-goal.md)                             |
| Customer and revenue | [Business model](./business-model.md)                         |
| Domain rules         | [Business logic](./business-logic.md)                         |
| Data and scale       | [Database](./database.md)                                     |
| Stack and modules    | [Technology](./technology.md)                                 |
| Work and order       | [Delivery](./delivery.md)                                     |
| Proof and release    | [Quality](./quality.md)                                       |
| Proposed full flow   | [Implementation plan](./full-flow-implementation.md)          |
| Authenticated E2E    | [Authenticated vertical slice](./authenticated-e2e/README.md) |
| Gate evidence        | [Release-gate refresh](./release-gate-refresh.md)             |
| Module structure     | [Selective decomposition](./module-decomposition/README.md)   |

## Rules

- One fact, one owner.
- Link; do not copy.
- Keep stable IDs.
- Prefer rules, states, and tables.
- Remove words that add no decision.

## Authority

- [Approved baseline](../../PROJECT_PLAN.md): frozen history.
- [ADRs](../adr/README.md): architecture changes.
- [Coverage](../specification-coverage.md): plan-to-proof map.
- [Gates](../release-gates.md): launch evidence.

Existing `plan §…` links refer to the approved baseline.
The full-flow implementation plan is a proposed expansion and does not become
delivery authority until its Phase 0 scope promotion is approved.
