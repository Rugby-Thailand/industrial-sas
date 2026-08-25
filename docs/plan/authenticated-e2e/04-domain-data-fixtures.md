# Topic 4 — Domain data fixtures

## Fixture goal

Give the authenticated scenario deterministic prerequisites without creating a
public test backdoor or depending on data left by an earlier run.

## Run namespace

Generate one bounded run key at setup, for example:

```text
E2E-<short-commit>-<attempt>
```

Use it in supplier code, item code, purchase-order number, receipt number,
handling-unit reference, and idempotency/operation IDs. The test locates its own
records by this key and never assumes the deployment is otherwise empty.

## Minimum prerequisite data

| Data                  | Required property                                                    |
| --------------------- | -------------------------------------------------------------------- |
| Organization settings | Bangkok business date and ordinary receipt policy                    |
| Warehouse             | Active and assigned to the actor                                     |
| Receiving location    | Physical inbound boundary/location                                   |
| Putaway location      | Active location eligible for the test item                           |
| Supplier              | Active, namespaced supplier                                          |
| Item                  | Active base UOM, exact quantity representation, no mandatory QC hold |
| Storage class         | Compatible with the putaway location                                 |

Create prerequisites through authenticated, tenant-bound application functions
where they exist. A preview-only setup function is acceptable only when no public
authoring function exists, and only if all of these are true:

- it is not exported by a production deployment;
- it requires the test environment and an authenticated test organization;
- it uses the same schema validators and tenant database boundary;
- the tenant-boundary guard covers it;
- it cannot accept an arbitrary production organization ID.

## Scenario-owned data

Create the purchase order, line, receipt, received quantity, handling unit, and
putaway through the browser. Seeding those records would skip the vertical seams
the test is intended to prove.

## Cleanup

Ephemeral preview deployments need no row cleanup; retiring the deployment is the
cleanup. A persistent E2E deployment must use a bounded, authenticated cleanup job
that deletes only rows matching the run namespace and the dedicated test tenant.
Cleanup failure is reported but must not erase the original test failure.

Never weaken production's deactivation, append-only ledger, or audit rules for
cleanup. If ledger/audit facts cannot be deleted safely, retain them under the run
namespace and expire the whole test tenant/deployment according to a documented
retention limit.

## Exit criteria

- Two runs can execute sequentially without sharing records.
- A retried run reuses or safely replaces only its own idempotent facts.
- Setup failures name the missing fixture rather than timing out in the UI.
- No fixture contains real customer, supplier, employee, or product data.
