# Topic 6 — Inbound scenario

## Scenario name

`authenticated operator receives and puts away a purchase-order line`

## Preconditions

- Identity, organization, membership, warehouse, and role from Topic 3 are ready.
- Supplier, item, receiving location, storage class, and putaway location from
  Topic 4 are ready.
- The item follows the ordinary no-QC-hold path.
- Quantity is an exact base-UOM value, such as 10 units represented in the
  application's minor-unit convention.

## Browser steps and assertions

### 1. Establish authenticated context

1. Open `/th/purchasing/orders` with the operator storage state.
2. Assert the route remains private and authenticated.
3. Assert the organization and warehouse context bar names the fixture context.

### 2. Create the purchase order

1. Submit a namespaced PO number and select the synthetic supplier.
2. Add one line for the synthetic item and exact ordered quantity.
3. Open the PO detail route.
4. Assert the displayed supplier, item, quantity, and open status.

### 3. Receive the line

1. Open `/th/receiving` and create a namespaced receipt against the PO.
2. Post the exact ordinary receipt quantity to the inbound location.
3. Assert the receipt line appears once and is linked to the PO line.
4. Assert the UI exposes the next handling-unit/putaway work rather than reporting
   success before the server acknowledges it.

### 4. Build and put away

1. Build a handling unit from the posted receipt line when required by the UI.
2. Open `/th/putaway` and locate the namespaced task.
3. Claim the task.
4. Select the eligible putaway location and confirm.
5. Assert the task becomes complete and cannot be confirmed a second time.

### 5. Verify accounting through the UI

1. Open `/th/inventory/balances`.
2. Filter by the namespaced item and destination location.
3. Assert the exact available quantity.
4. Open `/th/inventory/history`.
5. Assert receipt and putaway entries exist in the expected order and reference
   the current run's business identifiers.

## Assertions deliberately kept outside page objects

- Exact quantity and location.
- PO/receipt/task state transitions.
- The number and ordering of ledger-visible facts.
- Tenant and warehouse context.
- Idempotent refusal of a repeated confirmation, if the supported UI exposes it.

Page objects may encapsulate navigation and form mechanics. They must return
control to the spec for these business assertions.

## Failure localization

Add named `test.step` boundaries matching the five sections above. A trace should
show whether failure occurred in identity, authoring, receipt, putaway, or ledger
projection without reading the entire test log.
