# Business logic

## Tenancy and access

- Every tenant row has `orgId`.
- Identity selects the active organization.
- Server code checks permission, warehouse scope, entitlement, threshold, and maker-checker rules.
- Client claims never grant access.
- Every attempt is audited.

## Inbound

`PO → receipt → QC → handling unit → label → putaway → ledger`

- Receive only open PO lines.
- Validate item, UOM, quantity, lot, and warehouse.
- QC decides stock status.
- Label evidence precedes putaway.
- Putaway needs a valid destination.
- Each write is idempotent.

## Inventory

- Ledger rows are append-only.
- Corrections use reversal plus replacement.
- Quantity uses integer thousandths of base UOM.
- Conversion is exact or rejected.
- Balances update atomically with the ledger.
- Negative stock follows explicit policy.
- Reconciliation must find zero drift.

## Order to factory

`Customer PO → design check → master card → factory packet → acknowledgement`

- A customer PO cannot skip design review.
- Released master-card revisions are immutable.
- Changes create a new revision.
- Factory packets bind exact released inputs.
- Acknowledgement records actor and time.

## Shared rules

- Retry-safe commands use idempotency keys.
- Used records deactivate; they are not deleted.
- Timestamps use UTC; warehouse dates use Bangkok rules.
- Thai is primary; English keys must match.
- Files remain private; access uses short-lived links.

See [domain glossary](../domain-glossary.md), [permissions](../permissions.md), and [manuals](../manuals/README.md).
