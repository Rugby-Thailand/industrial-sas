# Inventory reference data and stock identity manual

Status: **Schema foundation; no master-data CRUD UI/API.** The schema, validators,
tenant ownership checks, and stock bucket identity are implemented. Reference rows
must currently be created through tests, fixtures, or future controlled feature
mutations—not through a working application screen.

## Who this is for

- Master-data owners defining warehouse records
- Developers preparing data for ledger posting
- Inventory controllers interpreting a stock bucket key

## Required reference data

The ledger validates these records before it posts:

- warehouse;
- item and its base UOM/tracking mode;
- physical location, when a line is inside the warehouse;
- lot, when the item is lot tracked;
- handling unit, when stock is pallet/carton identified;
- owner, only when consigned-stock capability is enabled;
- reason code for adjustments, scrap, reversals, and status changes.

Rows used by a posting must be active and belong to the active organization. A
location and handling unit must belong to the transaction warehouse; a lot must
belong to the line item.

## Stock bucket identity

A balance is not identified by item alone. Its bucket contains:

- organization;
- warehouse;
- item;
- physical location or code-owned virtual boundary;
- optional lot;
- optional serial (schema-ready, flow disabled);
- optional handling unit;
- optional owner (capability disabled by default);
- stock status.

The encoded `IB1...` bucket key is a canonical, reversible identity. Do not build,
split, or compare bucket keys manually; use `encodeBucketKey` and `decodeBucketKey`.

## Stock statuses

| Status       | Operational meaning                                 |
| ------------ | --------------------------------------------------- |
| `AVAILABLE`  | Usable stock; negative balance is forbidden         |
| `QC_HOLD`    | Awaiting quality decision                           |
| `QUARANTINE` | Segregated and not available for normal use         |
| `REJECTED`   | Quality-rejected stock                              |
| `SCRAP`      | Designated for disposal/scrap processing            |
| `EXPIRED`    | Reclassified because the lot expiration date passed |

A status change is a paired ledger movement between two buckets. Never edit a
balance row's status.

## Physical locations and virtual boundaries

Physical location types are `DOCK`, `STAGING`, `RACK_BIN`, `FLOOR_BLOCK`,
`QUARANTINE`, and `OVERFLOW`.

Virtual boundaries represent a counterparty outside stored inventory:

- `SUPPLIER_RECEIPT`
- `CUSTOMER_SHIPMENT`
- `CUSTOMER_RETURN`
- `PRODUCTION_ISSUE`
- `PRODUCTION_RECEIPT`
- `INVENTORY_ADJUSTMENT`
- `SCRAP_DAMAGE`
- `RECONCILIATION`
- `TRANSFER_IN_TRANSIT`

They are code-owned constants, not tenant-editable locations. A receipt balances a
physical destination against `SUPPLIER_RECEIPT`; a shipment balances a physical
source against `CUSTOMER_SHIPMENT`; a failed delivery received back into QC hold
balances the physical return location against `CUSTOMER_RETURN`.

## Tracking and capability rules

- `NONE`: a lot must not be supplied.
- `LOT`: a valid lot for the item is required.
- `LOT_SERIAL`: declared in schema, but serial posting flows are disabled.
- Mixed handling-unit content, owner/consignment, negative available balance, and
  support grants start disabled for every tenant.

## Data preparation checklist

1. Create and activate the warehouse.
2. Create active items with normalized codes and base UOMs.
3. Create warehouse locations and keep their hierarchy/type valid.
4. Create lots for lot-tracked items, including dates where applicable.
5. Create handling units and keep each one in a single physical location.
6. Create reason codes with the correct scope.
7. Verify all rows share the active organization and all indexes start with
   `orgId`.
8. Post only through the inventory ledger surface.

## Common refusals

- `REFERENCE_NOT_FOUND`: missing, foreign, or intentionally hidden reference.
- `REFERENCE_INACTIVE`: row exists but may no longer be posted against.
- `LOCATION_WAREHOUSE_MISMATCH` or `HANDLING_UNIT_WAREHOUSE_MISMATCH`: reference
  belongs to another site.
- `LOT_ITEM_MISMATCH`, `LOT_REQUIRED`, or `LOT_NOT_TRACKED`: tracking contract is
  inconsistent.
- `SERIAL_FLOWS_DISABLED` or `CONSIGNED_STOCK_DISABLED`: capability is not enabled.
- `REASON_CODE_SCOPE_MISMATCH`: reason code does not match the transaction type.

## Implementation references

- `convex/schema.ts`
- `convex/lib/validators.ts`
- `convex/model/inventory/stockIdentity.ts`
- `convex/lib/inventoryLedgerStore.ts`
- [Warehouse and stock identity ADR](../adr/0005-warehouse-location-and-stock-identity.md)
