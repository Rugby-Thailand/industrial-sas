# Master-data catalogue

**Current availability: Read and write surfaces plus screens; unauthenticated.**
Seven bounded list functions and six idempotent, audited mutations exist over the
reference tables the ledger already depends on, plus desktop screens that read
**and** maintain them. With no Clerk instance configured every call is denied, so
no screen has yet shown a tenant's rows.

The five further entities added afterwards — suppliers, item barcodes, alternate
units, storage classes, and label templates — have their own manual:
[Suppliers, barcodes, alternate units, storage classes, and label
templates](./master-data-entities.md).

## What exists

| Function                                 | Scope | Permission                   | Index used                                    |
| ---------------------------------------- | ----- | ---------------------------- | --------------------------------------------- |
| `masterData/catalogue:listItems`         | ORG   | `masterData.item.read`       | `by_orgId_sku` / `by_orgId_status_sku`        |
| `masterData/catalogue:listWarehouses`    | ORG   | `masterData.warehouse.read`  | `by_orgId_code`                               |
| `masterData/catalogue:listLocations`     | WH    | `masterData.location.read`   | `by_orgId_warehouseId_code` / `…_status_code` |
| `masterData/catalogue:listLotsForItem`   | ORG   | `masterData.lot.read`        | `by_orgId_itemId_lotCode`                     |
| `masterData/catalogue:listHandlingUnits` | WH    | `handlingUnit.read`          | `by_orgId_warehouseId_status_lpn`             |
| `masterData/catalogue:listReasonCodes`   | ORG   | `masterData.reasonCode.read` | `by_orgId_code` / `by_orgId_scope_code`       |
| `masterData/catalogue:listOwners`        | ORG   | `masterData.owner.read`      | `by_orgId_code`                               |

Screens: `/{locale}/master-data/items`, `/{locale}/master-data/items/{itemId}`,
and `/{locale}/master-data/locations`. `getItem` — a bounded single-document read
for the item detail screen — is documented with the entities it serves.

## The write surface

| Mutation                           | Scope | Permission                   | Idempotency operation        |
| ---------------------------------- | ----- | ---------------------------- | ---------------------------- |
| `masterData/writes:createItem`     | ORG   | `masterData.item.manage`     | `masterData.item.create`     |
| `masterData/writes:updateItem`     | ORG   | `masterData.item.manage`     | `masterData.item.update`     |
| `masterData/writes:deactivateItem` | ORG   | `masterData.item.deactivate` | `masterData.item.deactivate` |
| `masterData/writes:createLocation` | WH    | `masterData.location.manage` | `masterData.location.create` |
| `masterData/writes:updateLocation` | WH    | `masterData.location.manage` | `masterData.location.update` |
| `masterData/writes:createLot`      | ORG   | `masterData.lot.create`      | `masterData.lot.create`      |

Each one does the same five things, in this order, inside one transaction:

1. **Normalize** every code server-side. A SKU sent as `  widget-001  ` and one
   sent as `WIDGET-001` are the same SKU; a uniqueness check that ran before
   normalization would let both exist. Normalization happens _before_
   fingerprinting too, so a retry that trimmed differently is still a retry.
2. **Fingerprint and check idempotency** through
   `convex/lib/idempotency.ts` — the machinery extracted from the ledger, so a
   retried create makes one row and a reused request ID with different arguments
   is `REQUEST_ARGUMENT_CONFLICT`.
3. **Check uniqueness** with one bounded `orgId`-first indexed read per key.
   Convex has no unique constraint, so every "unique" key in
   `UNIQUENESS_CONTRACTS` is unique _by contract_ — and this is the contract.
4. **Write**, then **audit** with a field-level diff, then **index** the replay
   record last, so it only exists if everything above committed.

### Failures name a field, never a value

A create that answered "SKU WIDGET-001 already exists" would be an oracle over
the tenant's catalogue for a caller who guessed. `DUPLICATE_KEY` names the
**field** and stops. An update to a document this tenant does not own is
`NOT_FOUND` — byte-identical to the answer a document that never existed
produces (`INV-0002-03`).

### What no mutation does

- **Delete.** Master data is deactivated, never removed: a ledger line, a lot,
  and an audit row all reference an item by ID, and deleting it turns every one
  into a dangling pointer.
- **Change an item's SKU or base UOM.** There is no argument to send. A SKU is
  the key history resolves against; a base UOM is the unit every posted quantity
  is expressed in (`ADR-0004`), and changing it would silently reinterpret every
  balance already stored.

### `masterData.lot.create`, and why it is not `.manage`

The catalogue documents `.manage` as _correcting_ a lot's dates and codes, and
gives it maker-checker — rightly, because changing an expiration date changes
what FEFO picks and what the expiry job reclassifies.

