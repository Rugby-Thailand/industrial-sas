# Feature manuals

These manuals describe the features that exist in the repository today. They are
written for operators, tenant administrators, support staff, and developers who
need to integrate the current backend and domain modules.

## Read the availability label first

A feature marked **Application surface** has screens that run and call the server,
but is still unauthenticated: with no configured Clerk instance every tenant-bound
call is denied, so no screen has shown a tenant's data. A feature marked **Backend
surface** has a public Convex function but still needs a configured Clerk instance,
generated Convex bindings, deployment, and a client screen before an operator can
use it. A feature
marked **Domain library** is tested business logic for another feature to call; it is
not a screen or network endpoint. **Schema foundation** means the records and rules
exist, but CRUD workflows do not.

## Manual index

| Feature                                                            | Current availability                                 | Manual                                                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Application shell, locale routing, and inventory read screens      | Application surface; unauthenticated                 | [Application shell and locale](./application-shell-and-locale.md)                               |
| Master-data catalogue reads, writes, and screens                   | Read and write surfaces; unauthenticated             | [Master-data catalogue](./master-data-catalogue.md)                                             |
| Suppliers, barcodes, alternate units, storage classes, templates   | Read and write surfaces and screens; unauthenticated | [Master-data entities](./master-data-entities.md)                                               |
| Purchase orders, receiving, QC, handling units, labels, putaway    | Application surface; unauthenticated                 | [Inbound receiving slice](./inbound-receiving-slice.md)                                         |
| Dashboard counters, occupancy map, and exports                     | Application surface; unauthenticated                 | [Dashboard and reporting](./dashboard-and-reporting.md)                                         |
| Reconciliation and expiry job drivers                              | Callable drivers; no schedule registered             | [Inventory maintenance jobs](./inventory-jobs.md)                                               |
| Observability, structured errors, and domain SLIs                  | Client port with local adapters; no vendor sink      | [Observability and SLIs](./observability-and-slis.md)                                           |
| Clerk identity and organization synchronization                    | Backend adapter; undeployed                          | [Identity and organization sync](./identity-and-organization-sync.md)                           |
| Active organization and warehouse access                           | Backend foundation; no organization switcher UI      | [Tenant and warehouse access](./tenant-and-warehouse-access.md)                                 |
| Roles, permissions, authorization, and audit                       | Backend enforcement; no administration UI            | [Roles and permissions](./roles-permissions-and-audit.md)                                       |
| Inventory reference data and stock identity                        | Schema foundation; no master-data CRUD UI/API        | [Inventory reference data and stock identity](./inventory-reference-data-and-stock-identity.md) |
| Inventory ledger, balances, history, reversals, and reconciliation | Backend surface with read screens; unauthenticated   | [Inventory ledger](./inventory-ledger.md)                                                       |
| Barcode, GS1, GTIN, SSCC, SKU, lot, and LPN processing             | Domain library                                       | [Barcode and identifier processing](./barcode-and-identifiers.md)                               |
| Exact quantities and unit-of-measure conversion                    | Domain library, used by the ledger                   | [Quantities and UOM](./quantities-and-uom.md)                                                   |
| FIFO/FEFO stock rotation and expiry planning                       | Domain library; no pick/expiry job UI                | [Stock rotation and expiry](./stock-rotation-and-expiry.md)                                     |
| Organization business dates and display calendars                  | Domain library, used by ledger posting               | [Business dates and timezones](./business-dates-and-timezones.md)                               |

## Every route, and the manual that covers it

Audited against `src/app/[locale]/**` rather than remembered, because a manual
index that has drifted is worse than none: it tells a reader a feature is missing
when it ships, or present when it does not.

| Route                                                                  | Manual                                                                                             |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/{locale}/dashboard`                                                  | [Dashboard and reporting](./dashboard-and-reporting.md)                                            |
| `/{locale}/reports`                                                    | [Dashboard and reporting](./dashboard-and-reporting.md)                                            |
| `/{locale}/inventory/balances`, `/history`                             | [Inventory ledger](./inventory-ledger.md)                                                          |
| `/{locale}/master-data/items`, `/{itemId}`                             | [Master-data catalogue](./master-data-catalogue.md)                                                |
| `/{locale}/master-data/locations`                                      | [Master-data catalogue](./master-data-catalogue.md)                                                |
| `/{locale}/master-data/suppliers`                                      | [Master-data entities](./master-data-entities.md)                                                  |
| `/{locale}/master-data/storage-classes`                                | [Master-data entities](./master-data-entities.md)                                                  |
| `/{locale}/master-data/label-templates`                                | [Master-data entities](./master-data-entities.md)                                                  |
| `/{locale}/purchasing/orders`, `/{id}`                                 | [Inbound receiving slice](./inbound-receiving-slice.md)                                            |
| `/{locale}/purchasing/import`                                          | [Inbound receiving slice](./inbound-receiving-slice.md)                                            |
| `/{locale}/receiving`, `/{receiptId}`                                  | [Inbound receiving slice](./inbound-receiving-slice.md)                                            |
| `/{locale}/quality`                                                    | [Inbound receiving slice](./inbound-receiving-slice.md)                                            |
| `/{locale}/putaway`                                                    | [Inbound receiving slice](./inbound-receiving-slice.md)                                            |
| `/{locale}/handheld`, `/receive`, `/quality`, `/putaway`, `/inventory` | [Inbound receiving slice](./inbound-receiving-slice.md), [Inventory ledger](./inventory-ledger.md) |
| `/{locale}/setup`                                                      | [Application shell and locale](./application-shell-and-locale.md)                                  |
| `/{locale}/sign-in`                                                    | [Identity and organization sync](./identity-and-organization-sync.md)                              |

Every route has a manual. What each manual then states precisely is where its
feature stops.

## Features that do not have an operating manual yet

**Support grants.** The schema, the permission codes, and the maker-checker rules
exist; there is no workflow and no screen, so there is nothing to operate. See
[Roles and permissions](./roles-permissions-and-audit.md) for what is enforced.

**Organization administration.** Roles and memberships are seeded and enforced,
but there is no administration UI: role assignment happens in the database or
through Clerk, and neither is a supported procedure yet.

**Printing specifically.** Label _templates_ are authored, versioned, and
published, and `labels/print` records versioned print-job evidence with the
template and payload it used — see
[Inbound receiving slice](./inbound-receiving-slice.md). What does **not** exist
is rendering to a device: there is no printer transport (`INT-04`) and no
physical print verification (`RG-004`/`RG-029`), and no screen implies otherwise.
An earlier version of this page said "nothing renders or prints one", which
understated the evidence trail that does exist; both halves are stated above.

## Common safety rules

- Never take `orgId`, actor identity, event time, or a balance from client input.
- Treat authorization denial and domain refusal as different outcomes. A denial means
  the actor may not attempt the operation; a refusal means the authorized request
  violates a business invariant.
- Keep request IDs stable across retries of one intent. Do not reuse a request ID for
  different arguments.
- Use bounded pages and return the supplied cursor unchanged. Never add an unpaged
  tenant read.
- Show translated UI text from structured error codes. Domain errors deliberately do
  not contain operator-facing prose.
- Do not deploy this application to production. It has no configured identity
  provider, and its release gates are open.

## Related references

- [Permission catalogue](../permissions.md)
- [Domain glossary](../domain-glossary.md)
- [Specification coverage](../specification-coverage.md)
- [Architecture decisions](../adr/README.md)
- [Operational runbooks](../runbooks/README.md)
