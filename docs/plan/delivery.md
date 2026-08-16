# Delivery

## State

| Area                            | State               |
| ------------------------------- | ------------------- |
| Toolchain and tenant security   | Local code complete |
| Inventory primitives and ledger | Local code complete |
| Master data and inbound         | Local code complete |
| Dashboard, occupancy, exports   | Local code complete |
| Order-to-factory Phase 5A       | Local code complete |
| Real identity and tenant proof  | Open                |
| Printer and scanner proof       | Open                |
| Load, restore, and pilot proof  | Open                |
| Legal and production approval   | Open                |

## Next

1. Configure Clerk and Convex staging.
2. Prove tenant isolation with real identities.
3. Test target scanners and printers.
4. Run load and conflict tests at target scale.
5. Prove backup, restore, export, and retention.
6. Complete Thai operator accessibility tests.
7. Run one-factory pilot.
8. Close legal, security, and release gates.

## Change rule

- New scope changes [Project goal](./project-goal.md).
- New domain behavior changes [Business logic](./business-logic.md).
- New data shape changes [Database](./database.md).
- New architecture requires an [ADR](../adr/README.md).
- Every release claim needs gate evidence.

The [release gate register](../release-gates.md) owns status and proof.