Creating a lot is not that: it happens at the dock, once per batch, by the
operator holding the goods. Reusing `.manage` would have made lot creation
**impossible**, because the evaluator denies maker-checker whenever the maker and
the actor are the same person — and at creation there is no other person. A read
code standing in for a write and a correction code standing in for a creation are
the same mistake in opposite directions.

### Deactivation needs a second person, and today has none

`masterData.item.deactivate` carries maker-checker. The evaluator denies when the
maker and the actor are the same, **and** when there is no maker at all — both
fail-closed, both correct for an operation that stops every future receipt of a
SKU.

The consequence is that a single actor cannot deactivate an item. The mutation is
complete and its approval path is not reachable until a second mirrored actor
exists in the organization, which arrives with the membership-management slice.
The integration suite asserts the denial and the committed `APPROVAL_REQUIRED`
audit row rather than pretending otherwise.

## Least privilege, stated

Every function declares a **read** permission, never a `manage` code. Reading the
item catalogue must not require the right to change it.

Two read codes were added to the catalogue with this slice, because using
`.manage` for a list would have been the easy wrong answer:

- `masterData.reasonCode.read` — granted to every role that reads master data at
  all. A reason code is the audit evidence on an adjustment, a scrap, and a
  reversal (`ADR-0003` §5), so every screen showing one of those must resolve it
  to a name.
- `masterData.owner.read` — granted to `ORG_ADMIN` and `WAREHOUSE_MANAGER` only.
  Consigned stock is supervisory and ships disabled (D-11).

The full matrix is in the [permission catalogue](../permissions.md) §4, and
`tests/integration/permissions.integration.test.ts` fails if the code and the
document disagree — including on ordering.

## Scope, and why it differs per entity

`locations` and `handlingUnits` take a `warehouseId` the server revalidates
against the actor's membership before the handler runs (`INV-0006-04`). The rest
are organization-scoped: an item, a lot, a reason code, and an owner belong to
the tenant, not to a site.

That difference reaches the UI. The items screen does **not** wait for a warehouse
selection — asking a supervisor to pick a site before they can see the catalogue
would be a fiction, and "no warehouse selected" would be the wrong explanation for
an empty screen.

`listWarehouses` is organization-scoped on purpose, and it is the one place that
matters: the warehouse selector needs it, and a warehouse-scoped permission
cannot serve it — an actor would have to already know a warehouse to ask which
warehouses exist. Knowing a site exists is not knowing its stock; every operation
that takes a warehouse still refuses one outside the actor's scope.

## Paging

Every list is cursor-paged over an `orgId`-first index, capped at
`MAX_JOB_PAGE_SIZE` (100) and **refused** above it rather than clamped — the same
rule the ledger reads follow, so one client loop fits both surfaces. A caller that
asks for five thousand rows gets `PAGE_SIZE_TOO_LARGE`, not a silent hundred.

There is no unpaged variant and no `collect`.

## Status filtering

`status` is served by a status-first index where the schema declares one, so
"active items only" is an indexed read rather than a filter over a scan.

Two exceptions, stated rather than hidden:

- **`lots` has no status-first index.** The status filter is applied after the
  page. The read stays bounded — the page is already capped, so it filters at
  most `maxPageSize` rows and can only return fewer, never scan more — but a page
  may come back short for that reason.
- **`handlingUnits` has only a status-bearing index.** A status is therefore
  required to use it as a prefix, and the argument defaults to `ACTIVE`. That
  default is in the argument, not buried in the handler.

## Cross-tenant behaviour

Proved in `tests/isolation/master-data-isolation.isolation.test.ts`, which is a
blocking merge gate (`RG-031`):

- Two tenants seeded with **identical SKUs** get disjoint document IDs and never
  see each other's rows.
- A foreign `itemId` answers exactly what a deleted one answers
  (`REFERENCE_NOT_FOUND`), so a caller cannot use the difference as an existence
  oracle (`INV-0002-03`).
- A foreign `warehouseId` is refused during **tenant-context resolution**, before
  authorization is reached, with `WAREHOUSE_UNKNOWN` — the same code and message
  a warehouse that never existed produces.
- A cursor minted by one tenant cannot page another tenant's rows.

## What is deliberately absent

**Write surfaces for warehouses, handling units, owners, and reason codes.** Each
would need its own uniqueness contract and its own permission split; none has a
caller yet. A mutation with no caller is an unproved code path with a permission
attached.

**Entitlements.** The table exists and is enforced server-side by the wrapper;
there is no read surface for it yet.

## Related

- [Suppliers, barcodes, alternate units, storage classes, and label templates](./master-data-entities.md)
- [Inventory reference data and stock identity](./inventory-reference-data-and-stock-identity.md)
- [Roles, permissions, and audit](./roles-permissions-and-audit.md)
- [Application shell and locale](./application-shell-and-locale.md)
- [Permission catalogue](../permissions.md)
