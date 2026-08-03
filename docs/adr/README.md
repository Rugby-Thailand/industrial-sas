# Architecture Decision Records

Twelve accepted ADRs cover the cross-cutting architecture of the inbound vertical
slice. They record decisions taken from the approved
[PROJECT_PLAN.md](../../PROJECT_PLAN.md) — B-01…B-12 and D-01…D-30 are treated as
accepted — and they describe **intended** behaviour. Nothing in these ADRs is
implemented unless the ADR's "Implementation status" line says so.

`Partial` in the table below means part of the decision has landed and the ADR's
status line says which part. Three ADRs are `Partial` because the tenant security
schema exists: declarations, closed value sets, and the guards that read them.
There is still no authentication, no authorization, no exported Convex function,
and no deployment, so no runtime guarantee in any ADR holds yet.

Every ADR uses the same sections: context, decision, invariants (split into
code-owned guarantees and operational assumptions), consequences, rejected
alternatives, verification, release gates, and references.

IDs are stable. `ADR-0007` stays `ADR-0007`; invariant IDs (`INV-0007-04`) and gate
IDs (`RG-025`) are quoted from tests, code comments, and the
[coverage matrix](../specification-coverage.md), so they are never renumbered. A
superseded ADR keeps its number and gains a `Superseded by` line.

| ID         | Title                                                                                                | Status   | Implementation  |
| ---------- | ---------------------------------------------------------------------------------------------------- | -------- | --------------- |
| `ADR-0001` | [Multi-tenant SaaS and identity ownership](./0001-multi-tenant-saas-and-identity-ownership.md)       | Accepted | Partial         |
| `ADR-0002` | [Convex tenant boundary and index discipline](./0002-convex-tenant-boundary-and-index-discipline.md) | Accepted | Partial         |
| `ADR-0003` | [Append-only inventory ledger](./0003-append-only-inventory-ledger.md)                               | Accepted | Not implemented |
| `ADR-0004` | [Exact quantities and UOM](./0004-exact-quantities-and-uom.md)                                       | Accepted | Not implemented |
| `ADR-0005` | [Warehouse, location, and stock identity](./0005-warehouse-location-and-stock-identity.md)           | Accepted | Not implemented |
| `ADR-0006` | [Authorization and support access](./0006-authorization-and-support-access.md)                       | Accepted | Partial         |
| `ADR-0007` | [Inbound slice scope](./0007-inbound-slice-scope.md)                                                 | Accepted | Not implemented |
| `ADR-0008` | [Adapter ports and release gates](./0008-adapter-ports-and-release-gates.md)                         | Accepted | Not implemented |
| `ADR-0009` | [Degraded-online connectivity](./0009-degraded-online-connectivity.md)                               | Accepted | Not implemented |
| `ADR-0010` | [Thai-first i18n and accessibility](./0010-thai-first-i18n-and-accessibility.md)                     | Accepted | Not implemented |
| `ADR-0011` | [Async jobs, reporting, and observability](./0011-async-jobs-reporting-and-observability.md)         | Accepted | Not implemented |
| `ADR-0012` | [Delivery, release, DR, and quality gates](./0012-delivery-release-and-quality-gates.md)             | Accepted | Foundation only |

## Coverage of the plan's ADR backlog

Plan §11 lists 26 ADR topics. The twelve ADRs above consolidate them; topics not
yet covered belong to later phases and stay open.

| Plan §11 topic                                          | Covered by             |
| ------------------------------------------------------- | ---------------------- |
| 1. Row-level multi-tenancy and `orgId`-first access     | `ADR-0001`, `ADR-0002` |
| 2. Convex region and self-host escape hatch             | `ADR-0008`             |
| 3. Clerk identity with Convex authorization             | `ADR-0001`             |
| 4. Permission-based, warehouse-scoped access control    | `ADR-0006`             |
| 5. Time-boxed audited support access                    | `ADR-0006`             |
| 6. Double-entry append-only ledger                      | `ADR-0003`             |
| 7. Atomic projections and reconciliation                | `ADR-0003`             |
| 8. Integer base-UOM quantities                          | `ADR-0004`             |
| 9. Tracking modes and serial-ready schema               | `ADR-0005`             |
| 10. Handling units, LPN lifecycle, mixed content        | `ADR-0005`, `ADR-0007` |
| 11. Request-id idempotency and reversal-only correction | `ADR-0003`             |
| 12. Degraded-online contract                            | `ADR-0009`             |
| 13. GS1/internal identifiers and barcode parser         | `ADR-0005`             |
| 14. ZPL-first labels and printer bridge                 | `ADR-0007`, `ADR-0008` |
| 15. HID scanner baseline and camera fallback            | `ADR-0008`             |
| 16. Private tenant files and storage region             | `ADR-0008`             |
| 17. Accessible 2D SVG instead of Three.js               | `ADR-0011`             |
| 18. Workflow/Workpool and transactional outbox          | `ADR-0011`             |
| 19. Expand–migrate–contract schema evolution            | `ADR-0012`             |
| 20. Same-transaction audit and retention                | `ADR-0003`, `ADR-0012` |
| 21. Backup/export/restore and RPO/RTO                   | `ADR-0012`             |
| 22. Thai PDPA posture and cross-border safeguards       | `ADR-0012`             |
| 23. Thai-first i18n and thermal fonts                   | `ADR-0010`             |
| 24. Test pyramid and tenant-isolation gate              | `ADR-0012`             |
| 25. Asynchronous indexed reporting                      | `ADR-0011`             |
| 26. Production tiers and cost guardrails                | `ADR-0008`, `ADR-0012` |

## Writing a new ADR

1. Take the next free number; never reuse or renumber.
2. Keep the eight-section structure and the code-owned / operational split.
3. Cite the exact plan section and B/D identifiers the decision rests on.
4. State implementation status honestly. An accepted decision is not shipped code.
5. Add gates to the [release gate register](../release-gates.md) rather than
   inventing gate IDs locally.
6. Add or update rows in the [coverage matrix](../specification-coverage.md).
